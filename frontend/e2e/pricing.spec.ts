import { expect, test } from "@playwright/test";
import { mockApi } from "./data";

/**
 * The plan comparison table, read the way a screen reader reads it.
 *
 * The unit tests assert the same names from the DOM. These exist for the two
 * things only a browser can settle: that the visually-hidden text is *actually*
 * invisible (a broken clip recipe would render "Not included" in every cell and
 * wreck the table while the DOM assertions still passed), and that the table
 * still scrolls inside its wrapper on a narrow screen.
 */
test.describe("Pricing comparison table", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockApi(page);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`marks every yes/no cell and hides the label text (${theme})`, async ({
      page,
    }) => {
      await page.goto("/pricing");
      await page.evaluate((t) => localStorage.setItem("theme", t), theme);
      await page.reload();

      const table = page.getByRole("table");
      await expect(table).toBeVisible();

      // Seven capabilities, four columns.
      await expect(table.getByRole("row")).toHaveCount(8); // header + 7

      // The accessible names resolve on every yes/no cell, in both directions.
      // Counted from the data: Private challenges is [no, yes, yes] and both
      // enterprise rows are [no, no, yes] — so 5 exclusions and 4 inclusions.
      // `exact: true` is load-bearing: `getByText("Included")` defaults to a
      // case-insensitive *substring* match, so it also matches "Not included"
      // and the count silently doubles to 9.
      await expect(
        table.getByText("Not included", { exact: true }),
      ).toHaveCount(5);
      await expect(table.getByText("Included", { exact: true })).toHaveCount(4);

      // The label text must be invisible but present: a zero-size box is the
      // recipe working. Anything with real geometry would be a visible
      // "Not included" sitting in every cell.
      const label = table.getByText("Not included", { exact: true }).first();
      const box = await label.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      expect(box.w).toBeLessThanOrEqual(1);
      expect(box.h).toBeLessThanOrEqual(1);

      // The glyphs are real SVGs, not text characters — a text "✓" inherits the
      // cell's font and cannot be coloured independently.
      await expect(table.locator("svg")).toHaveCount(9);
    });
  }

  test("the two marks are different colours", async ({ page }) => {
    await page.goto("/pricing");
    const table = page.getByRole("table");
    // `locator.evaluateAll` does NOT wait for the locator to match — it resolves
    // the selector immediately. The route is lazy, so without this the array is
    // empty and the assertion below "passes" on a count of zero distinct
    // colours from zero icons.
    await expect(table.locator("svg")).toHaveCount(9);

    const colors = await table
      .locator("svg")
      .evaluateAll((icons) =>
        icons.map((icon) => getComputedStyle(icon).color),
      );
    // 9 marks: 5 crosses + 4 checks. Two distinct colours, and both are actually
    // painted — colour is the fast channel for scanning which rows differ.
    expect(new Set(colors).size).toBe(2);
    for (const color of colors) {
      expect(color).not.toBe("rgb(0, 0, 0)");
    }
  });

  test("still scrolls inside its wrapper on a narrow screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/pricing");
    // The route is lazy, and `page.evaluate` runs immediately — measuring before
    // the table commits reads the Suspense fallback, where the wrapper does not
    // exist yet and `querySelector` returns null.
    await expect(page.getByRole("table")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const wrap = document.querySelector("[class*='tableWrap']")!;
      const table = wrap.querySelector("table")!;
      return {
        pageScrollWidth: document.documentElement.scrollWidth,
        pageWidth: document.documentElement.clientWidth,
        wrapScrollWidth: wrap.scrollWidth,
        wrapClientWidth: wrap.clientWidth,
        tableWidth: table.getBoundingClientRect().width,
      };
    });

    // The page must not overflow…
    expect(metrics.pageScrollWidth).toBeLessThanOrEqual(metrics.pageWidth);
    // …and the table must be wider than its wrapper, which is what makes the
    // horizontal scroll happen inside the wrapper rather than nowhere.
    expect(metrics.wrapScrollWidth).toBeGreaterThan(metrics.wrapClientWidth);
    // At its 560px `min-width` — so the scroll above is the table's own floor
    // being respected, not some other element leaking width into the wrapper.
    expect(metrics.tableWidth).toBeGreaterThanOrEqual(560);

    // The first assertion is a trap worth naming: the visually-hidden "Not
    // included" text is `position: absolute`, and an absolutely-positioned box is
    // only clipped by an ancestor's `overflow` when that ancestor is what it
    // positions against. `.tableWrap` is `static`, so before the mark declared
    // `position: relative` the hidden text escaped the wrapper's clip entirely
    // and measured 481px wide on a 360px screen — the page grew a scrollbar
    // while the table it was hiding inside looked perfectly contained. Nothing
    // in jsdom can see this: there is no layout engine there, so the assertion
    // above is the only place it can be caught.
  });
});

