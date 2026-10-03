import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * Layout containment for the Home page's two closing sections (#355).
 *
 * These are the only places on the page where decoration is drawn *behind*
 * content rather than in its own box, so they are the only places where a CSS
 * mistake shows up as text sitting on a blob instead of as a missing class.
 * `ambient-motion.spec.ts` asserts the styling contract — resting opacity, z
 * order, `pointer-events` — but a contract can hold while the geometry is still
 * wrong: a ring 900px across centred on a 600px banner is a correct z-index laid
 * over the sentence it is meant to sit behind.
 *
 * So these measure. Only a real browser has a layout engine, and there is no
 * image review in the loop for this suite — the numbers are the review.
 *
 * Everything inside a `page.evaluate` runs against the browser's globals, so the
 * rect-to-box conversions are inlined in the evaluate bodies rather than shared
 * with the Node side, where they would not exist.
 */

/** The two boxes that must stay readable, and the two layers behind them. */
const SELECTORS = {
  // The banner, and only the banner. `[class*="cta"]` also matches `_ctaRing_`,
  // `_ctaAura_`, `_ctaTitle_`, `_ctaText_` and the two `_ctaPrimary`/
  // `_ctaSecondary` button modifiers, so it resolves to seven elements and the
  // spec fails on strict mode before it measures anything. `_cta_` is the only
  // substring unique to the panel: the neighbours spell `_ctaRing_`, so the
  // trailing underscore is what separates them.
  banner: '[class*="_cta_"]',
  ring: '[class*="ctaRing"]',
  aura: '[class*="ctaAura"]',
  title: '[class*="ctaTitle"]',
  text: '[class*="ctaText"]',
  // The primary call to action itself, not the row that holds it. The row wraps
  // to two stacked buttons at 360px, so its centre lands in the flex gap and
  // probes nothing; the button's own centre is unambiguous at any width.
  action: '[class*="_cta_"] a',
  teaserPanel: '[class*="teaserPanel"]:not([class*="teaserPanelWrap"])',
  teaserRow: '[class*="teaserRow"], [class*="teaserScoreRow"]',
} as const;

async function openHome(page: Page) {
  await mockApi(page, undefined, { auth: true });
  await page.goto("/");
  await expect(page.locator(SELECTORS.banner)).toHaveCount(1);
  await page.locator(SELECTORS.banner).scrollIntoViewIfNeeded();
}

