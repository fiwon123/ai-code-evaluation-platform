import { expect, test } from "@playwright/test";

import { guardOrigins, openRoute, sweepApi } from "./fixtures";
import { SWEEP_ROUTES } from "./routes";
import { settleAtScroll } from "./helpers/motion";

/**
 * Runtime lock: the same state, loaded fresh, captures to the same bytes.
 *
 * This is the determinism lock, and it is the one that cannot be faked by a
 * source grep. A sweep whose motion helpers wait on a duration, whose infinite
 * loops are left running, or whose counters are read mid-flight produces a
 * *different picture every run* — and every one of those runs is a green test
 * that files the machine's load as a design defect. "The same commit, the same
 * browser, the same state, the same pixels" is false for all of them.
 *
 * It is checked across a **fresh load**, deliberately. Scrolling 0.5 → 0.9 → 0.5
 * in one page load also changes the document height, because revealing a
 * `Reveal` block can change its height and therefore `maxScroll` — so the second
 * 0.5 is a slightly different pixel row, on mobile dramatically so. That is not
 * nondeterminism to lock away; it is the static pass doing three legitimate
 * measurements. What a reviewer needs to trust is that re-running the sweep
 * reproduces the pictures, and that is what a reload tests.
 *
 * The other two tests are controls, and they are the reason this file is not
 * vacuous: a blank page captured twice is trivially identical, and a sweep that
 * photographs one page 300 times would pass a byte-equality check forever.
 */
test.describe("capture determinism", () => {
  // The same at-rest policy as the sweep's static pass, and for the same reason:
  // Home's status chip cycles every 1200ms for thirty seconds, so with motion
  // left on, no frame of that page is ever the same frame twice — a property of
  // the demo flourish, not of the harness. Reduced motion is the resting state
  // the app itself defines, so that is what a reproducible frame must capture.
  test.use({ reducedMotion: "reduce" });

  const home = SWEEP_ROUTES.find((route) => route.path === "/");
  if (!home) {
    throw new Error("the sweep has no `/` route; the determinism lock needs one");
  }

  test("a reloaded state captures to identical bytes", async ({ page }) => {
    await guardOrigins(page.context());
    await sweepApi(page, { auth: home.auth });

    await openRoute(page, home, "dark");
    await settleAtScroll(page, 0.5);
    const first = await page.screenshot();

    // A second load, not a second scroll: same commit, same browser, same state.
    await openRoute(page, home, "dark");
    await settleAtScroll(page, 0.5);
    const second = await page.screenshot();

    expect(
      first.equals(second),
      `two loads of the same state differ (${first.length} vs ${second.length} bytes) — ` +
        "something in the settle path is time-dependent, and every run's report is " +
        "about the machine rather than the design",
    ).toBe(true);
  });

  test("a different offset produces a different capture", async ({ page }) => {
    // The control for the test above.
    await guardOrigins(page.context());
    await sweepApi(page, { auth: home.auth });

    await openRoute(page, home, "dark");
    await settleAtScroll(page, 0);
    const top = await page.screenshot();
    await settleAtScroll(page, 1);
    const bottom = await page.screenshot();

    expect(
      top.equals(bottom),
      "the top and the bottom of the page captured identically — the capture is not " +
        "reading the scrolled document, so byte-equality above would be meaningless",
    ).toBe(false);
  });

  test("the theme is part of the capture, not of the page's mood", async ({ page }) => {
    // Same route, same offset, two themes. If `data-theme` were not applied before
    // load, both frames would be identical and the 300-frame matrix would be 300
    // copies of one image — a pass that photographs the same page 300 times.
    await guardOrigins(page.context());
    await sweepApi(page, { auth: home.auth });

    await openRoute(page, home, "light");
    await settleAtScroll(page, 0.5);
    const light = await page.screenshot();
    await openRoute(page, home, "dark");
    await settleAtScroll(page, 0.5);
    const dark = await page.screenshot();

    expect(light.equals(dark), "light and dark captured identically").toBe(false);
  });
});
