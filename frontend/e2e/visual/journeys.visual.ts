import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium, expect, test, type Page } from "@playwright/test";

import { CHALLENGES, TEST_USER, WRONG_PASSWORD } from "../data";
import {
  APP_ORIGIN,
  guardOrigins,
  park,
  sweepApi,
  sweepSubmission,
} from "./fixtures";
import { auditFrame, type Finding } from "./helpers/audit";
import { waitForTextSettled } from "./helpers/motion";
import { checkBrowserProvenance, SANDBOX_BROWSER_ROOT } from "./helpers/provenance";
import {
  OUT_ROOT,
  PARTS_DIR,
  partFileName,
  type SweepBrowser,
  type SweepFrame,
} from "./manifest";
import type { SweepTheme, SweepViewport } from "./routes";

/**
 * The journey audit: interactive flows, photographed step by step.
 *
 * The sweep (`sweep.visual.ts`) photographs every route at rest. Journeys are
 * the other half of a visual review: the *transitions* between those states —
 * a nav click that leaves the reader at the bottom of the next page, a login
 * that never explains its error, a create form whose result never appears in
 * the list, a provider switch that silently drops the API key.
 *
 * Nothing here is a gate. Like the sweep, it is a review aid: every capture is
 * an honest picture of a real interaction, and the report
 * (`docs/ux-audit/REPORT.md`) is where what the pictures show becomes a plan.
 * A journey *fails* loudly (assertion) rather than shipping a screenshot of a
 * broken state that looks intentional — the same rule the sweep applies to
 * headings.
 *
 * Cost control:
 *
 * - Runs are gitignored under `frontend/visual-sweeps/<run>/`, like the sweep.
 *   `make visual-journeys` starts a fresh run id; the cap for *committed*
 *   evidence is a handful of downscaled frames in `docs/ux-audit/evidence/`,
 *   chosen by hand after the run.
 * - Animation moments are filmed as short, low-fps, low-res WebM clips (VP8),
 *   not as frame-perfect PNGs: the point of the clip is the transition, not
 *   the 11px log glyph, and the budget is bytes.
 * - `VISUAL_JOURNEYS=1` is the whole gate: without it every test is skipped,
 *   so `make visual-sweep` and the lock runs keep their exact frame/finding
 *   footprint (they only gain skipped tests).
 */

const JOURNEYS = process.env.VISUAL_JOURNEYS === "1";

// Browser provenance, resolved once, exactly like the sweep: nothing to report
// if the pictures did not come from the project's own pinned Chromium.
const PROVENANCE = checkBrowserProvenance(chromium.executablePath());

/** One captured moment; the manifest's own frame type, used as-is. */
type FrameMeta = {
  theme: SweepTheme;
  viewport: SweepViewport;
  page: string;
  state: string;
};

/** Per-worker records, written out by `afterAll` and merged by the teardown. */
const FRAMES: Array<SweepFrame & { theme: SweepTheme; viewport: SweepViewport }> = [];
const FINDINGS: Finding[] = [];
let BROWSER: SweepBrowser | null = null;

// --- capture primitives ----------------------------------------------------

/** A still frame: PNG (readable text) + the accessibility audit at that instant. */
async function captureJ(page: Page, file: string, meta: FrameMeta): Promise<void> {
  const full = resolve(OUT_ROOT, file);
  mkdirSync(join(full, ".."), { recursive: true });
  const started = Date.now();
  const buffer = await page.screenshot({ path: full });
  FINDINGS.push(
    ...(await auditFrame(page, {
      page: meta.page,
      theme: meta.theme,
      viewport: meta.viewport,
      frame: file,
    })),
  );
  FRAMES.push({
    path: file,
    theme: meta.theme,
    viewport: meta.viewport,
    page: meta.page,
    state: meta.state,
    bytes: buffer.byteLength,
    ms: Date.now() - started,
  });
}

/**
 * A burst of JPEG frames from a moving moment. Returns the file names.
 *
 * Every burst is also recorded in the manifest (like the sweep's filmstrips)
 * and then re-encoded into one small WebM by `webmJ` when the moment matters
 * enough to move.
 */