test.describe("Home closing sections hold their layout (#355)", () => {
  test("the teaser log never overflows its panel, at either width", async ({ page }) => {
    await openHome(page);

    // Measured rather than asserted from the stylesheet: `overflow-wrap:
    // anywhere` is a claim about the rule, and a real run log is a claim about
    // the words. The endpoint and the metric key are the two unbreakable tokens.
    const worst = await page.evaluate((sel) => {
      const panel = document.querySelector(sel.teaserPanel)!;
      const pr = panel.getBoundingClientRect();
      const rows = [...document.querySelectorAll(sel.teaserRow)];
      return {
        offenders: rows
          .map((row) => {
            const r = row.getBoundingClientRect();
            return {
              text: row.textContent?.slice(0, 40) ?? "",
              right: Math.round(r.right - pr.right),
              left: Math.round(pr.left - r.left),
              scroll: row.scrollWidth - row.clientWidth,
            };
          })
          .filter((o) => o.right > 1 || o.left > 1 || o.scroll > 1),
        panelScroll: panel.scrollWidth - panel.clientWidth,
        pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    }, SELECTORS);

    expect(worst.offenders, "a teaser row spills out of its panel").toEqual([]);
    expect(worst.panelScroll, "the teaser panel scrolls sideways").toBeLessThanOrEqual(1);
    // The failure mode a reviewer actually reports: a horizontal scrollbar on
    // the whole landing page, which makes the hero shift as you scroll.
    expect(worst.pageScroll, "the page gained a horizontal scrollbar").toBeLessThanOrEqual(1);
  });

  test("the ring is laid out, clipped, and never intercepts a click", async ({ page }) => {
    await openHome(page);

    const geo = await page.evaluate((sel) => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const q = (s: string) => document.querySelector(s)!;
      return {
        banner: box(q(sel.banner)),
        ring: box(q(sel.ring)),
        aura: box(q(sel.aura)),
        bannerOverflow: getComputedStyle(q(sel.banner)).overflow,
        ringPosition: getComputedStyle(q(sel.ring)).position,
        auraPosition: getComputedStyle(q(sel.aura)).position,
        // Which element receives a click at the centre of each content box.
        //
        // Each box is scrolled into view first: `elementFromPoint` works in
        // *viewport* coordinates and returns null for anything below the fold,
        // and on the 360px profile the action row sits well under the banner's
        // top edge. Scrolling per box keeps the hit test honest instead of
        // silently measuring "nothing is there" and calling that a pass.
        topAtCentre: [sel.title, sel.text, sel.action].map((s) => {
          const el = q(s);
          el.scrollIntoView({ block: "center", behavior: "instant" });
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          // Three separate `closest` calls rather than one `"button,a,p,h1,h2,h3"`
          // list: `button-nesting.test.ts` treats a comma list starting with
          // `button` as a selector waiting for a button inside an anchor, and
          // the CTA has no `button` at all — `Button` renders a router `Link`.
          const actionable =
            hit?.closest("a") ?? hit?.closest("p") ?? hit?.closest("h2");
          return actionable?.tagName ?? hit?.tagName ?? "none";
        }),
      };
    }, SELECTORS);

    // The ring is *meant* to be larger than the banner — only the crown of the
    // arc shows, because the banner clips it. So "does it overflow the box" is
    // the wrong question, and an earlier version of this spec asked exactly that
    // and passed for the wrong reason: the layers had lost `position: absolute`
    // and were rendering as 2px inline boxes sitting comfortably inside. The
    // questions that catch that are the ones below.
    expect(
      geo.bannerOverflow,
      "the banner no longer clips, so the ring's overhang paints over the page",
    ).toBe("hidden");

    // Both layers must actually occupy the panel. The 2px version of this bug
    // was a 0-wide box that passed every "is it inside the banner" question.
    for (const [name, deco] of [["ring", geo.ring], ["aura", geo.aura]] as const) {
      expect(
        deco.w,
        `the ${name} collapsed to ${Math.round(deco.w)}px wide — it is not being laid out`,
      ).toBeGreaterThan(geo.banner.w * 0.9);
    }

    // Centring is asserted for the ring only. Rotating a box about its own
    // transform-origin keeps its centre put, so the ring's centre is a real
    // invariant. The aura is `composes: ambientDrift`, which translates as well
    // as scales, so its measured box is wherever the drift happens to be in its
    // 22s cycle — a phase-dependent offset, not a layout error.
    expect(
      Math.abs(geo.ring.x + geo.ring.w / 2 - (geo.banner.x + geo.banner.w / 2)),
      "the ring is not centred on the banner",
    ).toBeLessThan(2);

    // ...and they must be out of flow, which is what the collapsed box was
    // getting wrong. Asserted as the computed `position` rather than as a
    // banner height, because a height threshold is a guess about this copy at
    // this viewport: it read 318px when correct and 344px when broken, which is
    // not a margin wide enough to trust. "Absolute" is the whole claim.
    expect(
      [geo.ringPosition, geo.auraPosition],
      "a decorative layer is back in flow, so it adds a phantom line to the banner",
    ).toEqual(["absolute", "absolute"]);

    // The copy must still be *clickable* with the decoration present. This is
    // narrower than it looks, and worth being precise about: the layers are
    // `pointer-events: none`, so `elementFromPoint` skips them entirely no
    // matter how they are painted. Moving the ring to the end of the banner and
    // flattening the stacking leaves this assertion green — correctly so,
    // because it did not break anything a reader can do. So this catches an
    // interception bug and says nothing about paint order; the `z-index`
    // contracts in `ambient-motion.test.ts` are what cover that, and verifying it
    // here would need pixel comparison, which this suite deliberately does not do.
    //
    // `A` and not `BUTTON` for the third: `Button` renders a router `Link`, so a
    // clickable call to action is an anchor.
    expect(
      geo.topAtCentre,
      "the CTA copy stopped taking clicks with the decoration present",
    ).toEqual(["H2", "P", "A"]);
  });

  test("the banner does not overflow on a narrow phone", async ({ page }) => {
    await openHome(page);

    const bad = await page.evaluate((sel) => {
      const banner = document.querySelector(sel.banner)!;
      const br = banner.getBoundingClientRect();
      return {
        pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        spills: [...banner.querySelectorAll("h2,p,button")]
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.right > br.right + 1 || r.left < br.left - 1).length,
      };
    }, SELECTORS);

    expect(bad.pageScroll, "the page gained a horizontal scrollbar at 360px").toBeLessThanOrEqual(1);
    expect(bad.spills, "CTA content spills past the banner's edges").toBe(0);
  });
});