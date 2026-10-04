import { describe, expect, it } from "vitest";

import globalsCss from "./globals.css?raw";

/**
 * The site chrome — the sticky header and the footer — is one fixed dark panel
 * in BOTH themes (issue #393).
 *
 * It used to paint from `--color-surface-inverse`, `--color-border-inverse`,
 * `--color-text`, `--color-text-muted` and `--color-border`. Every one of those
 * is a per-theme token, so the footer came out `#0f172a` in light mode and
 * `#131d33` in dark: two different navies for the same band. The tokens could
 * not simply be retuned to agree, because the dark palette aliases
 * `--color-*-inverse` to the ordinary tokens so `Card variant="dark"` stays a
 * no-op there (`card-dark.test.ts` locks that). Hence a dedicated family,
 * declared once in the shared `:root` block like the code surfaces.
 *
 * The retune also fixed two contrast failures the flip was hiding, both in
 * LIGHT mode, where theme ink landed on the theme-invariant dark panel:
 * `.colTitle` was `--color-text` (#0f172a) on a #0f172a fill — 1.00:1, the
 * Product/Company/Legal headings were invisible — and the 12px `.copyright` was
 * `--color-text-muted` (#475569) at 2.36:1. `e2e/contrast.spec.ts` measures the
 * footer *tagline*, which was already hardcoded white, so it never saw either.
 *
 * What is checked here, in order of how quietly it could regress:
 *   1. the tokens are theme-invariant — declared once, in neither palette block,
 *   2. both modules paint from them, and from nothing that flips with the theme,
 *   3. the ink clears AA on the fill, and the fill is not the page it sits on,
 *   4. the globs and the block lookups above actually found something, because a
 *      check that reads nothing passes.
 */

const GLOBALS = globalsCss.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every CSS module under `src/`, keyed by its glob path.
 *
 * `eager` is load-bearing: a lazy glob returns loader functions, and
 * `expect(css).toContain(...)` against a function would fail on every module —
 * which is at least loud, but the two checks below that count entries would read
 * an object of loaders as a populated corpus and start asserting about the wrong
 * thing.
 */
