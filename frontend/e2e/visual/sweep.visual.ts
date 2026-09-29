import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium, expect, test, type Page } from "@playwright/test";

import {
  OUT_ROOT,
  PARTS_DIR,
  partFileName,
  type SweepBrowser,
  type SweepFrame,
} from "./manifest";
import {
  SWEEP_MOTION,
  SWEEP_SCROLL_OFFSETS,
  SWEEP_ROUTES,
  SWEEP_STATES,
  SWEEP_THEMES,
  SWEEP_VIEWPORTS,
  type SweepDriverId,
  type SweepState,
  type SweepTheme,
  type SweepViewport,
} from "./routes";
import {
  APP_ORIGIN,
  guardOrigins,
  openRoute,
  park,
  sweepApi,
  sweepSubmission,
  validationFailure,
} from "./fixtures";
import {
  assertSeekable,
  censusAnimations,
  seekAnimations,
  settleAtScroll,
} from "./helpers/motion";
import { auditFocusRings, auditFrame, type Finding } from "./helpers/audit";
import { checkBrowserProvenance } from "./helpers/provenance";

/**
 * The visual sweep: photograph every route, state and motion surface, and write
 * down what produced the pictures.
 *
 * What this is for. The code-level locks in this repo — `page-rhythm.test.ts`,
 * `e2e/visual-consistency/contrast.spec.ts`, `ambient-motion.test.ts` — can see
 * the stylesheet and nothing else. A dark-mode override that never applies, a
 * card that wraps badly at 375px, a footer that never renders, a spinner that
 * never resolves: none of those fail a source-text assertion, and every one of
 * them is obvious in a screenshot. Reading 25 routes x 2 themes x 2 viewports by
 * hand does not repeat, which is the property a review needs.
 *
 * How it stays honest:
 *
 * 1. **The route must have rendered.** Every capture is preceded by its page's
 *    `<h1>` being visible. Without that, a broken fixture, an auth redirect and a
 *    Suspense fallback all photograph identically — a valid-looking image of
 *    nothing, which is worse than a failure because it survives review.
 * 2. **Motion is sampled by construction**, never by wall clock. Finite
 *    time-driven animations are finished, infinite ones are frozen at phase 0,
 *    scroll-driven ones are left to the scroll offset, and the filmstrips seek
 *    the Web Animations API to a fixed progress. A sweep that slept and hoped
 *    would report the machine's load as a design defect.
 * 3. **The browser is pinned.** `checkBrowserProvenance` refuses to run unless
 *    the resolved Chromium is inside this project's own browser root, and the
 *    manifest records the version and path for the report to quote.
 * 4. **Nothing off-origin can appear.** The origin guard aborts every request
 *    that is not the preview server, and a blocked URL fails the test that hit
 *    it rather than being quietly dropped.
 *
 * Captures come from the production build via `vite preview` (see
 * `playwright.visual.config.ts`): a long-running dev server serves stale CSS
 * modules, so measuring it measures the wrong stylesheet.
 *
 * Note what is deliberately *not* used: `page.screenshot({ animations:
 * "disabled" })`. Playwright implements it by fast-forwarding finite animations
 * and **cancelling infinite ones**, which would drop the ambient layer back to
 * its unanimated style — a different image from the one `settleAtScroll`
 * deliberately froze. The settle is done here, once, on purpose.
 *
 * At the default matrix: 25 routes x 2 themes x 2 viewports x 3 scroll offsets
 * = 300 static frames, 32 state frames and 12 motion frames.
 */

// `OUT_ROOT` and friends come from `./manifest`, so the spec and the teardown
// cannot write to and read from two different directories.

/**
 * Provenance, resolved once at collection time.
 *
 * A failure here throws before any test runs, which is the right shape for it:
 * there is nothing to report if the pictures did not come from the right
 * browser, and a per-test assertion would spend four minutes producing images
 * first.
 */
const PROVENANCE = checkBrowserProvenance(chromium.executablePath());

/** What one captured frame recorded about itself. */
/**
 * The frame record is the manifest's own type, imported rather than redeclared.
 *
 * It was a local interface once, with the settle fields spelled out a third
 * time. The duplication was invisible until the teardown tried to read a field
 * added to the spec's version and got a `{}` — a manifest that silently drops
 * every new finding, because the type that reads it never mentioned it.
 */
type FrameRecord = SweepFrame & { theme: SweepTheme; viewport: SweepViewport };

/** Per-worker records, written out by `afterAll` and merged by the teardown. */
const FRAMES: FrameRecord[] = [];
/** Layout and accessibility findings, attributed to the frame that shows them. */
const FINDINGS: Finding[] = [];
/** Filled in by the provenance test, read by `afterAll`. */
let BROWSER: SweepBrowser | null = null;

