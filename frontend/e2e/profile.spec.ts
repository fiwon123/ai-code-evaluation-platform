import { expect, test, type Page } from "@playwright/test";
import { expectReadable } from "./helpers/color";
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

    // And the bubble is actually placed below its trigger, not stacked on it.
    // jsdom does no layout, so `position: relative` on the Tooltip's wrapper is
    // invisible to the unit tests; only a rendered box can tell.
    const geometry = await first.evaluate((el) => {
      const trigger = el.querySelector<HTMLElement>('[class*="statsDescription"]')!;
      const tip = el.querySelector<HTMLElement>('[role="tooltip"]')!;
      const t = trigger.getBoundingClientRect();
      const b = tip.getBoundingClientRect();
      return { gap: b.top - t.bottom, overlap: b.top < t.bottom && b.bottom > t.top };
    });
    expect(geometry.overlap).toBe(false);
    // The gap is the point, not just "below": it proves the bubble anchors to
    // its *trigger*. Drop `position: relative` from the Tooltip's wrapper and the
    // bubble still lands below the trigger — 102px lower, measured against the
    // card instead, overlapping the stats it was meant to sit under. jsdom does
    // no layout, so only a rendered box catches that.
    expect(geometry.gap).toBeGreaterThanOrEqual(0);
    expect(geometry.gap).toBeLessThan(16);

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

/**
 * The two dashboard lists (issue #348).
 *
 * Everything here is a measurement, because "aligned" is not a property a DOM
 * assertion can make. The unit tests check that each card *says* the right
 * things; what this file has to settle is that the two columns share one height
 * rhythm, and that is a box-model fact.
 *
 * The fixture carries submissions of deliberately mixed height — two completed
 * with results (test count, duration, tooltip and share controls) and one still
 * processing with none of them. A fixture of uniform rows cannot tell a fixed
 * rhythm from an accidental one, and the old layout's bug only appeared in the
 * mixed case.
 *
 * Three defects were found here that no unit test could see, each of which
 * asserted the card was aligned while it was not:
 *
 *  1. Each column sized itself to its own tallest card — 224px against 233px — so
 *     *every* row sat 9px off, not merely the last.
 *  2. The "My challenges" column header was 44px and the other 24px, because one
 *     holds a `New` button and the other only a heading. That alone pushed the
 *     right column's first card 20px above the left one's, with the cards
 *     themselves irrelevant to it.
 *
 * The first was invisible to the unit tests and the second to every test but this
 * one, which is the argument for measuring rather than asserting on the DOM.
 */
async function openLists(page: Page, theme: "light" | "dark" = "light") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
  await mockApi(page, undefined, { auth: true });
  await page.goto("/profile");
  // Proved, not assumed. The app re-applies the stored theme on boot, so a run
  // that thinks it is measuring dark while measuring light would report the
  // light theme's numbers as if they were the dark theme's — every assertion
  // below silently about the wrong theme. The same trap `contrast.spec.ts`
  // documents, and the reason it checks the attribute rather than setting it.
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  // Both columns in full, not just one card. The submissions' shortest card is
  // the processing one and the challenges' tallest is a two-line title, so waiting
  // on a single card measures the page mid-load.
  await expect(page.getByRole("heading", { name: "Recent submissions" })).toBeVisible();
  await expect(page.locator('[class*="listCard"]')).toHaveCount(6);
}

/**
 * A submission row, found by its status badge.
 *
 * Not by its link text: `SubmissionRead` carries no `challenge_title`, so a
 * submission card names no challenge and its link is addressed only by id.
 * Keyed on the badge because "completed" appears once per row and nowhere else
 * in the column.
 */
function submissionRow(page: Page, status: "completed" | "processing" | "failed") {
  return column(page, "Recent submissions").filter({
    has: page.getByText(status, { exact: true }),
  });
}

/** One column's cards, scoped by its heading. */
function column(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading })
    .locator("xpath=ancestor::section[1]")
    .locator('[class*="listCard"]');
}

/** `top`/`bottom` for every card in a column, in document order. */
async function edges(page: Page, heading: string) {
  return column(page, heading).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }),
  );
}

/** True when the two lists sit side by side rather than stacked. */
async function sideBySide(page: Page) {
  return page.evaluate(() => {
    const pick = (h2: string) =>
      Array.from(document.querySelectorAll("section")).find(
        (s) => s.querySelector("h2")?.textContent === h2,
      )!.getBoundingClientRect();
    return Math.abs(pick("My challenges").top - pick("Recent submissions").top) < 4;
  });
}

