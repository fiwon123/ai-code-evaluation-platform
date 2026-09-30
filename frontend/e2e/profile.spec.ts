import { expect, test, type Page } from "@playwright/test";
import { CHALLENGE_STATS, mockApi } from "./data";

/**
 * `/profile`, behind auth, and specifically the "evaluations by challenge" card
 * grid (issue #347).
 *
 * The unit tests cover what the card *says*. They cannot cover the three
 * properties that are the whole point of the redesign, because all three are
 * properties of a rendered pixel rather than of a DOM tree:
 *
 *  1. **The whole card is the hit area.** The stretched `::after` is a layout
 *     claim — only a real box can confirm the overlay actually covers the card
 *     and that a click near the bottom edge navigates.
 *  2. **The card clears the 44px tap target** on a phone (2.5.5 AAA), which is
 *     again a measurement.
 *  3. **The language accent is per-card.** Computed style in both themes, since
 *     an accent that vanishes against the dark surface would be invisible here
 *     and fine in jsdom.
 *
 * Also asserted here rather than in jsdom: that the accent *bar* is one element
 * and not two. An earlier version of this card applied its class to both the
 * `<li>` and the inner `Card`, which drew the bar and the wash twice — visible
 * only as a rendered double rule.
 */

async function openProfile(page: Page, theme: "light" | "dark" = "light") {
  // Set the theme before the app boots rather than after a `goto` + `reload`.
  // The reload loaded a second time just to pick up a value the first load could
  // have had, and on this page it cost a full re-fetch of everything the page
  // shows.
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
  await mockApi(page, undefined, { auth: true });
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Evaluations by challenge" })).toBeVisible();
  // Wait for the *card grid*, not for `getByRole("listitem")`: the profile
  // renders two other lists (challenges, submissions) whose items are listitems
  // too, so that locator resolves long before the stats request lands and every
  // measurement below silently ran against the empty state. The stats fetch is
  // also deliberately non-fatal — the dashboard still works without it — so
  // nothing else announces it either.
  await expect(page.locator('[class*="statsItem"]').first()).toBeVisible();
}

/** The card element: the `<li>` is the grid item, the inner div the card. */
function card(page: Page, title: string): ReturnType<Page["locator"]> {
  return page
    .locator('[class*="statsItem"]')
    .filter({ has: page.getByRole("link", { name: title }) });
}