// --- capture primitives ---------------------------------------------------

async function capture(
  page: Page,
  file: string,
  meta: Omit<FrameRecord, "path" | "bytes" | "ms">,
): Promise<void> {
  const full = join(OUT_ROOT, file);
  await mkdir(join(full, ".."), { recursive: true });
  const started = Date.now();
  // PNG for static frames: the reviewer reads text out of these, and JPEG
  // artefacts on an 11px label are exactly the thing a visual review should not
  // have to distinguish from a real defect.
  const buffer = await page.screenshot({ path: full });
  // Audited here, not in a pass of its own: the measurements are only evidence
  // about a frame if they come from the same instant as the frame. A separate pass
  // re-navigates, and a page that scrolled, focused or re-rendered in between
  // makes every number a measurement of something else. It also means a new
  // capture site cannot forget the audit — there is one `capture()`.
  FINDINGS.push(
    ...(await auditFrame(page, {
      page: meta.page,
      theme: meta.theme,
      viewport: meta.viewport,
      frame: file,
    })),
  );
  FRAMES.push({ path: file, bytes: buffer.byteLength, ms: Date.now() - started, ...meta });
}

/** Open a route in a theme and prove both the theme and the page landed. */
// --- at-rest passes: static and state, under the app's own reduced-motion path
//
// `reducedMotion: "reduce"` is not a performance setting here, it is the
// definition of *at rest* this project already ships. Home types its prompt on
// a 24ms interval and then cycles a status chip every 1200ms for thirty seconds;
// nothing on that page is ever finished, so two photographs of the same state
// differ by which chip happened to be lit. The determinism lock caught exactly
// that — same load, same offset, 193193 bytes against 196453 — and the honest
// answer is not to wait longer.
//
// Under reduced motion the app shows the full prompt, parks the chip on its last
// entry, lands `useCountUp` on its target and reveals everything: the same
// composition, at rest, with the content complete. The motion pass below runs
// with motion on, because filming transitions is its entire job.