async function burstJ(
  page: Page,
  dir: string,
  count: number,
  intervalMs: number,
  meta: FrameMeta,
): Promise<string[]> {
  const frames: string[] = [];
  const started = Date.now();
  for (let i = 0; i < count; i += 1) {
    const name = `anim-${String(i + 1).padStart(2, "0")}.jpg`;
    const full = resolve(OUT_ROOT, dir, name);
    mkdirSync(dirname(full), { recursive: true });
    await page.screenshot({ path: full, type: "jpeg", quality: 72 });
    const frame = join(dir, name);
    FINDINGS.push(
      ...(await auditFrame(page, {
        page: `webm:${meta.page}`,
        theme: meta.theme,
        viewport: meta.viewport,
        frame,
      })),
    );
    FRAMES.push({
      path: frame,
      theme: meta.theme,
      viewport: meta.viewport,
      page: `webm:${meta.page}`,
      state: `${meta.state} ${i + 1}/${count}`,
      bytes: statSync(full).size,
      ms: Date.now() - started,
    });
    frames.push(frame);
    if (i < count - 1) await page.waitForTimeout(intervalMs);
  }
  return frames;
}

/**
 * Assemble the `anim-*.jpg` frames in `dir` into a low-fps VP8 WebM.
 *
 * The Playwright ffmpeg fork ships the `image2pipe` *demuxer* but not the
 * `image2` demuxer — it can feed JPEGs from a byte stream, not from a
 * `anim-%02d.jpg` file glob. So the frames are concatenated into one stream
 * and the demuxer is told the codec explicitly.
 */
async function webmJ(
  dir: string,
  id: string,
  meta: FrameMeta,
  opts: { fps?: number; width?: number } = {},
): Promise<string> {
  const { fps = 8, width = 800 } = opts;
  const dirAbs = resolve(OUT_ROOT, dir);
  const ffmpeg = resolveFfmpeg();
  const jpgs = readdirSync(dirAbs)
    .filter((f) => /^anim-\d+\.jpg$/.test(f))
    .sort();
  if (jpgs.length === 0) throw new Error(`no anim frames under ${dirAbs}`);
  const framesBin = join(dirAbs, `${id}.frames.bin`);
  writeFileSync(
    framesBin,
    Buffer.concat(jpgs.map((f) => readFileSync(join(dirAbs, f)))),
  );
  const out = resolve(dirAbs, `${id}.webm`);
  try {
    execFileSync(
      ffmpeg,
      [
        "-y",
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-framerate",
        String(fps),
        "-i",
        framesBin,
        "-vf",
        `scale=${width}:-2`,
        "-c:v",
        "libvpx",
        "-b:v",
        "400k",
        "-pix_fmt",
        "yuv420p",
        "-auto-alt-ref",
        "0",
        "-loglevel",
        "error",
        out,
      ],
      { stdio: "pipe" },
    );
  } finally {
    rmSync(framesBin, { force: true });
  }
  FRAMES.push({
    path: join(dir, `${id}.webm`),
    theme: meta.theme,
    viewport: meta.viewport,
    page: `webm:${meta.page}`,
    state: `${id} — ${meta.state}`,
    bytes: statSync(out).size,
    ms: 0,
  });
  return out;
}

/** The ffmpeg bundle next to the pinned Chromium. */
function resolveFfmpeg(): string {
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH)
      ? process.env.PLAYWRIGHT_BROWSERS_PATH
      : SANDBOX_BROWSER_ROOT;
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith("ffmpeg-"))
    .sort();
  if (dirs.length === 0) throw new Error(`no ffmpeg bundle under ${root}`);
  const bin = join(root, dirs[dirs.length - 1], "ffmpeg-linux");
  if (!existsSync(bin)) throw new Error(`no ffmpeg binary at ${bin}`);
  return bin;
}

function dirname(p: string): string {
  return join(p, "..");
}

