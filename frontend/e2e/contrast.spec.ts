import { expect, test, type Page } from "@playwright/test";
import {
  controlBoundary,
  expectControlBoundary,
  expectReadable,
} from "./helpers/color";

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

/**
 * Form-control boundaries (WCAG 2.1 SC 1.4.11) — issue #345.
 *
 * The suite above guards text (1.4.3). A form control's *boundary* is a
 * different requirement, and it was the actual defect in #345: the container
 * border token cleared 1.50:1 against the card a field sits on, so the only
 * thing marking an input as a box was nearly invisible. The text was never the
 * problem — value text measured 17.85:1.
 *
 * These are here because `src/styles/input-contrast.test.ts` asserts the same
 * contract by *reading the stylesheet*. That catches a bad token value, but it
 * cannot see a cascade or CSS-modules problem that stops the declaration
 * reaching the element at all. This measures what the engine painted.
 */
test.describe("Control boundaries", () => {
  test("light-mode input and textarea are visibly bounded", async ({ page }) => {
    await openThemed(page, "light", "/contact");
    // Two components rather than two assertions on one: the input and the
    // textarea both resolve the same `.input` border, so this is really a check
    // that both *use* it. `<select>` is not probed because every page carrying
    // one is auth-gated, and `.select` composes the same `.input` rule.
    await expectControlBoundary(
      page,
      page.getByLabel("Name"),
      "contact name input",
    );
    await expectControlBoundary(
      page,
      page.getByLabel("Message"),
      "contact message textarea",
    );
  });

  test("light-mode field on the login form is visibly bounded", async ({ page }) => {
    // A different page and a different form, so the token is proven to be
    // shared rather than to have been fixed on one stylesheet.
    await openThemed(page, "light", "/login");
    await expectControlBoundary(
      page,
      page.getByLabel(/password/i),
      "login password input",
    );
  });

  test("dark fields keep the boundary they had before #345", async ({ page }) => {
    await openThemed(page, "dark", "/contact");
    const measured = await controlBoundary(page, page.getByLabel("Name"));

    // Resolved through the engine so this compares rgb to rgb, rather than
    // parsing a hex token and reimplementing colour maths in the test.
    const containerBorder = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.borderColor = "var(--color-border)";
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return value;
    });

    // Not a 3:1 assertion. #345 was explicitly scoped to light mode, and the
    // dark boundary is 1.54:1 — a known, recorded gap rather than a passing
    // one. What is asserted here is that a light-mode fix did not quietly
    // change the dark palette, which is the thing a future retune is most
    // likely to do by accident.
    expect(
      measured.border,
      `the dark field boundary renders as ${measured.border}, but the dark ` +
        `container border renders as ${containerBorder}. #345 was scoped to ` +
        "light mode; if the dark palette was meant to change, do it " +
        "deliberately and update the note in globals.css with it.",
    ).toBe(containerBorder);
  });
});

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
        // The CTA *is* the anchor. It used to be `<Link><Button>`, so this
        // locator was `a[href="/demo"] button` and stopped matching the moment
        // #248 collapsed the nesting — the test died on "element(s) not found"
        // and never measured a colour. Two CTAs point at /demo; take the hero
        // one, which is first in document order.
        const cta = page.locator('main a[href="/demo"]').first();
        await expect(cta).toBeVisible();
        // Guards the premise: if this ever stops being a button-shaped link the
        // numbers below would be measuring some other element entirely.
        await expect(cta).toHaveClass(/button/);
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
