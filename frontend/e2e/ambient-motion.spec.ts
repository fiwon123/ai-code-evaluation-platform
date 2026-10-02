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

  /**
   * The progress bar rests between steps, and hides its own reset (#353 follow-up).
   *
   * The CSS assertions in `ambient-motion.test.ts` lock the *shape* of the
   * keyframes. This locks what the browser actually renders, because the two
   * defects the video review found were both properties of the rendered timeline
   * rather than of the stylesheet text:
   *
   * - The bar was never stepped. `ease-in-out` flattens the slope at a keyframe
   *   it passes *through*, so one stop per level is a ramp that decelerates at
   *   each level, not a plateau. Measured per frame, the old bar gained between
   *   23 and 80px in every 0.5s window of the cycle and never once stood still.
   * - The loop seam was a one-frame teleport: 1060px to 42px between two
   *   consecutive samples, fully opaque, while step five was still fading out.
   *
   * Both are steered rather than slept, like the timeline test above, so this is
   * an assertion about the animation and not about wall-clock luck.
   */
  test("rests between steps and hides its reset at the loop seam", async ({ page }) => {
    await mockApi(page, undefined, { auth: true });
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeVisible();

    const track = page.locator('[class*="pipelineTrack"]').first();
    await expect(track).toBeAttached();

    const sampled = await track.evaluate((el) => {
      const bar = el.parentElement?.querySelector(
        '[class*="progressBar"]',
      ) as HTMLElement | null;
      const barAnim = bar?.getAnimations()[0] as CSSAnimation | undefined;
      if (!bar || !barAnim) throw new Error("progress bar or its animation not found");

      const STEP = 50;
      /** Width in px and opacity at time `t`, with the timeline steered there. */
      const at = (t: number) => {
        barAnim.pause();
        barAnim.currentTime = t;
        const cs = getComputedStyle(bar);
        return { w: Number.parseFloat(cs.width), o: Number(cs.opacity) };
      };

      // Longest stretch with no width change at all, per 0.5s window. A plateau
      // shows up as a window whose total movement rounds to zero.
      const windows: number[] = [];
      for (let t = 0; t + 500 <= 10_000; t += 500) {
        windows.push(Math.abs(at(t + 500).w - at(t).w));
      }

      // Every frame-to-frame width change above 10% of the track, paired with
      // the opacity at both ends of it. A reset is acceptable only in the dark.
      const trackWidth = bar.parentElement!.getBoundingClientRect().width;
      const jumps: { t: number; delta: number; oFrom: number; oTo: number }[] = [];
      let prev = at(0);
      for (let t = STEP; t <= 10_000; t += STEP) {
        const now = at(t);
        const delta = Math.abs(now.w - prev.w);
        if (delta > trackWidth * 0.1) {
          jumps.push({ t, delta, oFrom: prev.o, oTo: now.o });
        }
        prev = now;
      }

      // Widest single-frame change while the bar is actually visible — the
      // "does it read as a series of jumps" number.
      let visibleMax = 0;
      prev = at(0);
      for (let t = STEP; t <= 10_000; t += STEP) {
        const now = at(t);
        if (now.o > 0.02 && prev.o > 0.02) {
          visibleMax = Math.max(visibleMax, Math.abs(now.w - prev.w));
        }
        prev = now;
      }

      return {
        trackWidth,
        // The five plateau windows. Index 2 of each group of three in the table
        // below is the move; the two around it are the rests.
        windows,
        jumps,
        visibleMax,
      };
    });

    // Five rests of at least 1s each. The bar now holds each level for 1.6s and
    // spends 0.4s moving to the next, so in every 0.5s window that is not a move
    // the total movement is zero. `windows` is 20 long: 10 rests, because the
    // 0.5s windows do not align with the 0.4s moves, and each rest is covered by
    // two windows.
    expect(sampled.windows.length).toBe(20);
    const moves = sampled.windows.filter((d) => d > 1).length;
    expect(
      moves,
      `the bar moved in ${moves} of 20 half-second windows, so it is not stepping ` +
        `(window deltas: ${sampled.windows.map((d) => d.toFixed(0)).join(",")})`,
    ).toBeGreaterThanOrEqual(4);
    expect(
      moves,
      `the bar moved in ${moves} of 20 half-second windows — it is a continuous ` +
        `ramp that merely slows at each level`,
    ).toBeLessThanOrEqual(8);

    // The seam reset is hidden, not merely small. A looping `width` animation
    // has to jump back to its start, so the jump itself is allowed to exist —
    // what is not allowed is for it to be visible. Every jump over 10% of the
    // track must therefore happen at zero opacity on both sides.
    expect(
      sampled.jumps.length,
      "no width jump was found at all, so this run did not reach the loop seam — " +
        "the assertion below would pass vacuously",
    ).toBeGreaterThan(0);
    for (const jump of sampled.jumps) {
      expect(
        Math.max(jump.oFrom, jump.oTo),
        `the bar jumped ${jump.delta.toFixed(0)}px at ${jump.t}ms with opacity ` +
          `${jump.oFrom.toFixed(2)} -> ${jump.oTo.toFixed(2)}, so the reset is visible`,
      ).toBeLessThanOrEqual(0.02);
    }
    expect(
      sampled.visibleMax,
      "the bar's largest visible frame-to-frame change should be a fraction of " +
        "the track, not a reset",
    ).toBeLessThan(sampled.trackWidth * 0.1);
  });

  /**
   * The stacked layout centres its connectors in the gaps they join (#353 follow-up).
   *
   * A CSS assertion can only check that `align-self: center` was written. This
   * checks the rendered geometry, which is what the video review actually
   * objected to: the connectors sat at x=390 in a track ending at x=396, hard
   * against the right border of a full-bleed card, and read as a stray hairline
   * at the screen edge — a scrollbar fragment, at a glance — rather than as a
   * connector between two cards.
   *
   * Android project only: on desktop the connectors are a horizontal row and
   * centring them is meaningless.
   */
  test("centres the stacked connectors between the cards", async ({ page, isMobile }) => {
    test.skip(!isMobile, "the stacked pipeline only exists in the narrow layout");

    await mockApi(page, undefined, { auth: true });
    await page.goto("/");

    const track = page.locator('[class*="pipelineTrack"]').first();
    await expect(track).toBeAttached();
    await track.scrollIntoViewIfNeeded();

    const geom = await track.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const steps = [...el.querySelectorAll('[class*="pipelineStep"]')] as HTMLElement[];
      const conns = [...el.querySelectorAll('[class*="pipelineConnector"]')] as HTMLElement[];
      const centre = box.x + box.width / 2;
      return {
        cardsFullWidth: steps.map((s) => s.getBoundingClientRect().width / box.width),
        offsets: conns.map((c) => c.getBoundingClientRect().x + c.getBoundingClientRect().width / 2 - centre),
        // For each connector: is it vertically between the two cards it joins?
        gap: conns.map((c, i) => {
          const r = c.getBoundingClientRect();
          const above = steps[i]!.getBoundingClientRect();
          const below = steps[i + 1]!.getBoundingClientRect();
          return {
            above: above.bottom,
            top: r.top,
            bottom: r.bottom,
            below: below.top,
          };
        }),
      };
    });

    // The cards must still fill the track. Centring the group rather than the
    // connector content-sizes the cards, which turned the pipeline into a ragged
    // staircase of 117-150px cards in a 380px track.
    for (const [i, ratio] of geom.cardsFullWidth.entries()) {
      expect(
        ratio,
        `card ${i + 1} fills only ${(ratio * 100).toFixed(0)}% of the track on mobile`,
      ).toBeGreaterThan(0.9);
    }

    // Each connector is within a few px of the track's centre line.
    for (const [i, offset] of geom.offsets.entries()) {
      expect(
        Math.abs(offset),
        `connector ${i + 1} sits ${offset.toFixed(0)}px off the centre line, in the ` +
          `gutter beside the card instead of the gap between cards`,
      ).toBeLessThanOrEqual(3);
    }

    // And it is inside the vertical gap between the two cards, with room either
    // side — a bar flush against one card is the thing being fixed.
    for (const [i, g] of geom.gap.entries()) {
      expect(g.top, `connector ${i + 1} starts above the card it follows`).toBeGreaterThanOrEqual(
        g.above,
      );
      expect(g.bottom, `connector ${i + 1} ends below the card it leads to`).toBeLessThanOrEqual(
        g.below,
      );
      const above = g.top - g.above;
      const below = g.below - g.bottom;
      expect(
        Math.abs(above - below),
        `connector ${i + 1} is ${above.toFixed(0)}px below the upper card and ` +
          `${below.toFixed(0)}px above the lower one, so it is not centred in the gap`,
      ).toBeLessThanOrEqual(4);
    }
  });
});

