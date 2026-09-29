import { expect, test } from "@playwright/test";

import { guardOrigins, openRoute, sweepApi } from "./fixtures";
import { SWEEP_ROUTES } from "./routes";
import { censusAnimations, censusPseudoTransitions } from "./helpers/motion";

/**
 * Runtime lock: the census reports what it cannot see.
 *
 * #334 came out of a day spent hunting a defect the harness was blind to by
 * construction. `/pricing`'s FAQ answer animates through `::details-content`,
 * and `document.getAnimations()` has never reported that transition — so
 * `censusAnimations` on that route returns `total: 0` while the page visibly
 * animates. `assertSeekable` would have passed it. The motion pass would have
 * reported "nothing to see".
 *
 * That is the failure this file exists to make impossible to reintroduce, and it
 * is a *behavioural* lock on purpose. The obvious cheap version — grep
 * `motion.ts` for the string `pseudoTransitions` — would be a lie waiting to
 * happen, for the reasons `visual-sweep.lock.test.ts` already sets out: a grep
 * proves text is present, not that the check still runs or still means anything.
 * So this runs in a real browser against the real app, and the two properties
 * that matter are both asserted against real CSS.
 *
 * The controls matter as much as the positive. A detector that reports *every*
 * pseudo-element transition would pass the first test and be worse than none,
 * because the report would claim the sweep cannot reach motion it can in fact
 * seek — the same category of error, inverted. So there is a negative test
 * against a transition the census *can* place.
 */
test.describe("the animation census reports its own blind spots", () => {
  // Motion must be enabled: the blind spot is in what the census can *see*, and
  // `reduce` would collapse the very transition this file is about to inspect.
  test.use({ reducedMotion: "no-preference" });

  const route = (path: string) => {
    const found = SWEEP_ROUTES.find((candidate) => candidate.path === path);
    if (!found) {
      throw new Error(`the sweep has no \`${path}\` route; the census lock needs one`);
    }
    return found;
  };

  test("a ::details-content transition is reported as unreachable", async ({ page }) => {
    const pricing = route("/pricing");
    await guardOrigins(page.context());
    await sweepApi(page, { auth: pricing.auth });
    await openRoute(page, pricing, "dark");

    const [census, blind] = await Promise.all([
      censusAnimations(page),
      censusPseudoTransitions(page),
    ]);

    // The declaration is there. Non-zero durations only, so an element with no
    // such rule cannot produce one.
    expect(
      blind.some((entry) => entry.includes("::details-content") && /\b200ms\b/.test(entry)),
      `expected a 200ms ::details-content transition to be reported as unreachable, got ${JSON.stringify(blind)}`,
    ).toBe(true);

    // And it really is unreachable — asserted, not assumed. If a future Chromium
    // starts reporting it, this fails and `censusPseudoTransitions` can be
    // deleted rather than left asserting a stale blind spot forever.
    const animationCount = await page.evaluate(
      () =>
        // `pseudoElement` is on `KeyframeEffect`, not on the `AnimationEffect`
        // the public type exposes, and the whole question here is whether a
        // pseudo-element animation is reported at all — so the check is on the
        // runtime shape.
        document.getAnimations().filter(
          (animation) =>
            (animation.effect as { pseudoElement?: string } | null)?.pseudoElement ===
            "::details-content",
        ).length,
    );
    expect(
      animationCount,
      "Chromium now reports ::details-content transitions — remove them from PSEUDOS in " +
        "censusPseudoTransitions and let the sweep seek them",
    ).toBe(0);

    // The census carries the list, so a run cannot look clean by omission: this
    // is the field the manifest writes and the report reads.
    expect(census.pseudoTransitions).toEqual(blind);
    expect(census.pseudoTransitions.length).toBeGreaterThan(0);
  });

  test("the page's own element transitions are still reported and seekable", async ({ page }) => {
    // The control, and the anti-false-positive test. `/` has a whole element-level
    // motion system — reveals, ambient loops, counters — in the same app as the
    // blind spot. If the detector had widened to all pseudo-elements, or to all
    // transitions, this catches it: a detector that flags everything is worse
    // than none, because the report would then claim the sweep cannot reach
    // motion it can in fact seek.
    const home = route("/");
    await guardOrigins(page.context());
    await sweepApi(page, { auth: home.auth });
    await openRoute(page, home, "dark");

    const blind = await censusPseudoTransitions(page);
    expect(
      blind,
      "no ::details-content transition is declared on `/`, so nothing should be reported unreachable",
    ).toEqual([]);

    // Home's motion system is element-level, so the census sees it: there is
    // something to count, and it lands on the document timeline, which is the
    // branch that makes it seekable.
    const census = await censusAnimations(page);
    expect(census.total).toBeGreaterThan(0);
    expect(census.timeDriven).toBeGreaterThan(0);

    // The count the page itself would produce, computed the same way
    // `censusAnimations` does. Asserted rather than trusted, so a change to the
    // census that quietly stopped counting cannot leave this passing.
    const fromPage = await page.evaluate(
      () => document.getAnimations().filter((a) => a.timeline instanceof DocumentTimeline).length,
    );
    expect(census.timeDriven).toBe(fromPage);
  });
});
