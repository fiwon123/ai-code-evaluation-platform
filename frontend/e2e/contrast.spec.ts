import { expect, test, type Page } from "@playwright/test";
import { expectReadable } from "./helpers/color";

/**
 * Text-contrast guard (WCAG 2.1 SC 1.4.3).
 *
 * Issue #203: in the dark theme every primary button painted
 * `--color-on-accent` (white) on `--color-primary` (#3b82f6) = 3.68:1, and the
 * danger button was worse at 2.77:1. Both passed review because the light
 * theme measured 6.70:1 and the bug only exists in the other theme.
 *
 * So this measures the *rendered* pairings in BOTH themes. Two things make that
 * work, and both were learned the hard way:
 *
 * - The theme is set through `localStorage.theme` before load, exactly as
 *   `public/theme-init.js` does. Assigning `data-theme` by hand does not stick:
 *   the app re-applies the stored theme and silently reverts the attribute, so
 *   a "dark" run happily measures light-theme values.
 * - Backgrounds resolve to the nearest fully-opaque ancestor. The header and
 *   footer are translucent panels; reading the first `backgroundColor` as opaque
 *   invents contrast values that do not exist on screen.
 */

const THEMES = ["light", "dark"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  // Must happen before the app boots, so the very first paint is themed.
  await page.addInitScript(
    (t) => window.localStorage.setItem("theme", t),
    theme,
  );
}

/** Open a route in a given theme and prove the theme took, or the numbers lie. */
async function openThemed(
  page: Page,
  theme: (typeof THEMES)[number],
  path: string,
) {
  await setTheme(page, theme);
  await page.goto(path);
  // Without this, a broken theme switch would make every "dark" assertion
  // measure the light theme and pass — a guard that cannot fail is decoration.
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test.describe("Text contrast", () => {
  for (const theme of THEMES) {
    test.describe(`${theme} theme`, () => {
      test("primary submit button", async ({ page }) => {
        await openThemed(page, theme, "/login");
        const button = page.locator('form button[type="submit"]');
        await expect(button).toBeVisible();
        await expectReadable(page, button, `login submit (${theme})`);
      });

      test("primary call to action", async ({ page }) => {
        await openThemed(page, theme, "/");
        // Two CTAs point at /demo; take the hero one.
        const cta = page.locator('main a[href="/demo"] button').first();
        await expect(cta).toBeVisible();
        await expectReadable(page, cta, `hero CTA (${theme})`);
      });

      test("contact handoff link mirrors the primary button", async ({
        page,
      }) => {
        await openThemed(page, theme, "/contact");
        await page.getByLabel("Name").fill("Jane");
        await page.getByLabel("Email").fill("jane@example.com");
        await page.getByLabel("Message").fill("Hello!");
        await page.getByRole("button", { name: /Prepare message/i }).click();
        const link = page.getByRole("link", {
          name: /Open it in your email app/i,
        });
        await expect(link).toBeVisible();
        await expectReadable(page, link, `contact handoff (${theme})`);
      });

      test("header and footer body text", async ({ page }) => {
        await openThemed(page, theme, "/pricing");
        const tagline = page.locator("footer p").first();
        await expect(tagline).toBeVisible();
        await expectReadable(page, tagline, `footer text (${theme})`);
        await expectReadable(
          page,
          page.locator("header nav a").first(),
          `header nav link (${theme})`,
        );
      });
    });
  }

  test("theme is really applied, or the numbers above are meaningless", async ({
    page,
  }) => {
    // Guards the guard: if a future refactor stops honouring localStorage.theme,
    // these tests would keep passing while measuring light theme twice.
    await setTheme(page, "dark");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const surface = await page
      .locator("main")
      .first()
      .evaluate((el) => {
        // `evaluate` types its element as `SVGElement | HTMLElement`. Walking up
        // only needs `getComputedStyle` and `parentElement`, which are on
        // `Element` — so type it that way instead of asserting an HTMLElement.
        let node: Element | null = el;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent")
            return bg;
          node = node.parentElement;
        }
        return "";
      });
    // Dark surface, not the light #ffffff.
    expect(surface).not.toBe("rgb(255, 255, 255)");
  });
});