/**
 * The two sections that used to end the page flat (#355).
 *
 * Both motions are new and both are invisible in a paused frame: the teaser rows
 * only differ from one another *in time*, and the CTA ring only moves. So this
 * steers the animations and reads the computed values, the same way the pipeline
 * test above does — which is also what caught the #353 progress-bar defect, and
 * what the visual sweep could not see.
 */
test.describe("the Home closing sections (#355)", () => {
  /** Both row classes. The score row is `.teaserScoreRow` and does not also carry
   *  `teaserRow` — the two share a comma-separated rule rather than composing, so
   *  that one element never answers to both names. */
  const ROWS = '[class*="teaserRow"], [class*="teaserScoreRow"]';

  /** The teaser panel, once the section has entered view. */
  async function openTeaser(page: Page) {
    await mockApi(page, undefined, { auth: true });
    await page.goto("/");
    const wrap = page.locator('[class*="teaserPanelWrap"]').first();
    await wrap.scrollIntoViewIfNeeded();
    // The reveal is gated on the section arriving, so the rows only have
    // animations once `data-entered` is set. Measuring before that would read the
    // resting state and prove nothing about the stagger.
    await expect(wrap).toHaveAttribute("data-entered", "true");
    await expect(wrap.locator(ROWS)).toHaveCount(5);
    return wrap;
  }

  test("reveals the teaser rows in order, and never backwards", async ({ page }) => {
    const wrap = await openTeaser(page);

    const sampled = await wrap.evaluate((el, rowsSelector) => {
      // `getAnimations()` reports *pending and running* animations only, so by
      // the time this ran the entrances had finished and there was nothing left
      // to steer — the first attempt read an empty list rather than a wrong one.
      // The reveal is gated on `data-entered` and nothing else, so clearing the
      // attribute and putting it straight back restarts all five in one
      // synchronous step, with no reflow in between to let them finish.
      el.setAttribute("data-entered", "false");
      void (el as HTMLElement).offsetHeight;
      el.setAttribute("data-entered", "true");

      const rows = [...el.querySelectorAll(rowsSelector)] as HTMLElement[];
      const anims = rows
        .flatMap((r) => r.getAnimations() as CSSAnimation[])
        // By pattern, not equality: Vite scopes a *locally* declared keyframe on
        // both sides (`teaserRowIn` → `_teaserRowIn_<hash>`), which still
        // resolves. Only a reference into another file comes apart (#366), so an
        // exact-name match fails on a working animation.
        .filter((a) => /teaserRowIn/.test(a.animationName));

      /** Opacity of every row at time `t`, after steering them all there. */
      const opacityAt = (t: number): number[] => {
        for (const a of anims) {
          a.pause();
          a.currentTime = t;
        }
        return rows.map((r) => Number(getComputedStyle(r).opacity));
      };

      // 50ms is fine enough that no 420ms row can cross its whole range between
      // two samples. Past the last row's end, so `end` is the finished state.
      const STEP = 50;
      const frames: { at: number; opacities: number[] }[] = [];
      for (let t = 0; t <= 2_400; t += STEP) {
        frames.push({ at: t, opacities: opacityAt(t) });
      }

      /** When each row after the first becomes visible, and the leader's state
       *  at that moment. This is the offset that defines a stagger. */
      const leaderAtStart: number[] = [];
      for (let n = 1; n < rows.length; n++) {
        const frame = frames.find((f) => f.opacities[n] > 0.05);
        if (frame) leaderAtStart.push(frame.opacities[n - 1]);
      }

      const firstMoving = frames.find((f) => f.opacities.some((o) => o > 0.01))?.at ?? 0;
      const lastUnsettled = frames.filter((f) => f.opacities.some((o) => o < 0.99)).at(-1)?.at ?? 0;

      return {
        names: anims.map((a) => a.animationName),
        rowCount: rows.length,
        animationCount: anims.length,
        // Read back from the engine, so a stagger that stopped being a stagger
        // shows up here rather than only in the source.
        durations: anims.map((a) => Number(a.effect?.getComputedTiming().duration ?? 0)),
        delays: anims.map((a) => Number(a.effect?.getComputedTiming().delay ?? 0)),
        start: frames[0].opacities,
        end: frames[frames.length - 1].opacities,
        leaderAtStart,
        // Watchable: first row moving to last row settled.
        cascadeSpan: lastUnsettled - firstMoving,
        // A cascade overlaps, so some frame has two rows mid-transition at once.
        // Zero here would mean the rows pop one after another instead.
        overlappingFrames: frames.filter(
          (f) => f.opacities.filter((o) => o > 0.05 && o < 0.95).length >= 2,
        ).length,
      };
    }, ROWS);

    expect(sampled.rowCount).toBe(5);

    // #366 in miniature: an animation whose name resolves to no keyframes is
    // *absent* from `getAnimations`, so this catches a rename that built cleanly
    // and moved nothing — which a screenshot cannot tell from a still ornament.
    for (const name of sampled.names) {
      expect(
        /teaserRowIn/.test(name),
        `the rows are running "${name}" rather than their own keyframe`,
      ).toBe(true);
    }

    // Every row has its own instance, and they do not all start together. If they
    // shared one animation the stagger would be an illusion and the five rows
    // would land as a single blink.
    expect(sampled.animationCount).toBe(5);
    expect(sampled.durations[0]).toBeGreaterThan(0);
    for (const d of sampled.durations) expect(d).toBeCloseTo(sampled.durations[0], 0);
    expect(new Set(sampled.delays).size, "every row started at the same instant").toBe(5);
    const [earliest, ...later] = sampled.delays;
    for (const delay of later) {
      expect(delay, "the delays do not ascend with the rows").toBeGreaterThan(earliest);
    }

    // At the start of the reveal every row is at the keyframe's `from`...
    for (const [i, o] of sampled.start.entries()) {
      expect(o, `row ${i + 1} was already visible before its entrance`).toBeLessThan(0.02);
    }

    // ...and at the end all of them have arrived. This is the assertion that
    // matters most: the whole class of bug here is a row left invisible at the
    // foot of the page.
    for (const o of sampled.end) {
      expect(o, "a teaser row never finished its entrance — blank space at the foot").toBeGreaterThan(0.99);
    }

    // The stagger is real, in the sense that matters: row N+1 starts moving while
    // row N is already well under way, so the eye has something to follow.
    //
    // Note what is *not* asserted: that row N+1 is still dark when row N
    // finishes. That is not what a stagger means — a cascade overlaps — and on
    // this easing row 2 is already at 0.72 when row 1 completes, which is the
    // point. What has to hold is that row N+1 starts before row N is done, and
    // that two rows are mid-fade at once (the `overlappingFrames` check below).
    //
    // Both of those were false when this entrance was on `--ease-out-expo`: it
    // front-loads so hard that each row cleared the visible band in ~67ms, less
    // than the 260ms stagger, so nothing ever overlapped and the section read as
    // five blinks. Changing the easing was the fix; `ease` is what `Reveal` uses,
    // so the section now matches the page's motion language too.
    expect(sampled.leaderAtStart.length, "fewer rows started than expected").toBe(4);
    for (const [i, lead] of sampled.leaderAtStart.entries()) {
      expect(
        lead,
        `row ${i + 2} began while row ${i + 1} was only ${lead.toFixed(2)} lit — not staggered`,
      ).toBeGreaterThan(0.4);
    }

    // Watchable, not a blink.
    expect(
      sampled.cascadeSpan,
      `the cascade resolved in ${sampled.cascadeSpan}ms — too fast to follow`,
    ).toBeGreaterThan(700);
    expect(
      sampled.overlappingFrames,
      "no two rows were ever mid-transition together — the rows pop one at a time",
    ).toBeGreaterThan(0);
  });

  test("keeps the CTA decoration off the button and out of the way of clicks", async ({
    page,
  }) => {
    await mockApi(page, undefined, { auth: true });
    await page.goto("/");

    // Anchored on the ring, then its parent. `[class*="cta"]` would match the
    // hero's `.ctaPrimary` button first in DOM order, which is not the banner.
    const ring = page.locator('[class*="ctaRing"]').first();
    await expect(ring).toBeAttached();
    const banner = ring.locator("xpath=..");
    await banner.scrollIntoViewIfNeeded();

    const button = banner.getByRole("link", { name: /create free account/i });
    await expect(button).toBeVisible();

    // The ring is `width: 132%` of the banner and hangs 62% above it, so it does
    // cover the button. Unless it is pointer-inert the CTA does not work.
    const hit = await page.evaluate(() => {
      const link = [...document.querySelectorAll("a")].find((a) =>
        /create free account/i.test(a.textContent ?? ""),
      );
      if (!link) return { tag: null as string | null, inside: false };
      const box = link.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { tag: top?.tagName ?? null, inside: link.contains(top) || top === link };
    });
    expect(hit.tag, "nothing rendered at the centre of the CTA button").not.toBeNull();
    expect(
      hit.inside,
      `the CTA decoration intercepted the click — topmost element at the button's centre was <${hit.tag?.toLowerCase()}>`,
    ).toBe(true);

    // And the ring is genuinely turning, not sitting still as a static ornament.
    // A screenshot cannot tell those apart, which is why the seam between
    // "styled" and "animating" is invisible to every other check here.
    const sweep = await page.evaluate(() => {
      const ring = document.querySelector('[class*="ctaRing"]');
      const anims = ring?.getAnimations() as CSSAnimation[] | undefined;
      if (!anims?.length) return { name: null, steps: [] as number[], duration: 0, sampled: 0 };
      const anim = anims[0];
      anim.pause();

      // Spread across the whole cycle, not its first fifth: four samples inside
      // 19% of a 64s loop cannot see an oscillation, and the mutation check
      // proved it — swapping the sweep for an out-and-back turn stayed green.
      // 60s rather than 64s, because at exactly one period the animation has
      // already looped back to its first value.
      const SAMPLES = [0, 15_000, 30_000, 45_000, 60_000];
      const at = (t: number): DOMMatrixReadOnly => {
        anim.currentTime = t;
        return new DOMMatrixReadOnly(getComputedStyle(ring!).transform);
      };
      const matrices = SAMPLES.map(at);
      // Signed angle from one sample to the next, taken as a difference of the
      // two matrices rather than of two `atan2` results: `atan2` returns [-180,
      // 180], so a ring that has swept past vertical reads as suddenly reversing
      // when in fact it is carrying on. The matrix difference is
      //
      //   atan2(sin(dm)cos(dp) - cos(dm)sin(dp), cos(dm)cos(dp) + sin(dm)sin(dp))
      //     = atan2(sin(dm - dp), cos(dm - dp)) = dm - dp
      //
      // which is the forward delta with no discontinuity in it.
      const steps = matrices.slice(1).map((m, i) => {
        const prev = matrices[i];
        return (
          (Math.atan2(m.b * prev.a - m.a * prev.b, m.a * prev.a + m.b * prev.b) * 180) / Math.PI
        );
      });
      return {
        name: anim.animationName,
        steps,
        sampled: SAMPLES[1] - SAMPLES[0],
        duration: Number(anim.effect?.getComputedTiming().duration ?? 0),
      };
    });
    // Pattern, for the same reason as the teaser rows: locally declared keyframes
    // are scoped on both sides, so the runtime name is `_ctaRingSweep_<hash>`.
    expect(
      /ctaRingSweep/.test(sweep.name ?? ""),
      `the CTA ring is not running its keyframe (running "${sweep.name}")`,
    ).toBe(true);

    // It turns one way and keeps turning. A ring that eased back and forth, or
    // snapped back between two samples, would pass a "did anything move" check.
    expect(sweep.duration, "the ring's period is too fast to be a closing gesture").toBeGreaterThanOrEqual(48_000);
    const expected = (360 / sweep.duration) * sweep.sampled;
    for (const [i, step] of sweep.steps.entries()) {
      expect(step, `window ${i + 1} turned ${step.toFixed(1)}deg — stalled or reversed`).toBeGreaterThan(0);
      // ...and at the rate the keyframe declares. Several times faster and it is
      // no longer the slow gesture it was written to be; it competes with the
      // CTA copy above it.
      expect(
        Math.abs(step - expected),
        `window ${i + 1} turned ${step.toFixed(1)}deg, expected about ${expected.toFixed(1)}deg`,
      ).toBeLessThan(expected * 0.2);
    }
  });

  test("shows the teaser finished and stills the CTA for a reduced-motion reader", async ({
    page,
  }) => {
    // Before the navigation: the media query has to be in force when `useInView`
    // reads it, or the gate opens the ordinary way and this measures nothing
    // about the reduced-motion path.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page, undefined, { auth: true });
    await page.goto("/");

    const wrap = page.locator('[class*="teaserPanelWrap"]').first();
    await wrap.scrollIntoViewIfNeeded();
    // `useInView` reports visible immediately under reduced motion, so the gate
    // opens without the animation ever being wanted.
    await expect(wrap).toHaveAttribute("data-entered", "true");

    const state = await page.evaluate((rowsSelector) => {
      const wrap = document.querySelector('[class*="teaserPanelWrap"]');
      const rows = [...wrap!.querySelectorAll(rowsSelector)] as HTMLElement[];
      const ring = document.querySelector('[class*="ctaRing"]');
      const running = new Set(
        (document.getAnimations() as CSSAnimation[]).map((a) => a.animationName),
      );
      return {
        opacities: rows.map((r) => Number(getComputedStyle(r).opacity)),
        rowCount: rows.length,
        ringAnimations: (ring?.getAnimations() as CSSAnimation[] | undefined)?.length ?? 0,
        stillAnimating: [...running].filter((n) =>
          /ctaRingSweep|teaserRowIn|auroraDrift/.test(n),
        ),
      };
    }, ROWS);

    // Content first: five visible rows, not five invisible ones.
    expect(state.rowCount).toBe(5);
    for (const [i, o] of state.opacities.entries()) {
      expect(o, `teaser row ${i + 1} is invisible for a reduced-motion reader`).toBeGreaterThan(0.99);
    }
    // ...and no motion at all.
    expect(
      state.ringAnimations,
      "the CTA ring is still animating for a reduced-motion reader",
    ).toBe(0);
    expect(
      state.stillAnimating,
      "ambient animation still running for a reduced-motion reader",
    ).toEqual([]);
  });
});