/** Begin a journey: theme first, then the route, then prove both landed. */
async function beginJourney(page: Page, theme: SweepTheme, path: string): Promise<void> {
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
  await page.goto(`${APP_ORIGIN}${path}`, { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await waitForTextSettled(page);
}

/**
 * Own the `/api/challenges` namespace for the create-flow journey: the e2e
 * mock's list never shows what its POST created, which is exactly the
 * "does my creation appear in the list" transition a journey is for — so this
 * handler serves a list that includes created challenges and answers their
 * detail reads. Everything else falls through to the base mocks.
 *
 * One glob, branched on pathname, because the glob must span the whole
 * namespace — list, POST, and the detail read that follows a create — and
 * a trailing star does not cross a slash, so only a doubled star (matching
 * everything, `/` included) can cover all three shapes at once. Same shape
 * as the `/api/submissions**` handler in the fixtures.
 */
async function challengeCreateNamespace(page: Page): Promise<void> {
  const created: Array<Record<string, unknown>> = [];
  await page.route("**/api/challenges**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === "/api/challenges") {
      if (method === "GET") {
        const items = [...created, ...CHALLENGES];
        return route.fulfill({
          status: 200,
          json: {
            items,
            total: items.length,
            page: 1,
            page_size: 20,
            pages: 1,
          },
        });
      }
      if (method === "POST") {
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        const challenge = {
          ...body,
          id: `c-created-${created.length + 1}`,
          owner_id: TEST_USER.id,
          created_at: "2026-02-05T09:00:00Z",
          updated_at: "2026-02-05T09:00:00Z",
        };
        created.push(challenge);
        return route.fulfill({ status: 201, json: challenge });
      }
      return route.fallback();
    }
    if (pathname.startsWith("/api/challenges/")) {
      const id = pathname.slice("/api/challenges/".length);
      const found =
        created.find((c) => c.id === id) ?? CHALLENGES.find((c) => c.id === id);
      if (found) return route.fulfill({ status: 200, json: found });
    }
    return route.fallback();
  });
}

// --- at rest: interaction states, with the app's own reduced-motion path -----

