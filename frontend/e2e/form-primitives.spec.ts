import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * `/challenges/new` is behind auth, and the honest way in is the same one
 * `challenge-create.spec.ts` uses: mock an authenticated session and go
 * straight to the page. Waiting on the page heading rather than the breadcrumb,
 * because a shell that never rendered the form would still show the crumb.
 */
async function openCreateForm(page: Page): Promise<void> {
  await mockApi(page, undefined, { auth: true });
  await page.goto("/challenges/new");
  await expect(page.getByRole("heading", { name: "Create a challenge" })).toBeVisible();
}

/**
 * The two shared form primitives, asserted as a user meets them.
 *
 * The unit tests cover `BadgeSelect`'s semantics and the chevron's hardcoded
 * stroke hexes. Neither can answer the questions that actually mattered here:
 * whether the arrow is *legible on a real dark page* and whether the difficulty
 * grid is *reachable on a real phone* — both of which are properties of a
 * rendered pixel, not of a DOM tree.
 */
test.describe("Shared form primitives", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`draws its own select arrow, inset and theme-correct (${theme})`, async ({
      page,
    }) => {
      await page.goto("/challenges");
      await page.evaluate((t) => localStorage.setItem("theme", t), theme);
      await page.reload();

      // The language filter, not the difficulty one: difficulty is a radio
      // group of badges now, so it is no longer a `SelectInput` to measure.
      // The sort control beside it is the other candidate — same primitive,
      // same page, same assertion.
      const select = page.getByLabel("Filter by language");
      await expect(select).toBeVisible();

      const rendered = await select.evaluate((el) => {
        const cs = getComputedStyle(el);
        const stroke = /stroke='%23([0-9A-Fa-f]{6})'/.exec(cs.backgroundImage);
        return {
          appearance: cs.appearance || (cs as unknown as { webkitAppearance: string }).webkitAppearance,
          stroke: stroke ? `#${stroke[1].toLowerCase()}` : null,
          token: getComputedStyle(document.documentElement)
            .getPropertyValue("--color-text-secondary")
            .trim()
            .toLowerCase(),
          position: cs.backgroundPosition,
          padLeft: parseFloat(cs.paddingLeft),
          padRight: parseFloat(cs.paddingRight),
        };
      });

      // The platform arrow is what this replaces; if `appearance` ever creeps
      // back to `auto` the whole point of the change is lost silently.
      expect(rendered.appearance).toBe("none");
      expect(rendered.stroke).not.toBeNull();
      // The stroke is a literal because a data-URI SVG cannot resolve a token,
      // so the only thing keeping it honest is this comparison.
      expect(rendered.stroke).toBe(rendered.token);
      // `right <space-3> center` resolves to `calc(100% - 12px)`: inset from
      // the edge by the same padding the text has on the left.
      expect(rendered.position).toBe("calc(100% - 12px) 50%");
      // A gutter wide enough for the 12x8 arrow, strictly more than the text's
      // left inset, so a long option is truncated by the control rather than
      // overlapped by the chevron.
      expect(rendered.padRight).toBeGreaterThan(rendered.padLeft + 12);
    });
  }

  test("the difficulty grid is one tab stop with a badge per option", async ({
    page,
  }) => {
    await openCreateForm(page);

    const group = page.getByRole("group", { name: "Difficulty" });
    await expect(group).toBeVisible();

    const radios = group.getByRole("radio");
    await expect(radios).toHaveCount(3);

    // Keyboard: one Tab reaches the group, arrows move within it. If this ever
    // becomes a row of buttons it is 3 tab stops and the test fails.
    await group.getByRole("radio", { name: "Medium" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { name: "Hard" })).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(group.getByRole("radio", { name: "Medium" })).toBeChecked();

    // Coloured, not bare text.
    //
    // Asserting "there is a Badge element" would mean matching a hashed CSS
    // module class, and would pass just as happily against a badge whose variant
    // had collapsed to neutral for all three. What the design actually needs is
    // that the three options are visually distinguishable, so read the rendered
    // colours and require them to differ.
    const colors = await group
      .locator("label")
      .evaluateAll((labels) =>
        labels.map((label) => {
          const badge = label.querySelector("span span");
          const cs = getComputedStyle(badge!);
          return `${cs.color}|${cs.backgroundColor}|${cs.borderColor}`;
        }),
      );
    expect(colors).toHaveLength(3);
    expect(new Set(colors).size).toBe(3);
  });

  test("the difficulty grid does not overflow a narrow viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openCreateForm(page);

    const group = page.getByRole("group", { name: "Difficulty" });
    await expect(group).toBeVisible();

    // Horizontal overflow is the failure mode a fixed column count produces on
    // a 360px screen; the grid is `auto-fill` + `minmax(min(…), 100%)` so it
    // reflows instead.
    const overflow = await group.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        right: Math.round(rect.right),
        docWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(overflow.right).toBeLessThanOrEqual(overflow.docWidth);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.docWidth);
  });
});