test.describe("at rest", () => {
  test.use({ reducedMotion: "reduce" });

  // --- static pass: every route, both themes, both viewports, three offsets --

  for (const theme of SWEEP_THEMES) {
    for (const route of SWEEP_ROUTES) {
      test(`${theme} ${route.path} at top, middle and bottom`, async ({ page }, testInfo) => {
        const viewport = testInfo.project.name as SweepViewport;
        const guard = await guardOrigins(page.context());
        await sweepApi(page, { auth: route.auth });
        await openRoute(page, route, theme);

        for (const fraction of route.scroll ?? SWEEP_SCROLL_OFFSETS) {
          const settle = await settleAtScroll(page, fraction);
          // A `Reveal` on screen that never lit is the "objects that just appear
          // when you move the scroll bar" failure. Annotated, not thrown: the
          // reviewer needs the picture that proves it, and an annotation keeps the
          // frame instead of losing it to a thrown error.
          if (settle.revealsTimedOut) {
            testInfo.annotations.push({
              type: "reveal-stuck",
              description:
                `${settle.pendingReveals} Reveal block(s) never became visible at scroll ${fraction}`,
            });
          }
          // A frame whose animations were still running is a picture of a moment,
          // not evidence about the design. Annotate it, and let the teardown list
          // them, so "not evidence" is visible in the report instead of being a
          // pixel difference somebody has to notice.
          if (settle.unquiesced || settle.unsettledReveals > 0) {
            testInfo.annotations.push({
              type: "unsettled",
              description:
                `${settle.unsettledReveals} reveal(s) still in flight` +
                (settle.unquiesced ? " and animations still running" : "") +
                ` at scroll ${fraction}`,
            });
          }
          assertSeekable(settle, `${route.path} @ scroll ${fraction}`);

          await capture(page, join(theme, viewport, slug(route.path), scrollName(fraction)), {
            theme,
            viewport,
            page: route.path,
            state: `static ${route.path} @ scroll ${fraction}`,
            // Spread, not a hand-written list — and this is the *second* time
            // this projection has cost a field. The interface above records the
            // first: a local type, settled fields spelled out a third time, and
            // a teardown that read `{}` for anything added later. Sharing the
            // type fixed the compile error but not the omission, because every
            // name in a hand-written list still exists in both shapes — so
            // `pseudoTransitions` (#334) reached the manifest's *type* and not
            // the manifest, which is the identical silent drop with an extra
            // step. A spread cannot fall behind: a new census field is carried
            // by construction, and a renamed one is a type error here.
            settle: { ...settle },
          });
        }

        // A blocked request is a finding, not a detail: it means the app reached
        // for something the fixtures do not serve, so a capture is missing content
        // that a real user would have.
        expect(guard.blocked(), `off-origin request(s) while sweeping ${route.path}`).toEqual([]);

        // Last, because tabbing scrolls the viewport: run it and the next frame of
        // this same page is captured somewhere nobody asked to look. Attributed to
        // the top-of-page frame, which is the one a reviewer opens first.
        FINDINGS.push(
          ...(await auditFocusRings(page, {
            page: route.path,
            theme,
            viewport,
            frame: join(theme, viewport, slug(route.path), scrollName(route.scroll?.[0] ?? SWEEP_SCROLL_OFFSETS[0]!)),
          })),
        );
      });
    }
  }

  // --- state pass: the declared interaction states -------------------------

  /**
   * The drivers, one per `SweepDriverId`.
   *
   * Each leaves the page in the state and *keeps it there* — no driver is a race
   * against a timer. Where a state is transient, the request behind it is parked
   * instead of awaited, which is what makes the frame reproducible.
   */
  const DRIVERS: Record<SweepDriverId, (page: Page) => Promise<void>> = {
    "mobile-nav": async (page) => {
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    },

    "user-dropdown": async (page) => {
      await page.getByRole("button", { name: /root/ }).click();
    },

    "login-field-errors": async (page) => {
      // A two-character identifier satisfies the input's `required` and fails the
      // server's `Field(min_length=3)` (see `LoginRequest` in the backend), so this
      // is the real 422 rather than a payload invented to make a screenshot.
      const failure = validationFailure({
        identifier: "String should have at least 3 characters",
      });
      await page.route("**/api/auth/login", (route) =>
        route.fulfill({ status: failure.status, json: failure.json }),
      );
      await page.getByLabel("Email or username").fill("ab");
      await page.getByLabel("Password").fill("hunter2hunter2");
      await page.getByRole("button", { name: "Log in" }).click();
    },

    "login-submitting": async (page) => {
      // Parked, so the loading state has no expiry: the frame is identical on an
      // idle machine and a loaded one. Released after the capture.
      park(page, "**/api/auth/login");
      await page.getByLabel("Email or username").fill("tester@example.com");
      await page.getByLabel("Password").fill("hunter2hunter2");
      await page.getByRole("button", { name: "Log in" }).click();
    },

    "delete-dialog": async (page) => {
      await page.getByRole("button", { name: "Delete challenge" }).click();
    },

    toast: async (page) => {
      // The mismatched-password branch is client-side and would be a different
      // state, so the fixtures are made to agree and the server is asked to
      // succeed — this frame is the *success* toast.
      // `getByLabel` matches by substring, so "New password" also matches
      // "Confirm new password" — a strict-mode violation rather than a fill.
      await page.getByLabel("Current password", { exact: true }).fill("old-password");
      await page.getByLabel("New password", { exact: true }).fill("new-password-1");
      await page.getByLabel("Confirm new password", { exact: true }).fill("new-password-1");
      // "Update password", not "Change password" — the latter is the section's
      // `<h2>`, and matching a heading's text against a button is how this driver
      // spent two minutes waiting for a control that was never going to appear.
      await page.getByRole("button", { name: "Update password" }).click();
    },

    "code-expanded": async (page) => {
      // The page nests two disclosures, and the driver has to open both. The raw
      // log sits inside a collapsed `<details>` ("Show raw output (344 lines)"),
      // and only *inside* it does `CodeBlock` render its own 300-line clamp
      // toggle. Clicking "Show all" straight away waits for a button that is not
      // in the DOM yet — the collapsed `<details>` does not render its contents.
      const disclosure = page.getByText(/^Show raw output/);
      await expect(disclosure).toBeVisible();
      await disclosure.click();

      // The toggle only exists past `CodeBlock`'s `DEFAULT_LINE_LIMIT`, so the
      // sweep's log is deliberately longer than the clamp.
      const toggle = page.getByRole("button", { name: "Show all" });
      await expect(toggle).toBeVisible();
      await toggle.click();
    },

    // Both skeleton states share one parked request; the difference is whether the
    // test releases it before capturing, which the state pass does.
    skeleton: async () => {},
    "skeleton-loaded": async () => {},
  };

  for (const state of SWEEP_STATES) {
    for (const theme of state.themes ?? SWEEP_THEMES) {
      for (const viewport of state.viewports ?? SWEEP_VIEWPORTS) {
        // The viewport belongs in the title. The loop varies it, `test.skip` runs
      // *inside* the body, and Playwright rejects two tests that declare the same
      // title — so a state declared for both viewports used to abort collection
      // for the whole run. Found by the full sweep, not by a targeted lock.
      test(`${theme} state ${state.id} @ ${viewport}`, async ({ page }, testInfo) => {
          test.skip(
            testInfo.project.name !== viewport,
            `${state.id} is declared for ${viewport} only`,
          );
          const route = SWEEP_ROUTES.find((r) => r.path === state.route);
          if (!route) {
            throw new Error(`state ${state.id} names an unswept route: ${state.route}`);
          }

          const guard = await guardOrigins(page.context());
          // A state can need a different identity from its route: the delete
          // dialog is behind `isOwner`, and the route is swept as a guest.
          await sweepApi(page, { auth: state.auth ?? route.auth });

          // Parked *before* navigation, so the read that produces the skeleton is
          // the one held. The reply is the real submission, which is what the
          // "loaded" half of the pair captures after releasing it.
          const held =
            state.drive === "skeleton" || state.drive === "skeleton-loaded"
              ? park(page, "**/api/submissions/*", { json: sweepSubmission("sweep-submission") })
              : null;

          await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
          // `commit` rather than `load`: the parked request means `load` may never
          // be reached, and the point of the skeleton states is the page before it
          // finishes.
          await page.goto(`${APP_ORIGIN}${route.url}`, { waitUntil: "commit" });

          await DRIVERS[state.drive](page);
          if (state.drive === "skeleton-loaded") {
            held?.release();
          }

          // Proof the state is live, checked *after* driving: a driver that
          // silently did nothing fails here instead of yielding a photo of the
          // page's default state under a filename that promises otherwise.
          await proveState(page, state);

          const settle = await settleAtScroll(page, 0);
          assertSeekable(settle, `state ${state.id}`);

          await capture(page, join(theme, viewport, "states", `${state.id}.png`), {
            theme,
            viewport,
            page: `state:${state.id}`,
            state: `state ${state.id}: ${state.caption}`,
          });

          expect(guard.blocked(), `off-origin request(s) in state ${state.id}`).toEqual([]);
          // Release anything still parked. The state was already captured, and a
          // handler awaiting a promise that never resolves leaks a route — and a
          // socket — into the rest of the worker's run.
          held?.release();
        });
      }
    }
  }

  async function proveState(page: Page, state: SweepState): Promise<void> {
    const { role, name, text } = state.expect;
    if (role) {
      // Strict mode: two matches is a failure, not a first match. A proof that
      // resolves to the wrong element is worse than no proof at all.
      //
      // The cast is because `routes.ts` is compiled by the *app* TS project too
      // (the lock imports it), and that project has no Playwright types — so the
      // matrix cannot name `AriaRole` without dragging `@playwright/test` into the
      // app's type graph.
      await expect(
        page.getByRole(role as Parameters<Page["getByRole"]>[0], { name, exact: true }),
      ).toBeVisible();
      return;
    }
    if (text) {
      await expect(page.getByText(text)).toBeVisible();
      return;
    }
    throw new Error(`state ${state.id} declares no proof: give it a role or a text`);
  }

});