const gate = JOURNEYS ? test.describe : test.describe.skip;
gate("journey audit — at rest", () => {
  test.use({ reducedMotion: "reduce" });

  test("nav click-through works for a guest", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "guest" });

    await beginJourney(page, theme, "/");
    await expect(
      page.getByRole("heading", {
        name: "Generate, execute, and evaluate AI-written code — automatically",
        level: 1,
      }),
    ).toBeVisible();
    await captureJ(page, "journeys/guest-nav/01-home.png", {
      theme, viewport, page: "guest-nav", state: "Home hero",
    });

    let step = 2;
    for (const [label, heading] of [
      ["Features", "Features"],
      ["Demo", "See how it works"],
      ["Challenges", "Challenges"],
    ] as const) {
      await page.locator("header").getByRole("link", { name: label, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, level: 1 }),
      ).toBeVisible();
      await waitForTextSettled(page);
      await captureJ(
        page,
        `journeys/guest-nav/${String(step).padStart(2, "0")}-${label.toLowerCase()}.png`,
        { theme, viewport, page: "guest-nav", state: `After nav → ${label}` },
      );
      step += 1;
    }
  });

  test("nav preserves scroll position on SPA navigation", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "guest" });

    await beginJourney(page, theme, "/features");
    await expect(page.getByRole("heading", { name: "Features", level: 1 })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
    const atBottom = await page.evaluate(() => window.scrollY);
    testInfo.annotations.push({ type: "scroll", description: `features bottom: scrollY=${atBottom}` });
    await captureJ(page, "journeys/scroll-nav-loss/01-features-bottom.png", {
      theme, viewport, page: "scroll-nav-loss", state: `Scrolled to bottom (scrollY=${atBottom})`,
    });

    await page.locator("header").getByRole("link", { name: "Pricing", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Simple, transparent pricing", level: 1 }),
    ).toBeVisible();
    await waitForTextSettled(page);
    const after = await page.evaluate(() => window.scrollY);
    testInfo.annotations.push({ type: "scroll", description: `pricing after nav: scrollY=${after}` });
    await captureJ(page, "journeys/scroll-nav-loss/02-pricing-after-nav.png", {
      theme, viewport, page: "scroll-nav-loss", state: `After nav (scrollY=${after})`,
    });

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Features", level: 1 })).toBeVisible();
    const backed = await page.evaluate(() => window.scrollY);
    testInfo.annotations.push({ type: "scroll", description: `features after back: scrollY=${backed}` });
    await captureJ(page, "journeys/scroll-nav-loss/03-features-after-back.png", {
      theme, viewport, page: "scroll-nav-loss", state: `After browser back (scrollY=${backed})`,
    });

    // Recorded, not asserted: whether these numbers are correct is the finding.
  });

  test("login explains its error and lands on the account", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "guest" });

    await beginJourney(page, theme, "/login");
    await expect(page.getByRole("heading", { name: "Welcome back", level: 1 })).toBeVisible();

    await page.getByLabel("Email or username").fill("tester@example.com");
    await page.getByLabel("Password").fill(WRONG_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Incorrect identifier or password");
    await captureJ(page, "journeys/login-logout/01-wrong-password.png", {
      theme, viewport, page: "login-logout", state: "Wrong password — inline error",
    });

    await page.getByLabel("Password").fill("hunter2hunter2");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Challenges", level: 1 })).toBeVisible();
    await waitForTextSettled(page);
    await captureJ(page, "journeys/login-logout/02-signed-in.png", {
      theme, viewport, page: "login-logout", state: "Signed in — challenges grid",
    });

    await page.getByRole("button", { name: /tester/i }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    // `Log in` exists twice in the DOM (desktop actions + the hidden mobile
    // menu copy), so the guest-shell proof is scoped to the first match.
    await expect(page.getByRole("link", { name: "Log in", exact: true }).first()).toBeVisible();
    await waitForTextSettled(page);
    await captureJ(page, "journeys/login-logout/03-after-logout.png", {
      theme, viewport, page: "login-logout", state: `After log out — guest shell (${page.url()})`,
    });
  });

  test("register shows password guidance and lands on challenges", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "guest" });

    await beginJourney(page, theme, "/register");
    await expect(
      page.getByRole("heading", { name: "Create your account", level: 1 }),
    ).toBeVisible();

    await page.getByLabel("Password").fill("12345");
    await expect(page.getByText("Use at least 8 characters")).toBeVisible();
    await captureJ(page, "journeys/register-validation/01-weak-password.png", {
      theme, viewport, page: "register-validation", state: "Weak password — live hint",
    });

    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForTimeout(250);
    await captureJ(page, "journeys/register-validation/02-submit-blocked.png", {
      theme, viewport, page: "register-validation", state: "Submit blocked — invalid fields",
    });

    await page.getByLabel("Email").fill("newbie@example.com");
    await page.getByLabel("Username").fill("newbie42");
    await page.getByLabel("Password").fill("hunter2hunter2");
    await expect(page.getByText("Password looks good")).toBeVisible();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("heading", { name: "Challenges", level: 1 })).toBeVisible();
    await captureJ(page, "journeys/register-validation/03-created.png", {
      theme, viewport, page: "register-validation", state: "Account created — welcome toast",
    });
  });

  test("creating a challenge flows into the detail and the list", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "user" });
    await challengeCreateNamespace(page);

    await beginJourney(page, theme, "/challenges/new");
    await expect(
      page.getByRole("heading", { name: "Create a challenge", level: 1 }),
    ).toBeVisible();
    await captureJ(page, "journeys/create-challenge/01-empty-form.png", {
      theme, viewport, page: "create-challenge", state: "Empty create form",
    });

    await page.getByLabel("Title").fill("Valid Parentheses");
    await page.getByLabel("Description").fill("Checks that a string of brackets closes properly.");
    await page.getByLabel("Prompt for the LLM").fill(
      "Write a function isValid(s) that returns True when the bracket string is balanced.",
    );
    await captureJ(page, "journeys/create-challenge/02-filled-form.png", {
      theme, viewport, page: "create-challenge", state: "Filled create form",
    });

    await page.getByRole("button", { name: "Create challenge" }).click();
    await expect(page.getByRole("heading", { name: "Valid Parentheses", level: 1 })).toBeVisible();
    await waitForTextSettled(page);
    await captureJ(page, "journeys/create-challenge/03-created-detail.png", {
      theme, viewport, page: "create-challenge", state: "Created challenge — detail",
    });

    // `Challenges` is also a breadcrumb on the create form, so scope to the header.
    await page.locator("header").getByRole("link", { name: "Challenges", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Challenges", level: 1 })).toBeVisible();
    await expect(page.getByText("Valid Parentheses", { exact: true })).toBeVisible();
    await waitForTextSettled(page);
    await captureJ(page, "journeys/create-challenge/04-list-refreshes.png", {
      theme, viewport, page: "create-challenge", state: "List reflects the new challenge",
    });
  });

  test("provider picker shows keys for hosted providers and none for local ones", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "user" });

    await beginJourney(page, theme, "/challenges/c-easy-1");
    await expect(page.getByRole("heading", { name: "Two Sum", level: 1 })).toBeVisible();
    await captureJ(page, "journeys/provider-picker/01-demo-default.png", {
      theme, viewport, page: "provider-picker", state: "Default — demo (free, no key)",
    });

    await page.getByRole("radio", { name: /^OpenAI/ }).check();
    await expect(page.getByPlaceholder("Your OpenAI API key")).toBeVisible();
    await captureJ(page, "journeys/provider-picker/02-openai-key.png", {
      theme, viewport, page: "provider-picker", state: "OpenAI — API key required",
    });

    // Ollama has no fixture models, so the selector hides for it; the catalog
    // capture belongs to a hosted provider, where the models exist.
    await expect(page.getByLabel("Model")).toBeVisible();
    await page.getByLabel("Model").click();
    await captureJ(page, "journeys/provider-picker/05-model-catalog.png", {
      theme, viewport, page: "provider-picker", state: "Model catalog (openai)",
    });

    await page.getByRole("radio", { name: /^Groq/ }).check();
    await expect(page.getByPlaceholder("Your Groq API key")).toBeVisible();
    await captureJ(page, "journeys/provider-picker/03-groq-key.png", {
      theme, viewport, page: "provider-picker", state: "Groq — API key required",
    });

    await page.getByRole("radio", { name: /^Ollama/ }).check();
    await expect(page.getByPlaceholder("Your OpenAI API key")).toHaveCount(0);
    await captureJ(page, "journeys/provider-picker/04-ollama-nokey.png", {
      theme, viewport, page: "provider-picker", state: "Ollama (local) — no key",
    });
  });

  test("admin navigation reaches every admin surface", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "dark" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "admin" });

    await beginJourney(page, theme, "/admin");
    await expect(
      page.getByRole("heading", { name: "Admin dashboard", level: 1 }),
    ).toBeVisible();
    await captureJ(page, "journeys/admin-nav/01-dashboard.png", {
      theme, viewport, page: "admin-nav", state: "Admin dashboard (dark)",
    });

    await page.getByRole("link", { name: "Manage users", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    await waitForTextSettled(page);
    await expect(page).toHaveURL(/\/admin\/users$/);
    await captureJ(page, "journeys/admin-nav/02-users.png", {
      theme, viewport, page: "admin-nav", state: "Admin → users",
    });

    await beginJourney(page, theme, "/admin");
    await expect(
      page.getByRole("heading", { name: "Admin dashboard", level: 1 }),
    ).toBeVisible();
    await page.getByRole("link", { name: "View submissions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Submissions", level: 1 })).toBeVisible();
    await waitForTextSettled(page);
    await expect(page).toHaveURL(/\/admin\/submissions$/);
    await captureJ(page, "journeys/admin-nav/03-submissions.png", {
      theme, viewport, page: "admin-nav", state: "Admin → submissions",
    });
  });
});

