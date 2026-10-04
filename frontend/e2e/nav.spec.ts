import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * The header's seven links, measured where they land (#400).
 *
 * `Layout.nav-centering.test.tsx` proves the stylesheet asks for three equal
 * outer tracks; this proves what that does to real boxes, because nothing in the
 * CSS knows how wide the logo, the seven labels or the actions turn out to be at
 * a given viewport. It is also the only place the *fit* arithmetic is checked: the
 * links measure 547px, so a centred row needs 547 + 2 × 188 (the wider end) = 923px
 * of nav — a 971px header — and everything below that has to collapse into the
 * burger instead. That band (769–1023px) is exactly where the links used to
 * overlap the theme toggle and the auth buttons, so both the centring and the
 * overlap are asserted here rather than assumed from the other test.
 *
 * Widths are set per test instead of relying on the projects, so the same
 * assertions run under the desktop and Pixel 7 profiles: the desktop project
 * would otherwise only ever exercise the top of the range and the phone project
 * only the collapsed end, and the 1023/1024 boundary — one pixel wide, and the
 * one that decides whether this feature works at all — would never be executed.
 */

/**
 * How far the links' centre may sit from the header's, in pixels.
 *
 * Subpixel rounding again: a header's box and a run of text inside it do not
 * round to the same fraction, so "centred" is never exact in `getBoundingClientRect`.
 * Measured in Chromium the two agree to well under a pixel, so 1.5px is slack for
 * that and ~100× tighter than the 147px the links were off by before. See the
 * same reasoning in `e2e/challenges.spec.ts` (#399).
 */
const CENTRE_TOLERANCE_PX = 1.5;

/** The seven labels, in order. Locks the JSX move as well as the geometry. */
const NAV_LABELS = ["Home", "Features", "Demo", "Challenges", "Pricing", "About", "Contact"];

async function openChallengesAt(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await mockApi(page);
  await page.goto("/challenges");
  await expect(page.getByRole("heading", { level: 1, name: "Challenges" })).toBeVisible();
}

/**
 * The four header boxes, located by structure.
 *
 * `> ul` and `> a` rather than the hashed class names: after #400 these are the
 * brand link, the links list, the actions div and the burger as direct children of
 * `<nav>`, and that sibling order is the thing the grid depends on.
 */
function boxes(page: Page) {
  return {
    header: page.locator("header"),
    links: page.locator("header nav > ul"),
    brand: page.locator("header nav > a").first(),
    actions: page.locator("header nav > div").first(),
    burger: page.getByRole("button", { name: "Toggle navigation" }),
  };
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value, `expected ${locator} to have a box`).not.toBeNull();
  return value!;
}

const centreX = (value: { x: number; width: number }) => value.x + value.width / 2;

/**
 * The `<nav>`'s *content* edges, i.e. inside its horizontal padding.
 *
 * `boundingBox()` returns the border box, and `.nav` is padded by 24px and capped
 * at `--max-width`, so comparing an element against the raw box would be off by
 * the padding at narrow widths and by the cap at wide ones.
 */
async function navContentEdges(page: Page): Promise<{ left: number; right: number }> {
  return page.locator("header nav").evaluate((nav) => {
    const box = nav.getBoundingClientRect();
    const style = getComputedStyle(nav);
    return {
      left: box.x + parseFloat(style.paddingLeft),
      right: box.right - parseFloat(style.paddingRight),
    };
  });
}

