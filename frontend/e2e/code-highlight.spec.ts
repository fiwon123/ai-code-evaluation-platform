import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectReadable, paint } from "./helpers/color";
import {
  completedSubmission,
  mockAuthenticatedSubmission,
} from "./helpers/socket";

/**
 * Rendered syntax highlighting on code surfaces (issue #356).
 *
 * The unit suite (`CodeBlock.test.tsx`, `highlight.test.ts`) proves the
 * tokenizer classifies correctly and the palette test proves each token
 * *value* clears 4.5:1 on both `--color-code-bg` values. Neither can see the
 * browser's resolution of that intent, and the interesting failures here are
 * exactly the ones only a browser has:
 *
 *  - the token span is actually painted its token colour, and not left at the
 *    inherited code colour (a missing CSS-module class renders as decoration
 *    that is invisible in a diff);
 *  - the code surface is still dark in the *light* theme, which is the
 *    specific promise the issue makes;
 *  - the log beside a highlighted block keeps its severity colour, since a
 *    block is one or the other and must never be both.
 *
 * Only the API and socket are mocked (`helpers/socket.ts`); no backend needed.
 */

const SUBMISSION_ID = "e2e-submission-highlight";
const THEMES = ["light", "dark"] as const;

/** Must happen before the app boots, so the very first paint is themed. */
async function openThemed(
  page: Page,
  theme: (typeof THEMES)[number],
  path: string,
) {
  await page.addInitScript(
    (t) => window.localStorage.setItem("theme", t),
    theme,
  );
  await page.goto(path);
  // Without this, a broken theme switch would measure light values twice and
  // every "dark" assertion would pass vacuously.
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** The `<code>` element holding generated source, not the log. */
function generatedSource(page: Page): Locator {
  return page
    .locator("pre code")
    .filter({ has: page.locator("[data-token]") })
    .first();
}

/**
 * WCAG relative luminance of a computed `rgb()` string.
 *
 * Used instead of pinning a literal hex so the assertion survives a legitimate
 * retune of either palette, and instead of `contrastRatio("#ffffff", …)` because
 * `paint` reports modern `color(srgb …)` values for translucent surfaces, which
 * the hex-based helper in `helpers/color.ts` cannot parse (it silently yields
 * NaN, and NaN fails every comparison it is put through).
 */
function relativeLuminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? [])
    .slice(0, 3)
    .map((raw) => Number(raw) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

test.describe("Code syntax highlighting", () => {
  for (const theme of THEMES) {
    test(`paints token colours on the dark surface (${theme} theme)`, async ({
      page,
    }) => {
      await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
      await openThemed(page, theme, `/submissions/${SUBMISSION_ID}`);

      const source = generatedSource(page);
      await expect(source).toBeVisible();

      // The surface stays dark in BOTH palettes — that is the issue's explicit
      // promise, and the reason the syntax tokens are theme-independent. The two
      // palettes use *different* dark values (`#0f172a` light, `#0b1220` dark),
      // so the claim is checked as luminance rather than a literal: pinning a
      // hex would fail on a legitimate retune of either palette.
      const surface = await paint(page, source);
      expect(
        relativeLuminance(surface.background),
        `code surface must stay dark in the ${theme} theme`,
      ).toBeLessThan(0.05);

      // Every token span the tokenizer emitted is readable against that
      // surface. `expectReadable` reports the failing pair, ratio and text.
      const tokens = source.locator("[data-token]");
      const count = await tokens.count();
      expect(count, "the sample solution should tokenize into several runs").toBeGreaterThan(2);

      const seen = new Set<string>();
      for (let i = 0; i < count; i += 1) {
        const token = tokens.nth(i);
        const kind = await token.getAttribute("data-token");
        const text = (await token.textContent())?.trim() ?? "";
        if (!text) continue;
        await expectReadable(page, token, `code token ${kind} (${theme})`);
        seen.add(kind!);
      }

      // The sample is `def two_sum(nums, target): return []`, so the runs that
      // matter are a keyword and a call. A highlighter that emitted a single
      // plain span would satisfy every contrast check above while doing nothing.
      expect([...seen]).toEqual(expect.arrayContaining(["keyword", "function"]));
    });
  }

  test("gives each token kind its own colour", async ({ page }) => {
    await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
    await openThemed(page, "dark", `/submissions/${SUBMISSION_ID}`);

    const source = generatedSource(page);
    await expect(source).toBeVisible();

    const byKind = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const el of document.querySelectorAll("pre code [data-token]")) {
        const kind = el.getAttribute("data-token");
        // First span wins, but skip `plain`: it is deliberately unstyled, so its
        // colour is the inherited default and is not a "kind colour".
        if (kind && kind !== "plain" && !out[kind]) out[kind] = getComputedStyle(el).color;
      }
      return out;
    });

    // The sample is `def two_sum(nums, target): return []`, so a keyword and a
    // call are the two kinds present.
    expect(
      Object.keys(byKind).sort(),
      "expected the sample to produce keyword and function tokens",
    ).toEqual(["function", "keyword"]);

    // Each kind must resolve to *its own* token, not merely to some colour that
    // differs from the others. Comparing colours against each other was tried
    // and it is not strong enough: pointing `.keyword` at `--color-code-muted`
    // still leaves it distinct from `--color-code-fn`, so a test that only asked
    // "are these two different?" passed on a mis-mapped rule. Reading the
    // resolved custom property and comparing like for like catches that, and
    // also catches a token renamed on only one of the two sides.
    // Token name per token kind. They line up except for one: the stylesheet
    // class is `.function` (matching the `data-token` value the highlighter
    // emits) while the token is `--color-code-fn`, because `function` is a
    // reserved word in JS object keys used to build the class map.
    const TOKEN_FOR_KIND: Record<string, string> = { function: "fn" };

    const resolved = await page.evaluate((mapping) => {
      const out: Record<string, string> = {};
      for (const [kind, token] of Object.entries(mapping)) {
        // Normalised to rgb() because a custom property reads back as the hex
        // it was declared with, while a computed `color` is `rgb(...)`.
        const probe = document.createElement("span");
        probe.style.color = `var(--color-code-${token})`;
        document.body.append(probe);
        out[kind] = getComputedStyle(probe).color;
        probe.remove();
      }
      return out;
    }, Object.fromEntries(
      Object.keys(byKind).map((kind) => [kind, TOKEN_FOR_KIND[kind] ?? kind]),
    ));

    for (const [kind, color] of Object.entries(byKind)) {
      // A computed colour of `rgb(0, 0, 0)` or an empty string means the rule
      // did not resolve at all.
      expect(color, `${kind} resolved to "${color}"`).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    }

    for (const kind of Object.keys(byKind)) {
      expect(
        byKind[kind],
        `.${kind} must be painted with --color-code-${TOKEN_FOR_KIND[kind] ?? kind} ` +
          `(${resolved[kind]}), but rendered ${byKind[kind]}`,
      ).toBe(resolved[kind]);
    }
    // The two present kinds must not have collapsed onto each other.
    expect(byKind.keyword).not.toBe(byKind.function);
  });

  test("leaves the log's severity colour alone", async ({ page }) => {
    await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
    await openThemed(page, "dark", `/submissions/${SUBMISSION_ID}`);

    // Raw logs sit behind a collapsed `<details>` ("Show raw output"), so the
    // disclosure has to be opened before the log is visible at all. Asserting on
    // the hidden element would pass for the wrong reason — a log that is absent
    // contains no tokens, trivially.
    await page.getByText(/Show raw output/).click();
    const log = page.getByLabel("Execution log");
    await expect(log).toBeVisible();

    // The log must not be tokenized: a red FAILED line that is also syntax-
    // colored is doing two jobs at once, and traceback frames would color
    // differently from the prose around them.
    expect(
      await log.locator("[data-token]").count(),
      "the log must keep severity colorization, not syntax coloring",
    ).toBe(0);

    // And the source above it IS tokenized, so the two rules are not simply both
    // switched off — that is the failure mode a bare count of 0 would hide.
    expect(await generatedSource(page).locator("[data-token]").count()).toBeGreaterThan(0);
  });

  test("keeps highlighted code copyable verbatim", async ({ page }) => {
    await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
    await openThemed(page, "dark", `/submissions/${SUBMISSION_ID}`);

    const source = generatedSource(page);
    await expect(source).toBeVisible();

    // The rendered text must equal the fixture exactly. Spans are the whole
    // point of the feature, so the invariant worth locking in the browser is
    // that they did not alter a single character of source a user copies.
    const expected = "def two_sum(nums, target):\n    return []\n";
    expect((await source.textContent()) ?? "").toBe(expected);
  });

  test("puts a language badge on the block header", async ({ page }) => {
    await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
    await openThemed(page, "light", `/submissions/${SUBMISSION_ID}`);

    const badge = page.getByText("Python", { exact: true });
    await expect(badge).toBeVisible();
    // The header labels the file; the badge carries the language. The old
    // header printed the raw catalog value ("language: python"), which is what
    // `queryByText(/language:/)` below rules out.
    await expect(page.getByText("Generated code")).toBeVisible();
    expect(await page.getByText(/language:/).count()).toBe(0);

    // The badge sits on the dark header bar, so it is measured there too.
    const header = page.locator("pre").first().locator("xpath=..");
    if (await header.count()) {
      await expectReadable(page, badge, "language badge");
    }
  });

  test("does not shrink the code surface when highlighting is on", async ({ page }) => {
    // Guards a plausible regression: wrapping code in per-token spans makes the
    // <code> element a flex/grid child in some CSS resets, which silently
    // collapses the block's width. The surface has to stay block-level.
    await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
    await openThemed(page, "dark", `/submissions/${SUBMISSION_ID}`);

    // Measured on the `<pre>`, not the `<code>` inside it. An inline `<code>`
    // shrink-wraps to its longest line, so its own width says nothing about
    // whether the *surface* collapsed — the pre is the block that owns the
    // painted background.
    const pre = page.locator("pre").filter({ has: page.locator("[data-token]") }).first();
    await expect(pre).toBeVisible();
    const preBox = await pre.boundingBox();
    const preWidth = preBox?.width ?? 0;
    const card = await pre.evaluate((el) => {
      const card = el.closest("[class*='card'], section, article");
      return card ? card.getBoundingClientRect().width : 0;
    });
    // A `<pre>` that collapsed to its content would be a fraction of the card
    // around it; the surface has to keep filling it.
    expect(preWidth, "code surface should fill its card").toBeGreaterThan(card * 0.8);

    const source = generatedSource(page);
    await expect(source).toBeVisible();

    // And the text is still selectable as one run, not fragmented per span.
    const selectable = await source.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.toString();
    });
    expect(selectable).toBe("def two_sum(nums, target):\n    return []\n");
  });
});