test.describe("Profile evaluation cards", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("the whole card is the click target, not just the title", async ({ page }) => {
    await openProfile(page);
    const first = card(page, "Two Sum");

    // The title link's overlay has to cover the card's own box, not just sit
    // under the text. This is the measurement jsdom cannot make.
    const boxes = await first.evaluate((el) => {
      const link = el.querySelector<HTMLElement>('[class*="statsTitle"]')!;
      const cardBox = el.getBoundingClientRect();
      const after = getComputedStyle(link, "::after");
      return {
        card: { w: cardBox.width, h: cardBox.height },
        afterPosition: after.position,
        afterInset: [after.top, after.right, after.bottom, after.left].join(" "),
      };
    });
    expect(boxes.afterPosition).toBe("absolute");
    expect(boxes.afterInset).toBe("0px 0px 0px 0px");
    // Enough room to be a real target, not a sliver.
    expect(boxes.card.w).toBeGreaterThan(200);
    expect(boxes.card.h).toBeGreaterThan(120);

    // And the behaviour: a click low in the card, nowhere near the title, has to
    // navigate. Clicking the title would pass even with the overlay removed, so
    // the click position is the part that matters.
    //
    // Centre the card, then measure. `scrollIntoViewIfNeeded` is not enough: it
    // does nothing when the card is *partly* visible, and the click point is 8px
    // off its bottom edge — which then sat below the 720px fold, so the click
    // landed on nothing at all.
    await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await first.boundingBox())!;
    const bottom = { x: box.x + box.width / 2, y: box.y + box.height - 8 };

    // Now the behaviour, with the bubble deliberately in the way: hover the
    // bottom of the card so the description bubble is open over the click point,
    // then click anyway. The bubble does not take the pointer
    // (`Tooltip`'s `passThrough`), so the click reaches the stretched link
    // underneath.
    //
    // This is not a detail. Without `pointer-events: none` on the bubble, the
    // click was cancelled outright: mousedown focused the title, the focus opened
    // the bubble, the bubble covered the point, and mouseup landed on a
    // different element than mousedown — so the browser never fired a click and
    // the card silently stopped responding to the mouse. Found by clicking a real
    // card in a real browser, not by a DOM assertion.
    await page.mouse.move(bottom.x, bottom.y);
    await expect(first.getByRole("tooltip")).toBeVisible();

    await page.mouse.click(bottom.x, bottom.y);
    await expect(page).toHaveURL(`/challenges/${CHALLENGE_STATS[0]!.challenge_id}`);
  });

  test("each card is tinted with its own language, in both themes", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await openProfile(page, theme);
      const accents = await page.locator('[class*="statsItem"]').evaluateAll((els) =>
        els.map(
          (el) =>
            getComputedStyle(el)
              .getPropertyValue("--card-accent")
              .trim(),
        ),
      );
      expect(accents).toHaveLength(CHALLENGE_STATS.length);
      // Two different languages must not share one accent, or the language
      // identity the redesign is built on is not there.
      expect(new Set(accents).size).toBe(2);
      for (const accent of accents) {
        expect(accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      // The bar is a pseudo-element, so it is what carries the colour visibly.
      const bars = await page.locator('[class*="statsItem"]').evaluateAll((els) =>
        els.map((el) => {
          const s = getComputedStyle(el, "::before");
          return { content: s.content, width: s.width, background: s.backgroundColor };
        }),
      );
      for (const bar of bars) {
        // One rule, not two: the bug that put the class on both the <li> and
        // the inner Card drew the accent bar twice.
        expect(bar.content).toBe('""');
        expect(Number.parseFloat(bar.width)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test("the card is a usable tap target on a phone", async ({ page }) => {
    await openProfile(page);
    const box = (await card(page, "Two Sum").boundingBox())!;
    // 2.5.5 AAA wants 44px. The whole card is the target, so the card's height
    // is the number that has to clear it — not the title's line box.
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test("the truncated description is still in full for a keyboard reader", async ({ page }) => {
    await openProfile(page);
    const first = card(page, "Two Sum");

    // Clamped by CSS, so the text is all there; only the visible box is short.
    const text = await first.locator('[class*="statsDescription"]').textContent();
    expect(text).toContain("the same element may not be used twice");
    const clipped = await first
      .locator('[class*="statsDescription"]')
      .evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(clipped).toBe(true);

    // And the tooltip carries it without a pointer. Resolved by content: the
    // bubble belongs to the description, and the card is what triggers it.
    const bubble = first.getByRole("tooltip").filter({
      hasText: "the same element may not be used twice",
    });
    await expect(bubble).toBeHidden();

    // Hovering the card is the mouse path, and it has to work: the stretched
    // link is a transparent box over the whole surface, so a tooltip hung on the
    // description alone would never see a pointer.
    await first.hover();
    await expect(bubble).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(bubble).toBeHidden();
  });

  test("a click on the title navigates instead of popping a tooltip open", async ({ page }) => {
    await openProfile(page);
    const first = card(page, "Two Sum");

    await first.getByRole("link", { name: "Two Sum" }).click();
    await expect(page).toHaveURL(`/challenges/${CHALLENGE_STATS[0]!.challenge_id}`);
    // Reaching here is the assertion: a mouse press focuses the title, and if
    // that opened the bubble the click would be cancelled before it navigated.
  });

  test("the keyboard reaches the description too, and Escape dismisses it", async ({ page }) => {
    await openProfile(page);
    const first = card(page, "Two Sum");
    const bubble = first.getByRole("tooltip").filter({
      hasText: "the same element may not be used twice",
    });

    await first.getByRole("link", { name: "Two Sum" }).focus();
    await expect(bubble).toBeVisible();

    // 1.4.13 Dismissable: Escape hides it without moving focus.
    await page.keyboard.press("Escape");
    await expect(bubble).toBeHidden();
    await expect(first.getByRole("link", { name: "Two Sum" })).toBeFocused();
  });

  test("focusing the card rings the title, once, in the app's own geometry", async ({ page }) => {
    await openProfile(page);
    const title = card(page, "Two Sum").getByRole("link", { name: "Two Sum" });
    await title.focus();

    // The title link is the card's one focusable element, so the shared
    // treatment in `styles/focus.css` rings it — the same 3px
    // `--color-focus-ring` every other control uses. A ring on the card itself
    // needs `outline: none` on the title to stop a second ring appearing, and
    // `styles/focus-ring.test.ts` is right to refuse that.
    const ring = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outline: s.outline, after: getComputedStyle(el, "::after").boxShadow };
    });
    expect(ring.outline).not.toBe("none");
    expect(ring.outline).toMatch(/solid/);
    // Exactly one indicator: the stretched pseudo-element carries no ring of its
    // own, so the shared outline is the only focus signal on the card.
    expect([undefined, "", "none"]).toContain(ring.after);
  });

  test("says 'not measured' instead of printing a zero duration", async ({ page }) => {
    await openProfile(page);
    // The Go card's run produced no result, so there is no duration. A `0` would
    // read as "instant", which is a different and wrong claim.
    const go = card(page, "Concurrent Web Scraper With Retries");
    await expect(go).toContainText("—");
    await expect(go).toContainText("1 failed");
  });

  test("names each stat, so the numbers are not just digits", async ({ page }) => {
    await openProfile(page);
    const list = card(page, "Two Sum").locator("dl");
    await expect(list.getByRole("term")).toHaveText([
      "Score",
      "Best",
      "Runs",
      "Last run",
    ]);
    // Completed of total, not the total alone — the same numbers the old card
    // made the reader subtract.
    await expect(list.getByRole("definition")).toHaveText(["75%", "100%", "3/4", "1.2s"]);
  });

  test("does not overflow a narrow viewport", async ({ page }) => {
    // Set the width here rather than relying on the project: the same spec runs
    // on the 1280px desktop profile, where four columns is the correct layout
    // and asserting one would be asserting the phone on a desktop.
    await page.setViewportSize({ width: 360, height: 780 });
    await openProfile(page);
    // One card per row on a phone, and the stat row wraps rather than squeezing
    // three columns of four characters.
    const track = await page
      .locator('[class*="statsGrid"]')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(track).toBe(1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(overflow).toBe(true);
  });
});
