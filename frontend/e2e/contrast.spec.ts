import { expect, test, type Locator, type Page } from "@playwright/test";

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

type Paint = {
  ratio: number;
  fg: string;
  bg: string;
  size: number;
  weight: number;
  text: string;
  hops: number;
};

const THEMES = ["light", "dark"] as const;

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  // Must happen before the app boots, so the very first paint is themed.
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
}

/** Open a route in a given theme and prove the theme took, or the numbers lie. */
async function openThemed(page: Page, theme: (typeof THEMES)[number], path: string) {
  await setTheme(page, theme);
  await page.goto(path);
  // Without this, a broken theme switch would make every "dark" assertion
  // measure the light theme and pass — a guard that cannot fail is decoration.
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function paint(page: Page, target: Locator): Promise<Paint> {
  const handle = await target.elementHandle();
  if (!handle) throw new Error("element not found");
  return page.evaluate((el) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Walk to the nearest OPAQUE background. Reading the element's own
    // `backgroundColor` is wrong for transparent text nodes (`footer p` has no
    // background of its own) and produces a meaningless ratio against black.
    const isOpaque = (value: string) => {
      const n = (value.match(/[\d.]+/g) ?? []).map(Number);
      return (
        value !== "rgba(0, 0, 0, 0)" &&
        value !== "transparent" &&
        (n.length < 4 || n[3] === 1)
      );
    };
    let node: HTMLElement | null = el as HTMLElement;
    let bg = "";
    let hops = 0;
    while (node) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") {
        throw new Error(
          `refusing to guess a gradient background for "${(el.textContent ?? "").trim().slice(0, 24)}"`,
        );
      }
      if (isOpaque(style.backgroundColor)) {
        bg = style.backgroundColor;
        break;
      }
      node = node.parentElement;
      hops += 1;
    }
    if (!bg) throw new Error("no opaque background found");
    const style = getComputedStyle(el);
    const fg = parse(style.color);
    const [hi, lo] = [luminance(fg), luminance(parse(bg))].sort((a, b) => b - a);
    return {
      ratio: +(((hi + 0.05) / (lo + 0.05)) as number).toFixed(2),
      fg: style.color,
      bg,
      size: parseFloat(style.fontSize),
      weight: Number(style.fontWeight) || 400,
      text: (el.textContent ?? "").trim().slice(0, 24),
      hops,
    };
  }, handle);
}

/** WCAG AA minimum: 3:1 for large text, 4.5:1 otherwise. */
function required(size: number, weight: number) {
  return size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
}

function expectReadable(p: Paint, label: string) {
  const need = required(p.size, p.weight);
  expect(
    p.ratio,
    `${label} (${p.size}px/${p.weight}) is ${p.ratio}:1 and needs ${need}:1 — ` +
      `"${p.text}" in ${p.fg} on ${p.bg}`,
  ).toBeGreaterThanOrEqual(need);
}

test.describe("Text contrast", () => {
  for (const theme of THEMES) {
    test.describe(`${theme} theme`, () => {
      test("primary submit button", async ({ page }) => {
        await openThemed(page, theme, "/login");
        const button = page.locator('form button[type="submit"]');
        await expect(button).toBeVisible();
        expectReadable(await paint(page, button), `login submit (${theme})`);
      });

      test("primary call to action", async ({ page }) => {
        await openThemed(page, theme, "/");
        // Two CTAs point at /demo; take the hero one.
        const cta = page.locator('main a[href="/demo"] button').first();
        await expect(cta).toBeVisible();
        expectReadable(await paint(page, cta), `hero CTA (${theme})`);
      });

      test("contact handoff link mirrors the primary button", async ({ page }) => {
        await openThemed(page, theme, "/contact");
        await page.getByLabel("Name").fill("Jane");
        await page.getByLabel("Email").fill("jane@example.com");
        await page.getByLabel("Message").fill("Hello!");
        await page.getByRole("button", { name: /Prepare message/i }).click();
        const link = page.getByRole("link", { name: /Open it in your email app/i });
        await expect(link).toBeVisible();
        expectReadable(await paint(page, link), `contact handoff (${theme})`);
      });

      test("header and footer body text", async ({ page }) => {
        await openThemed(page, theme, "/pricing");
        const tagline = page.locator("footer p").first();
        await expect(tagline).toBeVisible();
        expectReadable(await paint(page, tagline), `footer text (${theme})`);
        expectReadable(
          await paint(page, page.locator("header nav a").first()),
          `header nav link (${theme})`,
        );
      });
    });
  }

  test("theme is really applied, or the numbers above are meaningless", async ({ page }) => {
    // Guards the guard: if a future refactor stops honouring localStorage.theme,
    // these tests would keep passing while measuring light theme twice.
    await setTheme(page, "dark");
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const surface = await page.locator("main").first().evaluate((el) => {
      let node: HTMLElement | null = el;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return "";
    });
    // Dark surface, not the light #ffffff.
    expect(surface).not.toBe("rgb(255, 255, 255)");
  });
});
