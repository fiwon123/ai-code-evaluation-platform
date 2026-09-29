import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * Scroll position across client-side navigation (#327).
 *
 * `jsdom` implements neither `window.scrollTo` nor `scrollIntoView`, so the unit
 * tests can only assert that the component *calls* them. These specs assert the
 * thing that actually matters: where the window ends up, in a real browser,
 * after a real click.
 *
 * The bug was worst on the legal pages because the footer is their only entry
 * point, so these drive the footer links — the actual reported path — rather
 * than the header, where the inherited offset is small enough to look correct.
 *
 * Two things about this app's markup are load-bearing for the selectors below,
 * both established by probing rather than assumed:
 *
 * - The `<footer>` is nested **inside** `<main>`, so it carries no
 *   `contentinfo` landmark role (HTML-AAM only maps a footer to `contentinfo`
 *   when it is not a descendant of `main`/`article`/`section`/`nav`/`aside`).
 *   It has to be found by tag.
 * - On the Pixel 7 profile the header nav collapses behind a menu button, so a
 *   header link needs the menu opened first. The footer is unaffected, which is
 *   another reason the reported repro is a footer repro.
 */

/** Waits for a lazy route to commit, then scrolls to the very bottom. */
async function scrollToBottom(page: Page, heading: RegExp) {
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  // Measuring before the route commits is a race: the Suspense fallback is a
  // short page, so the document has nothing to scroll and the offset reads 0.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const offset = await page.evaluate(() => window.scrollY);
  expect(offset).toBeGreaterThan(500);
  return offset;
}

/** Opens the collapsed header menu when the viewport hides the nav. */
async function openHeaderNav(page: Page) {
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  if (await toggle.isVisible()) {
    await toggle.click();
  }
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test.describe("Route navigation scroll restoration", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
  });

  test("a footer legal link from the bottom of a page lands at the top", async ({
    page,
  }) => {
    await page.goto("/terms");
    await scrollToBottom(page, /Terms of Service/);

    await page.locator("footer").getByRole("link", { name: "Privacy Policy" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeVisible();
    await expect.poll(() => scrollY(page), { timeout: 3000 }).toBe(0);
  });

  test("every footer legal link lands at the top", async ({ page }) => {
    const legal: Array<[string, RegExp]> = [
      ["Privacy Policy", /Privacy Policy/],
      ["Terms of Service", /Terms of Service/],
      ["Security", /Security/],
      ["GDPR", /GDPR/],
    ];

    for (const [label, heading] of legal) {
      await page.goto("/");
      await scrollToBottom(page, /Generate, execute, and evaluate/);
      await page.locator("footer").getByRole("link", { name: label }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect
        .poll(() => scrollY(page), { timeout: 3000 })
        .toBe(0);
    }
  });

  test("a header link from a scrolled page also lands at the top", async ({
    page,
  }) => {
    await page.goto("/");
    await scrollToBottom(page, /Generate, execute, and evaluate/);

    await openHeaderNav(page);
    await page.getByRole("banner").getByRole("link", { name: "Pricing" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: /pricing/i }),
    ).toBeVisible();
    await expect.poll(() => scrollY(page), { timeout: 3000 }).toBe(0);
  });

  test("back returns to where the reader was, not the top", async ({ page }) => {
    await page.goto("/terms");
    await scrollToBottom(page, /Terms of Service/);

    await page.locator("footer").getByRole("link", { name: "Privacy Policy" }).click();
    await expect.poll(() => scrollY(page), { timeout: 3000 }).toBe(0);

    await page.goBack();
    await expect(
      page.getByRole("heading", { level: 1, name: "Terms of Service" }),
    ).toBeVisible();
    // The browser restores the offset on its own schedule.
    await expect.poll(() => scrollY(page), { timeout: 3000 }).toBeGreaterThan(300);
  });

  test("a table-of-contents anchor still lands below the sticky header", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { level: 1, name: "Privacy Policy" }),
    ).toBeVisible();

    const tocLink = page
      .getByRole("navigation", { name: /contents/i })
      .getByRole("link")
      .first();
    const href = await tocLink.getAttribute("href");
    expect(href).toMatch(/^#.+/);
    const targetId = href!.slice(1);

    await tocLink.click();
    await expect.poll(() => scrollY(page), { timeout: 3000 }).toBeGreaterThan(0);

    // The section's `scroll-margin-top` is what keeps the heading from landing
    // behind the sticky header; assert the gap rather than the pixel.
    const gap = await page.evaluate((id) => {
      const header = document.querySelector("header")!;
      const target = document.getElementById(id)!;
      return (
        target.getBoundingClientRect().top -
        header.getBoundingClientRect().bottom
      );
    }, targetId);
    expect(gap).toBeGreaterThanOrEqual(0);
  });
});
