import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";
import {
  aaThreshold,
  contrastRatio,
  describeRatio,
  paint,
} from "./helpers/color";

/**
 * Admin table rows need visible hover feedback (#197).
 *
 * The hover rule shipped for a long time and rendered nothing:
 * `var(--color-surface-hover, var(--color-surface))` named a token that did not
 * exist, so the fallback resolved to the very surface the row was already
 * painted with. A dead fallback and a bare token are equally invisible to a
 * "does this parse" check, so these tests measure what the browser actually
 * paints: the token, the difference, and the text that has to stay readable
 * once the row changes colour.
 */

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/**
 * Open /admin/users as an admin in `theme`.
 *
 * The theme is set through `localStorage.theme` before the app boots because
 * assigning `data-theme` directly is silently reverted by the app's own theme
 * init, which would leave these tests measuring the light palette while calling
 * it dark.
 */
async function openAdminUsers(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript(
    (t) => window.localStorage.setItem("theme", t),
    theme,
  );
  await mockApi(page, undefined, { admin: true });
  await page.goto("/admin/users");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(
    page.getByRole("cell", { name: "ada@example.com" }),
  ).toBeVisible();
}

/** The palette's own token value, straight from the cascade. */
async function token(
  page: Page,
  name: "--color-surface" | "--color-surface-hover" | "--color-text-muted",
): Promise<string> {
  return page
    .evaluate(
      (n) =>
        getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
      name,
    )
    .then((v) => (v.startsWith("#") ? normalise(v) : v));
}

function normalise(hex: string): string {
  return `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(
    hex.slice(5, 7),
    16,
  )})`;
}

for (const theme of THEMES) {
  test.describe(`admin table row hover (${theme})`, () => {
    test("a resting row is the plain surface, and hovering moves it", async ({
      page,
    }) => {
      await openAdminUsers(page, theme);
      const row = page.locator("tbody tr").first();

      // At rest the row is transparent over the card, i.e. the plain surface.
      // Asserted first so "hover differs from rest" cannot be satisfied by the
      // whole table being tinted.
      const resting = await paint(page, row);
      expect(resting.background, "row should start on the plain surface").toBe(
        await token(page, "--color-surface"),
      );

      await row.hover();
      const hovered = await paint(page, row);
      expect(
        hovered.background,
        "hovering a row should paint --color-surface-hover",
      ).toBe(await token(page, "--color-surface-hover"));
      expect(
        hovered.background,
        "the hover token resolved to the surface itself, so the hover is a no-op",
      ).not.toBe(resting.background);
    });

    test("hovered rows keep the muted 12px cell at WCAG AA", async ({
      page,
    }) => {
      await openAdminUsers(page, theme);
      const row = page.locator("tbody tr").first();
      await row.hover();

      // The email under each username is --color-text-muted at 12px, the
      // tightest pair on the row: in the dark palette it has only 0.48 of AA
      // headroom at rest, which is why the dark hover darkens instead of
      // lightening (see docs/DESIGN_SYSTEM.md).
      // The SPAN, not the cell: the email is a `.cellMuted` span inside the td,
      // and the td itself inherits the regular text colour. Measuring the td
      // (as this did first) reports 15:1 while the text a human actually reads
      // is the muted one — the assertion passed on a real contrast regression.
      const muted = await paint(page, page.getByText("ada@example.com"));
      expect(
        muted.color,
        "this should be measuring the --color-text-muted span; if the selector " +
          "drifts to an element that inherits the regular text colour, this " +
          "test silently stops covering the tightest pair on the row",
      ).toBe(await token(page, "--color-text-muted"));
      expect(
        contrastRatio(muted.color, muted.background),
        describeRatio("muted email cell on a hovered row", muted),
      ).toBeGreaterThanOrEqual(aaThreshold(muted));
    });

    test("keyboard focus gives the same feedback as hover", async ({
      page,
    }) => {
      await openAdminUsers(page, theme);
      const row = page.locator("tbody tr").first();

      // Focus lands INSIDE the row (its actions are buttons), never on the row
      // itself, so :focus-within is the only way a keyboard user sees which row
      // they are on.
      await row.getByRole("button", { name: "Deactivate" }).focus();
      const focused = await paint(page, row);
      expect(
        focused.background,
        "focusing a control in a row should paint the same hover surface",
      ).toBe(await token(page, "--color-surface-hover"));
    });
  });
}
