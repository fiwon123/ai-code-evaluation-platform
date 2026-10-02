import { expect, test, type Page } from "@playwright/test";

import { mockApi } from "./data";

/**
 * The ambient layer actually running, named (issue #366).
 *
 * The defect this locks was invisible to every other check: the build was
 * clean, the screenshots looked right, and the stylesheet still said
 * `animation: auroraDrift`. A CSS module rewrites the *reference* to a scoped
 * name but leaves a `@keyframes` declared in an unscoped sheet alone, so the
 * element ended up naming a keyframes rule that did not exist and simply never
 * moved. `document.getAnimations()` is the only assertion that catches that,
 * because it reports what the engine actually started: a name that resolves to
 * nothing is absent, while a screenshot cannot tell a still blob from a
 * drifting one and a source-level regex cannot see the rename the build did.
 *
 * Deliberately asserting on *named* animations rather than a count. "Some
 * animation is running" was true on every affected page — the hero has a grid
 * pan and floating fragments — which is exactly how four families of dead
 * motion survived a full visual sweep.
 */

/** One page's expectation: how many instances of each animation must run. */
const EXPECTED: {
  name: string;
  url: string;
  /**
   * Minimum running instances per named animation.
   *
   * A count rather than a boolean, because the three hero blobs share one
   * keyframe: `auroraDrift: true` would still pass if one of the three had been
   * dropped from the markup.
   */
  instances: Record<string, number>;
  /**
   * What to wait for before sampling.
   *
   * Sampling on `load` is a trap: the app renders a spinner while its fixtures
   * are in flight, so an earlier version of this spec read the landing page at
   * `load`, found only the spinner's animation, and reported that no ambient
   * motion existed anywhere. The assertion has to be made against the settled
   * page, not the loading one.
   */
  ready: string;
  /**
   * Whether to sign in first.
   *
   * The sign-in pages have to be visited as a guest: authenticated, `/login`
   * redirects to `/challenges`, so the spec was reading the challenges list and
   * reporting its animations under the auth backdrop's name.
   */
  auth: boolean;
  /**
   * Names deliberately hidden on a narrow viewport.
   *
   * `scanline` is `display: none` below 768px (it overlays the animated terminal
   * panel, which the mobile layout does not show), so asserting it on the Pixel
   * 7 project was asserting against a rule that removes the element on purpose.
   * A test that fails because the design is responsive is a test that gets
   * deleted, so the exemption is written down here instead.
   */
  desktopOnly?: string[];
}[] = [
  {
    // Three hero blobs, each re-timed, plus the terminal panel's travelling
    // line and the CTA bar's gradient — the last being a locally declared
    // keyframe, because `composes` needs a class and `.cta::before` is a
    // pseudo-element.
    name: "landing hero",
    url: "/",
    instances: {
      auroraDrift: 3,
      scanline: 1,
      gradientShift: 1,
      // The pipeline timeline (#353). These were missing here entirely, which is
      // how the old timing survived: `pipelineActivate` lit each card in the
      // *next* step's slice and nothing noticed, because nothing had ever asked
      // whether the keyframes ran or how many of them there should be. Counting
      // them locks both — five cards share one keyframe, so a boolean would pass
      // with a step dropped from the markup, and the bar is a fourth name that
      // has to keep resolving after the rename.
      pipelineStepActive: 5,
      connectorFlow: 4,
      progressStages: 1,
    },
    ready: "h1",
    auth: true,
    desktopOnly: ["scanline"],
  },
  {
    // The auth backdrop. Before the fix this page ran *nothing* at all, which
    // made it the cleanest proof: no unrelated motion to hide behind.
    name: "sign-in backdrop",
    url: "/login",
    instances: { auroraDrift: 3 },
    ready: "h1",
    auth: false,
  },
  {
    name: "register backdrop",
    url: "/register",
    instances: { auroraDrift: 3 },
    ready: "h1",
    auth: false,
  },
  { name: "demo backdrop", url: "/demo", instances: { auroraDrift: 2 }, ready: "h1", auth: true },
  {
    // A one-shot entrance, and `fill: both` is what makes this reliable to
    // assert: a finished animation with a fill is still reported by
    // `getAnimations()`, so this does not race a 0.6s duration. The page renders
    // identically with or without it, so nothing else here would notice.
    name: "create-challenge entrance",
    url: "/challenges/new",
    instances: { fadeInUp: 1 },
    ready: "h1",
    auth: true,
  },
];