test.describe("code surface contrast in the light theme", () => {
  test("the light theme keeps a dark code surface", async ({ page }) => {
    await mockAuthenticatedSubmission(page, completedSubmission(SUBMISSION_ID));
    await openThemed(page, "light", `/submissions/${SUBMISSION_ID}`);

    const source = generatedSource(page);
    await expect(source).toBeVisible();
    const measured = await paint(page, source);

    // Stated as luminance of the surface itself, not as a contrast ratio: this
    // IS the claim "the code surface is dark in both themes". A light surface
    // would sail through every token contrast check while breaking the reason
    // the syntax tokens are theme-independent.
    expect(relativeLuminance(measured.background)).toBeLessThan(0.05);

    // Sanity on the measurement itself. `helpers/color.ts` parses `rgb()` only,
    // and Chromium reports a resolved `color(srgb …)` for some surfaces — which
    // that helper turns into NaN, and a NaN fails every comparison it is put
    // through. Asserting the parsed channel count makes the harness a checked
    // dependency of this spec instead of a silent one.
    const channels = (measured.background.match(/[\d.]+/g) ?? []).slice(0, 3);
    expect(
      channels.length,
      `unparseable background "${measured.background}": relativeLuminance would read NaN`,
    ).toBe(3);
    expect(channels.every((c) => Number.isFinite(Number(c)))).toBe(true);
  });
});