// --- motion pass: filmstrips, sampled by construction --------------------

for (const motion of SWEEP_MOTION) {
  for (const theme of motion.themes ?? (["dark"] as const)) {
    for (const viewport of motion.viewports ?? SWEEP_VIEWPORTS) {
      test(`${theme} motion ${motion.id} @ ${viewport}`, async ({ page }, testInfo) => {
        test.skip(
          testInfo.project.name !== viewport,
          `${motion.id} is declared for ${viewport} only`,
        );
        const route = SWEEP_ROUTES.find((r) => r.path === motion.route);
        if (!route) {
          throw new Error(`motion ${motion.id} names an unswept route: ${motion.route}`);
        }

        await guardOrigins(page.context());
        await sweepApi(page, { auth: route.auth });
        await openRoute(page, route, theme);

        const dir = join("motion", viewport, motion.id);
        let seeks = 0;
        let stuck = 0;

        for (const sample of motion.samples) {
          // Every kind is named here rather than collapsed into a catch-all, so
          // a fourth kind added to the matrix cannot inherit the ambient
          // treatment by omission.
          if (motion.kind === "scroll") {
            // Position-driven: the offset is the entire input. `.scrollReveal`'s
            // progress is a pure function of it (`animation-range: entry 0%
            // cover 26%`), so the same offsets always produce the same pixels.
            const settle = await settleAtScroll(page, sample);
            assertSeekable(settle, `${motion.id} @ ${sample}`);
            if (settle.revealsTimedOut) {
              stuck += 1;
            }
            await filmstrip(page, dir, sample, theme, viewport, motion.id);
            continue;
          }

          // `transition` and `ambient` both go through the Web Animations API:
          // finite effects are placed at a fraction of their own duration
          // (delay included, so a stagger reads as a cascade), infinite ones at
          // a fixed phase. The seek treats them identically because they differ
          // only in *which* progress a reader is meant to compare, not in how a
          // frame is placed.
          const census = await censusAnimations(page);
          assertSeekable(census, `${motion.id} @ ${sample}`);
          if (census.timeDriven === 0 && (motion.kind === "transition" || motion.kind === "ambient")) {
            // A declared pass that finds nothing animating is a finding in its
            // own right, and the reader deserves it as a failure rather than as a
            // frame of a page that happens to be still.
            throw new Error(
              `${motion.id}: the ${motion.kind} pass found no time-driven animation at ${sample}`,
            );
          }
          const seeked = await seekAnimations(page, sample);
          seeks += seeked;
          if (seeked === 0) {
            // The guard on the guard. "There is nothing animating here" and "the
            // seek mechanism is broken" look identical from the outside, and the
            // second one would silently retire an animation system from review.
            throw new Error(
              `${motion.id}: the seek moved 0 animations at ${sample}, but the census counted ${census.timeDriven} time-driven one(s)`,
            );
          }
          await filmstrip(page, dir, sample, theme, viewport, motion.id, seeked);
        }

        testInfo.annotations.push({
          type: "motion",
          description: `${motion.id}: ${motion.samples.length} frames, ${seeks} animation seeks, ${stuck} stuck-reveal offsets`,
        });
      });
    }
  }
}