/**
 * The FAQ disclosure animation.
 *
 * The glyph (`+` → `×`) eased over 200ms while the native `<details>` answer
 * popped with no transition at all, so the two halves were visibly
 * disconnected. Four independent visual reviews reported it, and the closing
 * half reads as a defect rather than a taste question: a *collapsed* row still
 * showing a `×` for the first ~160ms.
 *
 * The fix routes both through one custom property, `--faq-reveal`, so the two
 * curves cannot drift apart in a later edit. These tests lock that in. They are
 * the only automated guard for it: jsdom has no layout engine and no `::after`
 * geometry, so "the answer's height and the glyph's rotation move together" is
 * not expressible as a unit test at all.
 */
test.describe("Pricing FAQ disclosure", () => {
  test.beforeEach(async ({ page }) => {
    // Deliberately NOT `reducedMotion: "reduce"` — the whole point is to sample a
    // transition in flight, and under `reduce` both halves snap instantly and
    // every assertion below becomes vacuous.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockApi(page);
  });

  test("the answer and the glyph animate on the same curve", async ({
    page,
  }) => {
    await page.goto("/pricing");
    await expect(page.locator("[class*='faqItem']").first()).toBeVisible();

    // Stretch the real transition rather than replacing it with something
    // synthetic: `--faq-reveal` is the single knob both halves read, so this
    // slows the production animation instead of mocking one.
    await page.addStyleTag({
      content: "[class*='faqItem'] { --faq-reveal: 2000ms !important; }",
    });

    const samples = await page.evaluate(async () => {
      const item =
        document.querySelector<HTMLDetailsElement>("[class*='faqItem']")!;
      const summary = item.querySelector("summary")!;
      item.open = true;

      const out: { t: number; panel: number; deg: number }[] = [];
      const start = performance.now();
      // Run until the transition is *done*, not for a fixed wall-clock slice.
      // A time-boxed loop silently changes what it measures when the machine is
      // busy: `requestAnimationFrame` throttles, the window expires early, and
      // the sample count collapses. That first showed up as a failure only under
      // the full suite's 3 workers while passing every time the spec ran alone,
      // which is the worst kind of flake — it looks like a real regression.
      // Sampling to completion means the collected ramp is the whole ramp
      // regardless of frame rate, and `settled` ends the loop on the data
      // itself. The 20s ceiling is a runaway backstop, not the normal exit.
      const CEILING = 20000;
      await new Promise<void>((resolve) => {
        let settled = 0;
        const tick = () => {
          const elapsed = performance.now() - start;

          // The panel is whatever height the details box has grown by beyond the
          // summary. Reading it this way tracks the `::details-content`
          // `block-size` interpolation, which is what the fix animates.
          const panel =
            item.getBoundingClientRect().height -
            summary.getBoundingClientRect().height;

          // `transform` is the literal "none" before the first transition frame,
          // which DOMMatrixReadOnly rejects; the identity matrix is rotate(0deg).
          const transform = getComputedStyle(summary, "::after").transform;
          const matrix =
            transform === "none"
              ? new DOMMatrix()
              : new DOMMatrixReadOnly(transform);
          const deg = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;

          out.push({ t: elapsed, panel, deg });

          // Both halves have to hold still before the run counts as finished —
          // requiring the pair stops one early-settling half from ending it.
          const previous = out[out.length - 2];
          const still =
            previous !== undefined &&
            panel === previous.panel &&
            deg === previous.deg;
          settled = still ? settled + 1 : 0;

          if (settled >= 3 || elapsed > CEILING) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return out;
    });

    // A floor low enough to survive a throttled frame rate but high enough that a
    // single snap — one sample at rest, one at the end — still cannot pass.
    expect(samples.length).toBeGreaterThan(8);

    // Normalise each half to its own 0-100 range: the panel to its open height,
    // the glyph to its 45deg. "In step" is then a direct comparison, which is
    // the thing that was broken.
    const openHeight = Math.max(...samples.map((s) => s.panel));
    expect(openHeight).toBeGreaterThan(20); // the answer really did grow

    const ramp = samples.map((s) => ({
      panel: (s.panel / openHeight) * 100,
      glyph: (s.deg / 45) * 100,
    }));

    // Both halves must actually move. Counting distinct values catches a
    // transition that never ran at all, which a "did it change?" test would not:
    // two identical frames differ from each other in neither, but a transition
    // that jitters between two states would pass a `> 0` check.
    expect(new Set(ramp.map((s) => Math.round(s.panel))).size).toBeGreaterThan(
      8,
    );
    expect(new Set(ramp.map((s) => Math.round(s.glyph))).size).toBeGreaterThan(
      8,
    );

    // The regression, in the terms the bug had: at no point may the answer be
    // essentially finished while the glyph is still early. Before the fix the
    // panel snapped to 100% on the first frame and sat there, so this fired on
    // essentially every sample of the ramp.
    const worst = Math.max(...ramp.map((s) => Math.abs(s.panel - s.glyph)));
    expect(worst).toBeLessThan(5);

    // And the other direction, which the same fix has to hold: no frame where
    // the glyph has arrived at `×` but the panel is still growing.
    const finishedEarly = ramp.filter((s) => s.glyph >= 95 && s.panel < 80);
    expect(finishedEarly).toHaveLength(0);
  });

  test("centres the glyph on a wrapped question and keeps them apart", async ({
    page,
  }) => {
    // 360px is the narrowest width the sweep covers and the only one where the
    // FAQ questions wrap, so it is the only width where glyph centring is a
    // question at all. At 412px and up nothing wraps and the property is inert.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/pricing");
    await expect(page.locator("[class*='faqItem']").first()).toBeVisible();

    // Not "the first question": at 360px the shortest one still fits on a
    // single line, and a hardcoded index silently stops exercising the wrap the
    // moment a copy edit changes which questions are long. Find the first
    // question that actually wraps instead, and assert that one exists — a
    // vacuous pass on a single-line row would look like success.
    const wrappedIndex = await page.evaluate(() => {
      const lineCount = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        // Real line boxes, not an estimate: `getClientRects` on a Range over the
        // text gives one box per rendered line, the only way to tell a wrapped
        // question from a padded one.
        return Array.from(range.getClientRects())
          .filter((r) => r.height > 0)
          .map((r) => Math.round(r.top))
          .filter((t, i, a) => a.indexOf(t) === i).length;
      };
      const summaries = Array.from(
        document.querySelectorAll("[class*='faqItem'] summary"),
      );
      return summaries.findIndex((s) => lineCount(s) > 1);
    });
    expect(
      wrappedIndex,
      "no FAQ question wraps at 360px",
    ).toBeGreaterThanOrEqual(0);

    const summary = page
      .locator("[class*='faqItem'] summary")
      .nth(wrappedIndex);

    // The mechanism: `align-items: center` on the summary's flex row centres the
    // glyph on the cross axis, so it tracks the *whole* wrapped block rather
    // than the first line — and `flex: none` keeps it from being squeezed by
    // `justify-content: space-between`. Pixel-level confirmation that the
    // rendered result really is centred lives in the visual sweep, which
    // measured a constant sub-pixel offset; this guards the contract.
    const styles = await summary.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        alignItems: cs.alignItems,
        glyphFlex: getComputedStyle(el, "::after").flex,
      };
    });
    expect(styles.alignItems).toBe("center");
    expect(styles.glyphFlex).toContain("0 0 auto");

    // The text must not run under the glyph. `space-between` pins the glyph to
    // the right edge, so the text's right edge has to stop short of it.
    const gap = await summary.evaluate((el) => {
      const contentRight =
        el.getBoundingClientRect().right -
        parseFloat(getComputedStyle(el).paddingRight);
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 0,
      );
      const textRight = Math.max(...rects.map((r) => r.right));
      // The glyph's column begins at the summary's right padding edge, and the
      // row's `gap` is what separates it from the text. Anything at or past it
      // means the question has run under the `+`.
      return contentRight - textRight;
    });
    expect(gap).toBeGreaterThan(8);
  });
});
