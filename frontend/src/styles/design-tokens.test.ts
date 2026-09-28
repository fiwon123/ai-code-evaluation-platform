/**
 * Keeps `docs/DESIGN_SYSTEM.md` honest about the color palette.
 *
 * The doc used to carry its own copy of both palettes as hex tables. They
 * drifted — seven tokens had stale values, four of them for a full release —
 * because a duplicated list has no mechanism to say it is wrong. The fix is to
 * stop duplicating: `globals.css` is the source of truth, the doc records which
 * token to reach for, and these tests make the relationship enforceable.
 *
 * What is checked:
 *   1. every color token defined in `globals.css` is documented,
 *   2. every color token the doc documents actually exists (no phantoms),
 *   3. no token table row carries its own hex value (drift is unrepresentable),
 *   4. every `var(--color-*)` used in the app resolves to a defined token,
 *   5. no color token is written with an inline fallback.
 *
 * Files are read through Vite's `?raw` / `import.meta.glob`, not `node:fs`, so
 * the suite stays inside the normal Vite pipeline (and type-checks).
 */
import { describe, expect, it } from "vitest";

import globalsCss from "./globals.css?raw";

const MODULE_CSS = import.meta.glob("../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DOC = import.meta.glob("../../docs/DESIGN_SYSTEM.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const DESIGN_DOC = Object.values(DOC)[0] ?? "";

/** Strip comments so prose about a token is never read as a declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const GLOBALS = stripComments(globalsCss);

/**
 * Extract one palette's `--color-*` declarations, so a test can compare a token
 * *within* a palette (does this hover differ from the surface it hovers?)
 * instead of across palettes.
 */
function palette(css: string, selector: string): Map<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return new Map();
  const body = css.slice(at + selector.length + 2, css.indexOf("\n}", at));
  const out = new Map<string, string>();
  for (const [, token, value] of body.matchAll(
    /(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g,
  )) {
    out.set(token, value.trim());
  }
  return out;
}

/** WCAG relative luminance, for "is this state actually visible" comparisons. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [lr, lg, lb] = [r, g, b].map((raw) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = palette(GLOBALS, ':root,\n[data-theme="light"]');
const DARK = palette(GLOBALS, '[data-theme="dark"]');

/** Every `--color-*` custom property defined anywhere in the stylesheet. */
function definedColorTokens(css: string): Set<string> {
  return new Set(css.match(/--color-[a-z0-9-]+(?=\s*:)/g) ?? []);
}

/** Every `--color-*` custom property the doc names in a table row. */
function documentedColorTokens(doc: string): Set<string> {
  const named = new Set<string>();
  for (const line of doc.split("\n")) {
    const cells = line.split("|");
    if (cells.length < 3) continue;
    // Rows are "| `--color-foo` | description |" — first cell is the token.
    for (const match of cells[1].matchAll(/`(--color-[a-z0-9-]+)`/g)) {
      named.add(match[1]);
    }
  }
  return named;
}

/** src-relative path -> CSS text, for every stylesheet that can use a token. */
function stylesheets(): Record<string, string> {
  const modules = Object.fromEntries(
    Object.entries(MODULE_CSS).map(([path, css]) => [
      path.replace(/^\.\.\//, ""),
      stripComments(css),
    ]),
  );
  return { ...modules, "styles/globals.css": GLOBALS };
}

function allSources(): Record<string, string> {
  const modules = Object.fromEntries(
    Object.entries(MODULE_CSS).map(([path, css]) => [
      path.replace(/^\.\.\//, ""),
      css,
    ]),
  );
  const sources = Object.fromEntries(
    Object.entries(SOURCES).map(([path, text]) => [
      path.replace(/^\.\.\//, ""),
      text,
    ]),
  );
  return { ...modules, ...sources, "styles/globals.css": globalsCss };
}

const TOKENS_IN_CSS = definedColorTokens(GLOBALS);
const TOKENS_IN_DOC = documentedColorTokens(DESIGN_DOC);

/**
 * Color tokens that are defined in both palettes but referenced by nothing, and
 * are kept on purpose. Each one must be marked "Reserved" in the doc (asserted
 * below) so it stays a decision rather than an accident. `--color-header` is
 * deliberately absent: it was unused, undocumented in intent, and removed in
 * the same change that added these tests.
 */
const RESERVED = new Set(["--color-secondary"]);

describe("design tokens and the design-system doc", () => {
  it("reads the doc and the stylesheet (guards against a vacuous pass)", () => {
    expect(DESIGN_DOC.length).toBeGreaterThan(500);
    expect(Object.keys(MODULE_CSS).length).toBeGreaterThan(10);
    expect(TOKENS_IN_CSS.size).toBeGreaterThan(20);
    expect(TOKENS_IN_DOC.size).toBeGreaterThan(20);
  });

  it("documents every color token defined in globals.css", () => {
    const undocumented = [...TOKENS_IN_CSS]
      .filter((token) => !TOKENS_IN_DOC.has(token))
      .sort();
    expect(
      undocumented,
      "these color tokens exist but the doc never mentions them: add a row to the " +
        "color tables in docs/DESIGN_SYSTEM.md, or delete the token if it is dead",
    ).toEqual([]);
  });

  it("documents no color token that does not exist", () => {
    const phantom = [...TOKENS_IN_DOC]
      .filter((token) => !TOKENS_IN_CSS.has(token))
      .sort();
    expect(
      phantom,
      "the doc names color tokens that globals.css does not define: " +
        "either define them in both palettes or fix the doc",
    ).toEqual([]);
  });

  it("keeps hex values out of the doc's token tables", () => {
    // The drift started here: the tables carried a second copy of the palettes.
    // A row that needs a value now means the value belongs in globals.css only.
    const rowsWithHex = DESIGN_DOC.split("\n")
      .filter((line) => {
        const cells = line.split("|");
        if (cells.length < 3) return false;
        const isTokenRow = /`--[a-z0-9-]+`/.test(cells[1]);
        return isTokenRow && /#[0-9a-fA-F]{3,8}\b/.test(line);
      })
      .map((line) => line.trim());
    expect(
      rowsWithHex,
      "token rows must not restate a value; describe usage and point at globals.css",
    ).toEqual([]);
  });

  it("defines no color token that nothing uses", () => {
    // `--color-header` was defined in both palettes and referenced nowhere; the
    // sticky header uses `--color-surface`. Kept as a rule so dead tokens do not
    // accumulate. A token may stay only if the doc marks it reserved, which
    // `RESERVED` below asserts.
    const sources = allSources();
    const used = new Set<string>();
    for (const text of Object.values(sources)) {
      for (const match of text.matchAll(/var\((--color-[a-z0-9-]+)/g)) {
        used.add(match[1]);
      }
    }
    const unused = [...TOKENS_IN_CSS]
      .filter((token) => !used.has(token) && !RESERVED.has(token))
      .sort();
    expect(
      unused,
      "these color tokens are defined but never referenced — delete them, or add " +
        "them to RESERVED and mark them reserved in the doc",
    ).toEqual([]);
  });

  it("documents every reserved token as reserved", () => {
    // A reserved token is a deliberate, documented decision, so the doc has to
    // say so — otherwise "reserved" is just a stale entry with extra steps.
    const undocumented = [...RESERVED].filter((token) => {
      const row = DESIGN_DOC.split("\n").find((line) =>
        line.includes(`\`${token}\``),
      );
      return !row || !/reserved/i.test(row);
    });
    expect(
      undocumented.sort(),
      "these reserved tokens need a 'Reserved' note in the doc",
    ).toEqual([]);
  });
});

describe("color tokens are referenced correctly", () => {
  it("resolves every var(--color-*) to a defined token", () => {
    // A typo or an aspirational token silently renders as nothing, which is how
    // `var(--color-surface-hover, var(--color-surface))` became a no-op hover.
    const undefinedRefs: string[] = [];
    for (const [path, text] of Object.entries(allSources())) {
      for (const match of text.matchAll(/var\((--color-[a-z0-9-]+)/g)) {
        if (!TOKENS_IN_CSS.has(match[1])) {
          undefinedRefs.push(`${path}: ${match[1]}`);
        }
      }
    }
    expect(
      undefinedRefs.sort(),
      "these reference an undefined color token",
    ).toEqual([]);
  });

  it("uses no inline fallback on a color token", () => {
    const fallbacks: string[] = [];
    for (const [path, css] of Object.entries(stylesheets())) {
      for (const match of css.matchAll(/var\((--color-[a-z0-9-]+)\s*,/g)) {
        fallbacks.push(`${path}: var(${match[1]}, …)`);
      }
    }
    expect(
      fallbacks.sort(),
      "a fallback on a color token is always dead code and hides a typo — " +
        "use the bare token",
    ).toEqual([]);
  });
});

describe("a state token is actually a state", () => {
  // #197: `var(--color-surface-hover, var(--color-surface))` fell back to the
  // surface it was supposed to differ from, so the row hover rendered as a
  // no-op. The dead-fallback checks above cannot see that — after the fallback
  // was removed the rule was syntactically perfect and still did nothing. The
  // only way to catch it is to ask whether the token MOVES.
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])(
    "has a %s hover surface that differs from the surface it hovers",
    (name, tokens) => {
      expect(tokens.get("--color-surface-hover")).toBeDefined();
      expect(
        tokens.get("--color-surface-hover"),
        `--color-surface-hover is ${tokens.get(
          "--color-surface-hover",
        )} in the ${name} palette, identical to --color-surface — the hover would be a no-op`,
      ).not.toBe(tokens.get("--color-surface"));
    },
  );

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])(
    "keeps the %s hover surface clear of the raised/secondary surfaces",
    (name, tokens) => {
      const hover = tokens.get("--color-surface-hover");
      for (const neighbour of [
        "--color-surface-raised",
        "--color-surface-secondary",
      ]) {
        const other = tokens.get(neighbour);
        if (!hover || !other) continue;
        expect(
          hover,
          `--color-surface-hover (${hover}) equals ${neighbour} (${other}) in the ${name} palette, so the two states look identical`,
        ).not.toBe(other);
      }
    },
  );
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])(
    "makes the %s hover surface visible enough to read as a state",
    (name, tokens) => {
      // "Defined" and "different" are not the same as "visible": a hover one
      // shade off its surface (#121c30 on #131d33, 1.01:1) is a different value
      // that no human can see, which is the same defect wearing a new hat. WCAG
      // sets no bar for hover (it is not required content), so this floor is
      // ours: 1.05:1 is roughly a 2.5-point L* step — quiet, but perceptible on
      // a full-width row. GitHub's light-theme row hover sits at 1.07:1.
      const hover = tokens.get("--color-surface-hover");
      const surface = tokens.get("--color-surface");
      if (!hover || !surface) return;
      const ratio = contrast(hover, surface);
      expect(
        ratio,
        `--color-surface-hover (${hover}) is only ${ratio.toFixed(
          3,
        )}:1 against --color-surface (${surface}) in the ${name} palette — ` +
          "too close to read as a state change",
      ).toBeGreaterThanOrEqual(1.05);
    },
  );
});