/**
 * Named CSS animations the engine is currently running, by authored name.
 *
 * Vite reports the *scoped* name — `_auroraDrift_cx4bc_1`, not `auroraDrift` —
 * because that is the name the reference was rewritten to. Reducing it back to
 * the authored name is what makes these assertions readable, and a scoped name
 * coming back at all is itself the evidence: the bug in #366 produced a scoped
 * *reference* with no matching definition, and therefore no animation whatsoever.
 */
async function runningAnimations(page: import("@playwright/test").Page) {
  const raw = await page.evaluate(() => {
    const names: string[] = [];
    for (const anim of document.getAnimations()) {
      // `animationName` is absent on transitions; those are not what is being
      // asserted and counting them would dilute the signal.
      const name = (anim as unknown as { animationName?: string }).animationName;
      if (name) names.push(name);
    }
    return names;
  });

  const counts: Record<string, number> = {};
  for (const scoped of raw) {
    const authored = /^_(.+?)_[a-z0-9]+_\d+$/.exec(scoped)?.[1] ?? scoped;
    counts[authored] = (counts[authored] ?? 0) + 1;
  }
  return counts;
}

test.describe("ambient motion", () => {
  for (const spec of EXPECTED) {
    test(`${spec.name} runs its named ambient animations`, async ({ page }) => {
      // Signed in unless the spec says otherwise: a guest is shown the sign-in
      // wall on most routes, which has no hero to animate and would pass for the
      // wrong reason.
      await mockApi(page, undefined, { auth: spec.auth });
      await page.goto(spec.url);
      await expect(page.locator(spec.ready).first()).toBeVisible();

      const running = await runningAnimations(page);
      const narrow = (page.viewportSize()?.width ?? 0) <= 768;
      const found = Object.keys(running).join(", ") || "no named animations at all";

      for (const [name, wanted] of Object.entries(spec.instances)) {
        if (narrow && spec.desktopOnly?.includes(name)) continue;
        const count = running[name] ?? 0;
        expect(
          count,
          `\`${name}\` runs ${count} time(s) on ${spec.url}, wanted ${wanted}+ — found: ${found}`,
        ).toBeGreaterThanOrEqual(wanted);
      }
    });
  }

  /**
   * The blobs must be *moving*, not merely registered — a paused or
   * `fill: backwards` animation satisfies the name check above. Sampling the
   * computed transform twice and requiring a difference catches an animation
   * that exists but is stuck, which is the same silent failure one step along.
   */
  test("the hero blobs actually move", async ({ page }) => {
    await mockApi(page, undefined, { auth: true });
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeVisible();

    const sampled = await page.evaluate(async () => {
      // Match on the authored name, since the engine reports the scoped one.
      const drifting = document.getAnimations().filter((a) =>
        /^_?auroraDrift_[a-z0-9]+_\d+$/.test(
          (a as unknown as { animationName?: string }).animationName ?? "",
        ),
      );
      const read = () =>
        drifting.map((a) =>
          getComputedStyle((a.effect as KeyframeEffect).target as Element).transform,
        );
      const first = read();
      // A real sample interval. Shorter and a paused animation could pass.
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { first, second: read() };
    });

    expect(sampled.first.length, "no auroraDrift animations to sample").toBeGreaterThan(0);
    expect(
      sampled.second,
      "the blobs are registered but their transform never changes",
    ).not.toEqual(sampled.first);
  });

  /**
   * Reduced motion has to actually stop them. The opt-out now ships with the
   * composed class in `ambient.css`, so this is also the check that a module
   * composing it cannot have its own `animation` shorthand outrank it.
   *
   * Measured as a before/after on one page rather than in isolation, because
   * "no animations are running" is trivially true of a page whose animations
   * never started. Asserting the zero alone therefore passed against the exact
   * pre-fix code this issue is about — the blobs were dead, so there was nothing
   * to stop. The `no-preference` half makes the reduced half mean something:
   * there is motion to remove.
   */
  test("stops the hero blobs when reduced motion is requested", async ({
    page,
  }) => {
    await mockApi(page, undefined, { auth: true });

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeVisible();
    const before = await runningAnimations(page);
    expect(
      before["auroraDrift"] ?? 0,
      "nothing to stop: auroraDrift does not run even with motion welcome, " +
        "so this test would pass for the wrong reason",
    ).toBeGreaterThan(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    // A fresh document, since flipping the media setting alone need not restart
    // the stylesheet's animation bookkeeping on an already-loaded page.
    await page.reload();
    await expect(page.locator("h1").first()).toBeVisible();

    const after = await runningAnimations(page);
    expect(
      after["auroraDrift"] ?? 0,
      "auroraDrift is still running under prefers-reduced-motion: reduce",
    ).toBe(0);
  });
});

/**
 * The Features entrance (#351).
 *
 * A one-shot, staggered reveal on ten elements, and the only entrance in the app
 * that is gated on `prefers-reduced-motion` — so it needs both halves of the
 * argument the suite makes about the hero, and one extra.
 *
 * It is *not* in the `EXPECTED` table above because that samples once after the
 * page settles, and this one cannot be sampled then. It is declared
 * `animation-fill-mode: backwards`, deliberately (see the note in
 * `Features.module.css`), which means a finished animation is no longer reported
 * by `getAnimations()`. The `fill: both` entry above can be sampled late only
 * because a forward fill keeps it enumerable. So this samples *during* the
 * window instead, which is the stronger assertion anyway: it proves motion
 * happened, not that a fill exists.
 */
test.describe("features entrance", () => {
  /** 5 pipeline steps + 4 feature rows + 1 CTA. */
  const ELEMENTS = 10;

  const REVEAL_SOURCE = new RegExp("^_?featureReveal_[a-z0-9]+_\\d+$").source;

  /**
   * Whether the entrance is running, as a page predicate.
   *
   * The regex is rebuilt inside the page from its source string, because a
   * `RegExp` cannot cross the boundary — passing the object itself and calling
   * `.test()` on it in the page throws, and `waitForFunction` then reports only
   * a timeout, which reads exactly like "the animation never ran". That is the
   * failure this whole suite exists to detect, so it must not be one of its own
   * ways of failing.
   */
  const revealIsRunning = (src: string) =>
    document
      .getAnimations()
      .some((a) =>
        new RegExp(src).test(
          (a as unknown as { animationName?: string }).animationName ?? "",
        ),
      );

  async function waitForReveal(page: Page) {
    await page.waitForFunction(revealIsRunning, REVEAL_SOURCE, {
      timeout: 10_000,
    });
  }

  test("runs the staggered reveal while the page settles", async ({ page }) => {
    await mockApi(page, undefined, { auth: false });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // Before the navigation, and after the media emulation: a `reducedMotion`
    // setting applied to a loaded page need not restart the stylesheet's
    // animation bookkeeping, so the reveal would be opted out on a page that
    // had already read it.
    await page.goto("/features");
    // Polled on animation frames, so it cannot step over the window: the reveal
    // runs 0.55s and the last element is still waiting out a 440ms delay, which
    // is ~60 frames of opportunity.
    await waitForReveal(page);

    const running = await runningAnimations(page);
    expect(
      running["featureReveal"] ?? 0,
      `featureReveal runs ${running["featureReveal"] ?? 0} time(s) on /features, ` +
        `wanted ${ELEMENTS}+ — found: ${Object.keys(running).join(", ") || "none"}`,
    ).toBeGreaterThanOrEqual(ELEMENTS);
  });

  test("hands the transform back once it finishes", async ({ page }) => {
    // The reason the fill is `backwards` and not `both`. A forward fill keeps
    // applying the last frame's `transform: translateY(0)` forever, and an
    // animated value outranks a normal declaration in the cascade — so
    // `.featureRow:hover { transform: translateY(-2px) }` would be silently
    // overridden and the lift would never happen. Nothing about the page would
    // look broken, so this is asserted rather than left to review.
    await mockApi(page, undefined, { auth: false });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/features");
    await expect(page.locator("h1").first()).toBeVisible();
    // The premise, then the wait: the reveal has to have run for "it stopped
    // running" to mean anything, and waiting on its *absence* is the state that
    // proves the fill has been given up. Sleeping out the duration instead
    // would be a claim about the machine's speed, and `no-wall-clock-sleeps`
    // is right about that (#340).
    await waitForReveal(page);
    await page.waitForFunction(
      (src) =>
        !document
          .getAnimations()
          .some((a) =>
            new RegExp(src).test(
              (a as unknown as { animationName?: string }).animationName ?? "",
            ),
          ),
      REVEAL_SOURCE,
      { timeout: 10_000 },
    );

    const transform = await page
      .locator('[class*="featureRow_"]')
      .first()
      .evaluate((el) => getComputedStyle(el).transform);
    expect(
      transform,
      `the feature row's transform is still ${transform} after the animation ` +
        "finished, so the fill is holding it and the hover lift cannot apply",
    ).toBe("none");
  });

  test("shows every card when reduced motion is requested", async ({ page }) => {
    await mockApi(page, undefined, { auth: false });

    // The premise first. "No animation is running" is trivially true of a page
    // whose entrance never ran, which is how the hero's reduced-motion check
    // passed against the dead-blobs code this suite was written for.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/features");
    await waitForReveal(page);

    await page.emulateMedia({ reducedMotion: "reduce" });
    // A fresh document: flipping the media setting alone need not restart the
    // stylesheet's animation bookkeeping on an already-loaded page.
    await page.goto("/features");
    await expect(page.locator("h1").first()).toBeVisible();

    const running = await runningAnimations(page);
    expect(
      running["featureReveal"] ?? 0,
      "featureReveal is still running under prefers-reduced-motion: reduce",
    ).toBe(0);

    // The half that actually matters, and the reason the hidden state lives
    // inside the keyframe rather than in the rules: the cards must be there.
    // Gating an entrance on reduced motion is only safe if "no animation" means
    // "already arrived" — otherwise the reader gets four invisible cards.
    //
    // Read once, at a single instant, rather than through `toHaveCSS`. That
    // assertion retries, so it would sit and wait out an animation that was
    // never meant to run and then report `opacity: 1` — passing on exactly the
    // bug this is here to catch. A point-in-time read cannot be satisfied by a
    // card that arrives late, which is the claim being made.
    const rows = await page.$$eval('[class*="featureRow_"]', (els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return {
          opacity: style.opacity,
          height: Math.round(el.getBoundingClientRect().height),
        };
      }),
    );
    expect(rows, "the four feature cards are not in the DOM").toHaveLength(4);
    for (const [i, row] of rows.entries()) {
      expect(row.opacity, `card ${i} is at opacity ${row.opacity} with motion off`).toBe(
        "1",
      );
      expect(row.height, `card ${i} has no height (${row.height}px)`).toBeGreaterThan(0);
    }
  });
});