test.describe("Profile list alignment", () => {
  test("both columns give every card the same height", async ({ page }) => {
    await openLists(page);
    for (const heading of ["My challenges", "Recent submissions"]) {
      const heights = await column(page, heading).evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().height)),
      );
      expect(heights.length, `${heading} should have cards`).toBeGreaterThan(0);
      // A tolerance rather than exact equality: sub-pixel rounding on a
      // fractional column width is real, and `toBe` would fail on the browser's
      // arithmetic instead of on a regression.
      expect(
        Math.max(...heights) - Math.min(...heights),
        `${heading} card heights differ: ${heights.join(", ")}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("the two columns' cards line up row by row", async ({ page }) => {
    await openLists(page);
    if (!(await sideBySide(page))) {
      test.skip(true, "one column at this width — there is nothing to line up");
    }
    // The actual issue: side by side, the columns must not stair-step. Compared
    // row by row rather than as a set, because "aligned" for two lists of
    // possibly-unequal length means the rows they share are in the same place.
    expect(await edges(page, "My challenges")).toEqual(await edges(page, "Recent submissions"));
  });

  test("no card's controls overhang its own box", async ({ page }) => {
    // A standing invariant rather than a caught bug: a card whose contents extend
    // past its bottom is not aligned with anything, however uniform its
    // neighbours are. This was checked against the pre-fix layout too and passed
    // there as well — an earlier draft of this file credited it with catching a
    // 9px overhang that measurement showed never happened, so the claim was
    // withdrawn along with the CSS change made to address it. Kept because a
    // future layout change could reintroduce it.
    await openLists(page);
    const overhang = await page.locator('[class*="listCard"]').evaluateAll((els) =>
      els.flatMap((el) => {
        const card = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll('[class*="listFoot"], [class*="listStats"], [class*="listShare"]'))
          .map((child) => {
            const r = child.getBoundingClientRect();
            return Math.round(r.bottom - card.bottom);
          })
          .filter((over) => over > 1);
      }),
    );
    expect(overhang, "controls sticking out past their card").toEqual([]);
  });

  test("the columns stay uniform when they stack into one", async ({ page }) => {
    // Below the two-column breakpoint the cross-column assertion cannot apply, so
    // each column is held to its own internal uniformity — and to the 44px AAA tap
    // target, which is the one requirement a phone actually adds.
    // Sets the viewport itself rather than relying on which project is running:
    // as a desktop-only assertion it would silently pass on a wide screen and as
    // an unconditional one it fails on a wide screen. Asking for the phone width
    // makes it mean the same thing in both projects.
    await page.setViewportSize({ width: 412, height: 915 });
    await openLists(page);
    expect(await sideBySide(page), "columns should be stacked at 412px").toBe(false);
    for (const heading of ["My challenges", "Recent submissions"]) {
      const boxes = await column(page, heading).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { h: Math.round(r.height), w: Math.round(r.width) };
        }),
      );
      expect(
        Math.max(...boxes.map((b) => b.h)) - Math.min(...boxes.map((b) => b.h)),
        `${heading} heights differ once stacked`,
      ).toBeLessThanOrEqual(1);
      expect(Math.min(...boxes.map((b) => b.w))).toBeGreaterThanOrEqual(44);
    }
  });

  test("a completed row carries its test count, duration and breakdown", async ({ page }) => {
    await openLists(page);
    const row = submissionRow(page, "completed");
    // `exact`: the bubble's own text contains the word "Tests" ("118 of 120 tests
    // passed"), and a substring match would make this assert against whichever of
    // the two happened to come first in the DOM.
    await expect(row.getByText("Tests", { exact: true })).toBeVisible();
    await expect(row.getByText("118/120")).toBeVisible();
    await expect(row.getByText("Duration")).toBeVisible();
    await expect(row.getByText("4.2s")).toBeVisible();
    // The digest the count stands in for, without a mouse in the way.
    await row.getByText("118/120").hover();
    await expect(page.getByRole("tooltip")).toContainText("118 of 120 tests passed");
    await expect(page.getByRole("tooltip")).toContainText("FAILED test_duplicate_indices");
  });

  test("the breakdown is reachable and dismissible from the keyboard", async ({ page }) => {
    // "Keyboard-accessible" here is a claim about a real tab stop, not about an
    // aria attribute that happens to be present. `Tooltip` moves the stop onto its
    // own wrapper because a `<dd>` cannot hold focus.
    await openLists(page);
    const value = page.locator('[class*="statMore"]').first();
    // Focused on whatever actually carries the tab stop, rather than assuming
    // the value element is it: `Tooltip` moves the stop to its wrapper because a
    // `<dd>` cannot hold focus. Focusing the wrong node would make this test pass
    // for the wrong reason, or fail for one.
    await value.evaluate((el) => {
      const stop = (el.closest("[tabindex]") ?? el) as HTMLElement;
      stop.focus();
    });
    // The bubble is a *sibling* of the trigger inside the wrapper, not an
    // ancestor, so it is asserted by role rather than by walking up from the
    // value. The closed bubble is `visibility: hidden`, which is what makes the
    // visible/hidden pair below a real check of the open state.
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toBeHidden();
  });

  test("the breakdown bubble does not swallow the click meant for the row", async ({ page }) => {
    // #347's bug in a new place. Asserted by the navigation itself: a full-card
    // overlay still lets the topmost element win, so "does the click work" is not
    // a sufficient probe on its own.
    await openLists(page);
    const row = submissionRow(page, "completed");
    await row.getByText("118/120").hover();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await row.locator('[class*="listLink"]').click({ position: { x: 40, y: 8 } });
    await expect(page).toHaveURL(/\/submissions\//);
  });

  test("a submission row names its language, provider and model", async ({ page }) => {
    await openLists(page);
    const row = submissionRow(page, "completed");
    await expect(row.getByText("Python")).toBeVisible();
    await expect(row.getByText("demo · demo")).toBeVisible();
    // A row with no model shows the provider alone, not a trailing separator.
    const failed = submissionRow(page, "failed");
    await expect(failed.getByText("anthropic · claude-sonnet-4")).toBeVisible();
    // An in-flight row reports progress instead: the model may not even have
    // been chosen yet, and a stale provider next to a live timer reads as a
    // claim about work that has not happened.
    await expect(submissionRow(page, "processing").getByText(/^waiting /)).toBeVisible();
  });

  test("a challenge card joins its own rollup, and admits when it has none", async ({ page }) => {
    // `c-easy-1` has a rollup entry and `c-med-1` does not, so both branches of
    // the join are on screen at once. A fixture where every challenge has stats
    // cannot tell a working join from a constant.
    await openLists(page);
    const joined = column(page, "My challenges").filter({
      has: page.getByRole("link", { name: "Two Sum" }),
    });
    await expect(joined.getByText("3/4")).toBeVisible();
    await expect(joined.getByText(/Last evaluated/)).toBeVisible();
    await expect(joined.getByText("100%")).toBeVisible();

    const unjoined = column(page, "My challenges").filter({
      has: page.getByRole("link", { name: "LRU Cache" }),
    });
    await expect(unjoined.getByText("Not evaluated yet")).toBeVisible();
    await expect(unjoined.getByText(/^Created/)).toBeVisible();
    // Difficulty comes from the shared vocabulary, so the pill is the one #346
    // held to contrast rather than a local mapping that could drift from it.
    await expect(unjoined.getByText("Medium")).toBeVisible();
  });

  test("the dark theme holds the same alignment", async ({ page }) => {
    // The floor is a fixed pixel value but the gaps around it are tokens, and
    // tokens are per-theme, so a light run is not evidence about dark. This is
    // the same lesson as #346's badge: the theme you happen to be looking at is
    // not a measurement of the other one.
    await openLists(page, "dark");
    if (await sideBySide(page)) {
      expect(await edges(page, "My challenges")).toEqual(
        await edges(page, "Recent submissions"),
      );
    }
    for (const heading of ["My challenges", "Recent submissions"]) {
      const heights = await column(page, heading).evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().height)),
      );
      expect(
        Math.max(...heights) - Math.min(...heights),
        `${heading} heights differ in dark`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("the status badges stay readable in both themes", async ({ page }) => {
    // Rendered, not read from the stylesheet: the processing pill is the one
    // #346 had to fix, and it measured 3.13:1 in dark against its own tint before
    // `--color-primary-strong` existed. Asserting the token would have passed
    // anyway — the defect was the *pairing*, and only painting both proves it.
    for (const theme of ["light", "dark"] as const) {
      await openLists(page, theme);
      for (const status of ["completed", "failed", "processing"] as const) {
        await expectReadable(
          page,
          submissionRow(page, status).locator('[class*="badge"]').first(),
          `${theme} ${status} badge`,
        );
      }
    }
  });

  test("the em dash stands in for a value that was never measured", async ({ page }) => {
    // The in-flight row has no result, so no score, no duration and no test count.
    // All three must read "no value" rather than `0` — a zero score is a claim
    // about quality, and a zero duration reads as instant.
    await openLists(page);
    const processing = submissionRow(page, "processing");
    // Each dash is labelled, so a screen reader hears why the value is missing
    // rather than announcing an em dash three times in a row.
    await expect(processing.getByLabel("no score yet")).toHaveText("—");
    await expect(processing.getByLabel("not measured")).toHaveText("—");
    await expect(processing.getByLabel("no test results yet")).toHaveText("—");
  });
});