test.describe("header nav", () => {
  for (const width of [1440, 1280, 1024]) {
    test(`centres the seven links at ${width}px`, async ({ page }) => {
      await openChallengesAt(page, width);
      const { header, links, brand, actions } = boxes(page);

      const headerBox = await box(header);
      const linksBox = await box(links);
      const brandBox = await box(brand);
      const actionsBox = await box(actions);

      // The assertion the issue is about.
      const offset = Math.abs(centreX(linksBox) - centreX(headerBox));
      expect(
        offset,
        `the links' centre sits ${offset.toFixed(2)}px from the header's centre line ` +
          `at ${width}px (links ${Math.round(linksBox.x)}–${Math.round(linksBox.x + linksBox.width)}, ` +
          `header ${Math.round(headerBox.x)}–${Math.round(headerBox.x + headerBox.width)})`,
      ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);

      // Centred is not the same as clear: both ends must still have room.
      expect(linksBox.x, "the links overlap the logo").toBeGreaterThan(brandBox.x + brandBox.width);
      expect(
        linksBox.x + linksBox.width,
        "the links overlap the theme toggle / auth buttons",
      ).toBeLessThanOrEqual(actionsBox.x);

      // …and centring the links must not have moved anything else. The two outer
      // tracks are wider than the brand (logo 30px + text 93px vs a 287px track) and
      // than the auth cluster, and a grid item stretches to its track by default, so
      // an un-anchored `.navRight` leaves dead chrome at the right edge — 90px at
      // 1280px, measured. Same reason the logo needs `justify-self: start`: otherwise
      // its box spans the whole track and every empty pixel of it is a click target
      // that navigates home.
      const edges = await navContentEdges(page);
      // Scoped to the header: the Challenges page has its own "Sign up" CTA, and a
      // bare `getByRole` would straddle both.
      const logo = await box(page.locator("header nav > a").first().locator("svg").first());
      const signUp = await box(actions.getByRole("link", { name: "Sign up" }));
      expect(
        Math.abs(logo.x - edges.left),
        `the logo moved off the header's left content edge (${edges.left}px)`,
      ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
      expect(
        Math.abs(signUp.x + signUp.width - edges.right),
        `the auth buttons moved off the header's right content edge ` +
          `(${(edges.right - (signUp.x + signUp.width)).toFixed(2)}px of dead chrome)`,
      ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);

      // One row of seven, and all seven — a label dropped by the restructure would
      // quietly re-centre the rest and pass the checks above.
      const linkBoxes = await page.locator("header nav > ul > li > a").all();
      const visible: { top: number; text: string }[] = [];
      for (const link of linkBoxes) {
        const bounds = await link.boundingBox();
        if (bounds) visible.push({ top: bounds.y, text: (await link.innerText()).trim() });
      }
      expect(visible.map((entry) => entry.text)).toEqual(NAV_LABELS);
      const tops = visible.map((entry) => entry.top);
      expect(
        Math.max(...tops) - Math.min(...tops),
        "the links wrapped onto a second row",
      ).toBeLessThan(1);
    });
  }

  for (const width of [1023, 900, 390]) {
    test(`collapses into the burger at ${width}px instead of colliding`, async ({ page }) => {
      await openChallengesAt(page, width);
      const { links, burger, brand } = boxes(page);

      // The band that overlapped the actions before #400. Below 1024px there is no
      // inline nav to overlap anything, which is the point.
      await expect(links, `the inline nav is still rendered at ${width}px`).toBeHidden();
      await expect(burger, `no burger at ${width}px`).toBeVisible();
      await expect(
        page.locator("header nav > div").first(),
        "the actions cluster is hidden while collapsed",
      ).toBeHidden();

      const brandBox = await box(brand);
      const burgerBox = await box(burger);
      expect(
        brandBox.x + brandBox.width,
        "the burger is sitting on top of the logo",
      ).toBeLessThanOrEqual(burgerBox.x);
    });
  }

  test("the burger dropdown still lists every link and the auth controls", async ({ page }) => {
    await openChallengesAt(page, 900);
    const { links, burger } = boxes(page);

    await burger.click();
    await expect(links).toBeVisible();
    for (const label of NAV_LABELS) {
      await expect(links.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    // The auth cluster moves into the dropdown in this layout, so it is the one
    // place both are on screen at once.
    await expect(links.getByRole("link", { name: "Log in" })).toBeVisible();
    await expect(links.getByRole("link", { name: "Sign up" })).toBeVisible();
  });
});