// --- live: transitions that only exist with motion on -----------------------

gate("journey audit — live", () => {
  test("theme switch and its cross-fade", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "guest" });

    await beginJourney(page, theme, "/features");
    const meta = { theme, viewport, page: "theme-crossfade" } as const;
    await captureJ(page, "journeys/theme-crossfade/01-light.png", {
      ...meta, state: "Light theme (features)",
    });

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    const darkBurst = join("journeys", "theme-crossfade");
    await burstJ(page, darkBurst, 5, 120, { ...meta, state: "theme → dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await waitForTextSettled(page);
    await captureJ(page, "journeys/theme-crossfade/02-dark.png", {
      ...meta, state: "Dark theme (features)",
    });

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await burstJ(page, darkBurst, 5, 120, { ...meta, state: "theme → light (second burst)" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await waitForTextSettled(page);
    await captureJ(page, "journeys/theme-crossfade/03-light-again.png", {
      ...meta, state: "Back to light",
    });

    await webmJ(darkBurst, "theme-crossfade", { ...meta, state: "dark ⇄ light" });
  });

  test("mobile menu slides in and navigates", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "pixel-7", "pixel-7 device journey");
    const theme = "dark" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "guest" });

    await beginJourney(page, theme, "/features");
    const meta = { theme, viewport, page: "mobile-nav" } as const;
    await captureJ(page, "journeys/mobile-nav/01-menu-closed.png", {
      ...meta, state: "Mobile — menu closed",
    });

    await page.getByRole("button", { name: "Toggle navigation" }).click();
    const dir = join("journeys", "mobile-nav");
    await burstJ(page, dir, 6, 90, { ...meta, state: "menu slide-in" });
    await captureJ(page, "journeys/mobile-nav/02-menu-open.png", {
      ...meta, state: "Mobile — menu open",
    });

    await page.locator("header").getByRole("link", { name: "About", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "About this project", level: 1 }),
    ).toBeVisible();
    await waitForTextSettled(page);
    await captureJ(page, "journeys/mobile-nav/03-about.png", {
      ...meta, state: "About — reached from the mobile menu",
    });
    await webmJ(dir, "mobile-nav", { ...meta, state: "menu slide-in" });
  });

  test("submit spinner, then the toast life cycle on the profile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "user" });

    await beginJourney(page, theme, "/profile");
    await expect(page.getByRole("heading", { name: "tester", level: 1 })).toBeVisible();
    const meta = { theme, viewport, page: "profile-toast" } as const;

    const gate = park(page, "**/api/auth/change-password", {
      json: { detail: "Password updated" },
    });
    await page.getByLabel("Current password").fill("hunter2hunter2");
    await page.getByLabel("New password", { exact: true }).fill("newpassword123");
    await page.getByLabel("Confirm new password", { exact: true }).fill("newpassword123");
    const dir = join("journeys", "profile-toast");
    await page.getByRole("button", { name: "Update password" }).click();
    await burstJ(page, dir, 6, 120, { ...meta, state: "submit loading (parked)" });
    gate.release();

    const toast = page.getByText("Password updated successfully.", { exact: true });
    await expect(toast).toBeVisible();
    await captureJ(page, "journeys/profile-toast/01-toast-visible.png", {
      ...meta, state: "Toast visible",
    });

    await burstJ(page, dir, 30, 150, { ...meta, state: "toast auto-dismiss (5s)" });
    await expect(toast).toHaveCount(0, { timeout: 4000 });
    await captureJ(page, "journeys/profile-toast/02-toast-gone.png", {
      ...meta, state: "Toast dismissed",
    });

    await webmJ(dir, "submit-loading", { ...meta, state: "spinner + toast" }, { fps: 8, width: 640 });
  });

  test("submissions skeleton resolves into the report", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "pixel-7", "desktop journey");
    const theme = "light" as const;
    const viewport = testInfo.project.name as SweepViewport;
    await guardOrigins(page.context());
    await sweepApi(page, { auth: "user" });

    await beginJourney(page, theme, "/challenges");
    const meta = { theme, viewport, page: "submit-skeleton" } as const;

    const gate = park(page, "**/api/submissions/sweep-submission", {
      json: sweepSubmission("sweep-submission"),
    });
    const dir = join("journeys", "submit-skeleton");
    await page.goto(`${APP_ORIGIN}/submissions/sweep-submission`, { waitUntil: "load" });
    // The route Suspense fallback and the in-page skeleton both use role=status,
    // so name the one that means the data fetch is pending.
    await expect(page.getByRole("status", { name: "Loading submission" })).toBeVisible();
    await burstJ(page, dir, 6, 150, { ...meta, state: "skeleton while the report loads" });
    gate.release();

    await expect(
      page.getByRole("heading", { name: "Evaluation report", level: 1 }),
    ).toBeVisible();
    await waitForTextSettled(page);
    await captureJ(page, "journeys/submit-skeleton/01-report-content.png", {
      ...meta, state: "Content after the skeleton",
    });
    await webmJ(dir, "skeleton-loading", { ...meta, state: "skeleton → content" });
  });
});

// --- provenance, records ----------------------------------------------------

gate("journey audit — provenance", () => {
  test("the captures came from this project's own browser", async () => {
    const browser = await chromium.launch();
    BROWSER = { version: browser.version(), executablePath: PROVENANCE.executablePath };
    await browser.close();
    expect(BROWSER.executablePath.startsWith(`${PROVENANCE.root}/`)).toBe(true);
  });
});

test.afterAll(async () => {
  const { project, workerIndex } = test.info();
  mkdirSync(PARTS_DIR, { recursive: true });
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