import { expect, test } from "@playwright/test";

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
    instances: { auroraDrift: 3, scanline: 1, gradientShift: 1 },
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