async function filmstrip(
  page: Page,
  dir: string,
  sample: number,
  theme: SweepTheme,
  viewport: SweepViewport,
  motionId: string,
  seeked?: number,
): Promise<void> {
  const name = `frame-${String(Math.round(sample * 100)).padStart(3, "0")}.jpg`;
  const full = join(OUT_ROOT, dir, name);
  await mkdir(join(full, ".."), { recursive: true });
  const started = Date.now();
  // JPEG for filmstrip frames: there are 12 of them and they exist to be flipped
  // through, not to have 11px log glyphs read off them.
  await page.screenshot({ path: full, type: "jpeg", quality: 70 });
  const frame = join(dir, name);
  FINDINGS.push(
    ...(await auditFrame(page, {
      page: `motion:${motionId}`,
      theme,
      viewport,
      frame,
    })),
  );
  FRAMES.push({
    path: frame,
    bytes: 0,
    ms: Date.now() - started,
    theme,
    viewport,
    page: `motion:${motionId}`,
    state: `motion ${motionId} @ ${sample}`,
    ...(seeked !== undefined ? { seeked } : {}),
  });
}

// --- provenance, counts, contact sheets ----------------------------------

test("the captures came from this project's own browser", async () => {
  // Launched rather than assumed, so the recorded version is the one that
  // actually rendered the frames in this worker. A version read from a config
  // would be a claim; this is a measurement.
  const browser = await chromium.launch();
  BROWSER = {
    version: browser.version(),
    executablePath: PROVENANCE.executablePath,
  };
  await browser.close();

  expect(BROWSER.executablePath.startsWith(`${PROVENANCE.root}/`)).toBe(true);
});

test.afterAll(async () => {
  // One part per *worker*, not per project. With `fullyParallel` a project runs
  // several workers, and a part named after the project made each of them
  // overwrite the last — so the manifest described one worker's frames while the
  // report claimed 300, and the shortfall was invisible. Teardown concatenates
  // every part it finds, so the worker index belongs in the filename.
  const { project, workerIndex } = test.info();
  await mkdir(PARTS_DIR, { recursive: true });
  await writeFile(
    resolve(PARTS_DIR, partFileName(project.name, workerIndex)),
    JSON.stringify(
      {
        project: project.name,
        workerIndex,
        viewport: project.use.viewport,
        userAgent: project.use.userAgent,
        browser: BROWSER,
        frames: FRAMES,
        findings: FINDINGS,
      },
      null,
      2,
    ),
  );
});

// --- small helpers -------------------------------------------------------

function slug(path: string): string {
  const cleaned = path.replace(/^\//, "").replace(/[/:]/g, "-").replace(/^-/, "");
  return cleaned === "" ? "home" : cleaned;
}

function scrollName(fraction: number): string {
  return `scroll-${String(fraction).replace(".", "")}.png`;
}