const MODULE_CSS = import.meta.glob("../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Component sources, for the one check that asks where a rule is *rendered*. */
const SOURCES = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FOOTER = "../components/Footer/Footer.module.css";
const LAYOUT = "../components/Layout.module.css";

/** The `--color-*` declarations of one block, keyed by token. */
function tokensOf(css: string, selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return new Map();
  const body = css.slice(at + selector.length + 2, css.indexOf("\n}", at));
  return new Map(
    [...body.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

/** The light palette. `:root,` keeps it distinct from the shared `:root` block. */
const LIGHT = tokensOf(GLOBALS, ':root,\n[data-theme="light"]');
const DARK = tokensOf(GLOBALS, '[data-theme="dark"]');
/** The shared, theme-independent block — the one `:root {` does not match above. */
const BASE = tokensOf(GLOBALS, ":root");

/** The four tokens, with what each is measured against. */
const CHROME = {
  "--color-chrome-bg": "the fill",
  "--color-chrome-border": "the edge",
  "--color-chrome-text": "body ink",
  "--color-chrome-text-muted": "meta ink",
} as const;

/** Every `--color-*` reference in a rule body, and the declaration it sits in. */
function refsIn(css: string, selector: string): string[] {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} must exist in the stylesheet under test`).toBeGreaterThan(-1);
  const body = css.slice(at, css.indexOf("}", at));
  return [...body.matchAll(/var\((--color-[a-z0-9-]+)/g)].map((m) => m[1]!);
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 1.4.3 — body text, which is what both ink steps are. */
const MIN_TEXT = 4.5;

/**
 * The 1.05:1 floor this repo applies to a hover step, reused for "the band is
 * visibly not the page". GitHub's light-theme row hover sits at 1.07:1.
 */
const MIN_BAND_STEP = 1.05;

describe("the site chrome is one panel in both themes", () => {
  it("declares every chrome token once, in the shared :root block", () => {
    for (const [token, role] of Object.entries(CHROME)) {
      expect(
        BASE.get(token),
        `${token} (${role}) must be defined in the shared :root block — a token ` +
          "declared in a palette block is exactly the thing that made the footer " +
          "two different colours",
      ).toBeDefined();
    }
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("re-declares no chrome token in the %s palette", (_theme, palette) => {
    // A `--color-chrome-*` line inside a palette block wins over the base block,
    // so adding one there re-opens this bug invisibly: the stylesheet looks right,
    // the shared block still holds a value, and nothing below would notice.
    const shadowed = [...palette.keys()].filter((token) => token.startsWith("--color-chrome-"));
    expect(
      shadowed,
      `the ${_theme} palette shadows ${shadowed.join(", ")} — theme-invariance has ` +
        "to come from the token being absent, not from a value that happens to " +
        "match today",
    ).toEqual([]);
  });

  it("reads the blocks it claims to", () => {
    // Without this the invariance check above would pass on two empty maps.
    expect(BASE.size, "could not read the shared :root block").toBeGreaterThan(10);
    expect(LIGHT.size, "could not read the light palette").toBeGreaterThan(20);
    expect(DARK.size, "could not read the dark palette").toBeGreaterThan(20);
    expect(MODULE_CSS[FOOTER], `${FOOTER} must be reachable through the glob`).toBeTruthy();
    expect(MODULE_CSS[LAYOUT], `${LAYOUT} must be reachable through the glob`).toBeTruthy();
  });
});

describe("the bands paint from the chrome tokens", () => {
  /**
   * Each rule, and the token it has to name. The point is the *whole* rule body
   * rather than the file, for the reason #345 taught this repo: a palette can be
   * perfectly compliant while the component keeps pointing at the token that is
   * not, and every token-level check stays green.
   */
  const RULES: ReadonlyArray<readonly [module: string, selector: string, ...want: string[]]> = [
    [FOOTER, ".footer", "--color-chrome-bg", "--color-chrome-border", "--color-chrome-text"],
    [FOOTER, ".columns", "--color-chrome-border"],
    [FOOTER, ".colTitle", "--color-chrome-text"],
    [FOOTER, ".copyright", "--color-chrome-text-muted"],
    [LAYOUT, ".header", "--color-chrome-bg", "--color-chrome-border", "--color-chrome-text"],
    [LAYOUT, ".caret", "--color-chrome-text-muted"],
    [LAYOUT, ".menuToggle", "--color-chrome-border", "--color-chrome-text"],
  ];

  it.each(RULES)("%s %s names %s", (module, selector, ...want) => {
    const css = MODULE_CSS[module]!.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const token of want) {
      expect(refsIn(css, selector), `${selector} must paint var(${token})`).toContain(token);
    }
  });

  it.each([
    [FOOTER, ".footer"],
    [FOOTER, ".colTitle"],
    [FOOTER, ".copyright"],
    [LAYOUT, ".header"],
    [LAYOUT, ".caret"],
    [LAYOUT, ".menuToggle"],
  ] as const)("%s %s names no token that flips with the theme", (module, selector) => {
    // The exact regression: swapping one of these back to `--color-text`,
    // `--color-border`, `--color-text-muted` or a `-inverse` token restores a
    // different footer per theme, and on the dark panel the ordinary ink is
    // either invisible (light mode) or coincidentally readable (dark mode) — so
    // it looks like a retune, not a bug.
    const flipping = refsIn(MODULE_CSS[module]!, selector).filter(
      (token) =>
        token === "--color-text" ||
        token === "--color-text-secondary" ||
        token === "--color-text-muted" ||
        token === "--color-border" ||
        token.includes("-inverse"),
    );
    expect(
      flipping,
      `${selector} paints ${flipping.join(", ")} — those are per-theme, and the ` +
        "band they sit on is not",
    ).toEqual([]);
  });

  it("paints the mobile menu toggle inside the header, not on the page", () => {
    // `.menuToggle` is what makes this corpus complete: it is a button inside
    // `<header>`, so it sits on the chrome fill, and it was carrying
    // `--color-text` inside a `--color-border` ring — 1.06:1 in light mode, a ☰
    // nobody could open on a phone. If it ever moves out of the header the
    // assertions above stop applying to it and this is what says so.
    const source = SOURCES["../components/Layout.tsx"];
    expect(source, "Layout.tsx must be reachable through the glob").toBeTruthy();
    const header = source!.slice(source!.indexOf("<header"), source!.indexOf("</header>"));
    expect(header, "<header> must be found in Layout.tsx").not.toBe("");
    expect(
      header,
      "the menu toggle is only held to the chrome tokens while it renders inside <header>",
    ).toContain("styles.menuToggle");
  });
});

describe("the chrome palette is readable", () => {
  it("paints both ink steps above AA on the fill", () => {
    const fill = BASE.get("--color-chrome-bg")!;
    for (const token of ["--color-chrome-text", "--color-chrome-text-muted"] as const) {
      const ratio = contrast(BASE.get(token)!, fill);
      expect(
        ratio,
        `${token} (${BASE.get(token)}) on --color-chrome-bg (${fill}) is only ` +
          `${ratio.toFixed(2)}:1 — the muted step carries the 12px copyright`,
      ).toBeGreaterThanOrEqual(MIN_TEXT);
    }
  });

  it("keeps the fill darker than its ink", () => {
    // Redundant against the contrast check above, and deliberately so: a retune
    // that swapped the ink for a dark one would have to fall a very long way to
    // fail 4.5:1, and "the band is dark" is the property the whole design rests
    // on. Stating it directly means a future light-on-light chrome fails here
    // with a clear message rather than as a surprise in review.
    expect(
      luminance(BASE.get("--color-chrome-bg")!),
      "the chrome fill is a dark panel in both themes, so it must be darker than its ink",
    ).toBeLessThan(luminance(BASE.get("--color-chrome-text")!));
  });

  it("is visibly not the page, in either theme", () => {
    // The honest number for the dark theme is 1.13:1 — the fill and the dark page
    // are both deep navy, which is why the border delimits the band there. It is
    // still well clear of "the same colour", and holding it stops a retune from
    // quietly flattening the band into the page in either palette.
    for (const [theme, palette] of [
      ["light", LIGHT],
      ["dark", DARK],
    ] as const) {
      const step = contrast(BASE.get("--color-chrome-bg")!, palette.get("--color-bg")!);
      expect(
        step,
        `--color-chrome-bg on the ${theme} page (${palette.get("--color-bg")}) is ` +
          `only ${step.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(MIN_BAND_STEP);
    }
  });

  it("delimits itself with the border where the fill cannot", () => {
    // The step above says the band is not the page; this says the edge is doing
    // real work. WCAG sets no bar for a decorative region rule, so the floor is
    // the same 1.05:1 perceptual one, measured against the fill it outlines.
    const step = contrast(
      BASE.get("--color-chrome-border")!,
      BASE.get("--color-chrome-bg")!,
    );
    expect(
      step,
      `--color-chrome-border on the fill is only ${step.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_BAND_STEP);
  });
});