/**
 * The pipeline lights one step at a time, in order (#353).
 *
 * The defect this locks could be caught by no amount of waiting: each card's
 * highlight sat at 20-30% of its *own* 2s slice, which is the opening of the
 * *next* step. So the sweep began a step late, the connector beside each card lit
 * while the step behind it was still running, and the bar drifted across on a
 * linear ramp that ignored all of it. Screenshots showed motion and plausible
 * cards. The sequence itself was wrong.
 *
 * The timeline is sampled by *steering* it rather than by sleeping: every
 * animation on the track is paused and its `currentTime` set by hand, so this is
 * an assertion about the shape of the sequence instead of about wall-clock luck.
 * A sampling version of this test passed on a broken timeline often enough to be
 * worthless.
 *
 * "Lit" means *at full emphasis* (opacity 1), not merely "different from rest".
 * The first version of this test treated any card whose border had moved off the
 * resting colour as lit, and reported two cards lit for 1.1s of every 2s slice —
 * because a crossfade interpolates the outgoing card back to rest at the same
 * moment it interpolates the incoming card up to the accent, so for most of the
 * handoff *both* borders are in flight and neither is at rest. That is correct
 * behaviour and the test was wrong about it. Emphasis is the thing that has to be
 * singular.
 */
test.describe("the Home pipeline timeline (#353)", () => {
  test("reaches one step's full emphasis at a time, in order", async ({ page }) => {
    await mockApi(page, undefined, { auth: true });
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeVisible();

    const track = page.locator('[class*="pipelineTrack"]').first();
    await expect(track).toBeAttached();

    const sampled = await track.evaluate((el) => {
      const anims = el.getAnimations({ subtree: true }) as CSSAnimation[];
      // Only the timeline: the track also carries other motion, and steering
      // that would change what is being measured.
      const timeline = anims.filter((a) => /pipelineStepActive/.test(a.animationName));
      const cards = [...el.querySelectorAll('[class*="pipelineStep"]')] as HTMLElement[];

      /** Step indices at full emphasis (opacity 1), at time `t`. */
      const peakAt = (t: number): number[] => {
        for (const a of timeline) {
          a.pause();
          a.currentTime = t;
        }
        return cards
          .map((c, i) => (Number(getComputedStyle(c).opacity) > 0.99 ? i : -1))
          .filter((i) => i !== -1);
      };

      // 100ms across the full 10s cycle: fine enough that no step's emphasis
      // window (0.6s wide) can fall between two samples.
      const STEP = 100;
      const runs: { step: number; from: number; to: number }[] = [];
      const anomalies: { at: number; count: number }[] = [];
      for (let t = 0; t <= 10_000; t += STEP) {
        const peak = peakAt(t);
        if (peak.length > 1) {
          anomalies.push({ at: t, count: peak.length });
          continue;
        }
        if (peak.length === 0) continue;
        const last = runs[runs.length - 1];
        if (last && last.step === peak[0]) last.to = t;
        else runs.push({ step: peak[0], from: t, to: t });
      }

      return {
        names: anims.map((a) => a.animationName),
        cards: cards.length,
        timelineInstances: timeline.length,
        runs: runs.map((r) => r.step),
        // `from` matters as much as `width`: it is what pins a step to its own
        // slice. A width check alone passes on the old timeline too.
        starts: runs.map((r) => r.from),
        widths: runs.map((r) => r.to - r.from + STEP),
        anomalies,
      };
    });

    // Five cards, five instances of the one keyframe they share.
    expect(sampled.cards).toBe(5);
    expect(sampled.timelineInstances).toBe(5);

    // Never two steps at full emphasis at once.
    expect(
      sampled.anomalies,
      `two steps were emphasised at once at ${sampled.anomalies
        .map((a) => `${a.at}ms`)
        .join(", ")}`,
    ).toEqual([]);

    // The order is the whole point: each of the five steps takes its turn, once,
    // left to right. An off-by-one slice still yields five runs, so the count
    // alone is not the assertion — the sequence is.
    expect(
      sampled.runs,
      "the pipeline did not emphasise steps 1-5 once each, in order",
    ).toEqual([0, 1, 2, 3, 4]);

    // And each is *legible* rather than a blip: the emphasis window is 0.6s of
    // each 2s slice, so anything under 300ms sampled reads as a flicker.
    for (const [i, width] of sampled.widths.entries()) {
      expect(width, `step ${i + 1} held emphasis for only ${width}ms`).toBeGreaterThanOrEqual(300);
    }

    // Each step must take its turn *during its own slice*. The cycle is five 2s
    // slices, so step N (0-based) belongs to [N*2000, (N+1)*2000). This is the
    // assertion the old timeline fails and the one that describes the fix: its
    // highlight sat at 20-30% of local time, which put step N's emphasis at
    // 2000-3000ms into step N+1's slice. Every step was one slice behind, so
    // the sweep began a step late and ended with a sixth, empty slice.
    for (const [i, from] of sampled.starts.entries()) {
      expect(
        from,
        `step ${i + 1} reached emphasis at ${from}ms, outside its own ${i * 2000}-${(i + 1) * 2000}ms slice`,
      ).toBeGreaterThanOrEqual(i * 2000);
      expect(
        from,
        `step ${i + 1} reached emphasis at ${from}ms, inside step ${i + 2}'s slice`,
      ).toBeLessThan((i + 1) * 2000);
    }
  });
});
