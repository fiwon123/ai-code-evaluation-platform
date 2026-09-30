import { describe, expect, it } from "vitest";
import globalsCss from "./globals.css?raw";

/**
 * Guards the "gradient page titles work in BOTH themes" contract (issue #187).
 *
 * A browser check would be the obvious way to test a gradient, but this repo's
 * e2e suite needs a full Chromium, and the two things that actually broke
 * before are both checkable here without one:
 *
 *  1. Contrast. `--gradient-title` is built from the per-theme primary tokens
 *     precisely so it stays legible on both backgrounds. If someone retunes
 *     `--color-primary` and the gradient quietly drops below the contrast
 *     threshold, that is invisible in a diff and in the component tests.
 *  2. Duplication. The original defect was 21 pages each hand-rolling their own
 *     title, with four hand-copied gradients and two contradictory light-mode
 *     overrides. Re-introducing a per-page gradient is the regression to catch.
 *
 * Files are read through Vite's `?raw` / `import.meta.glob` rather than
 * `node:fs`: the app tsconfig deliberately has no node types, so touching
 * node builtins here would need a new `@types/node` dependency.
 */

const GLOBALS = globalsCss;

/**
 * Every CSS module under `src/`, keyed by its glob path.
 *
 * `eager` matters: a lazy glob returns loader functions, so an empty result
 * would silently satisfy every assertion below.
 */
const MODULE_CSS = import.meta.glob("../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** WCAG relative luminance. */
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
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** The token block for one theme, delimited by its `color-scheme` declaration. */
function themeTokens(selector: string): Record<string, string> {
  const start = GLOBALS.indexOf(selector);
  expect(start, `theme block not found: ${selector}`).toBeGreaterThan(-1);
  const end = GLOBALS.indexOf("}", start);
  const block = GLOBALS.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

const LIGHT = themeTokens(':root,\n[data-theme="light"]');
const DARK = themeTokens('[data-theme="dark"]');

/** Tokens declared outside both palette blocks (theme-independent). */
const BASE = (() => {
  const tokens: Record<string, string> = {};
  for (const match of GLOBALS.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[match[1]!] ??= match[2]!;
  }
  return tokens;
})();

/** Every hex stop inside the title gradient must clear this against its background. */
const MIN_CONTRAST = 4.5;

describe("title gradient contrast", () => {
  it("is defined from the per-theme tokens, not hardcoded hex", () => {
    const declaration = GLOBALS.match(/--gradient-title:[^;]+;/)?.[0] ?? "";
    expect(declaration).toContain("var(--color-primary)");
    expect(declaration).toContain("var(--color-primary-hover)");
    expect(declaration).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("every gradient stop clears %s-theme contrast on the page background", (_theme, tokens) => {
    for (const stop of ["color-primary", "color-primary-hover"]) {
      const ratio = contrastRatio(tokens[stop]!, tokens["color-bg"]!);
      expect(
        ratio,
        `--${stop} (${tokens[stop]}) on --color-bg (${tokens["color-bg"]}) is only ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });
});

/**
 * The code surface is dark in BOTH palettes, so severity tokens defined outside
 * the palette blocks still have to clear contrast against both `--color-code-bg`
 * values. Without this, the tempting `var(--color-danger)` shorthand would pass
 * every check and still render light-mode failure logs at 3.70:1.
 */
/** Glob keys keep their `../` prefix, so match on the suffix. */
const CODE_BLOCK_CSS =
  Object.entries(MODULE_CSS).find(([path]) =>
    path.endsWith("components/CodeBlock/CodeBlock.module.css"),
  )?.[1] ?? "";

const CODE_SEVERITY_TOKENS = [
  "color-code-muted",
  "color-code-error",
  "color-code-warn",
  "color-code-ok",
];

/**
 * Syntax tokens for the code highlighter (issue #356).
 *
 * These carry more of the page's text than the severity tokens do: severity
 * color is a shortcut for a line a user is scanning *past*, whereas a keyword
 * or string is the content being read. So the bar is 4.5:1 in both themes, the
 * same as the severity set, and the list is spelled out here rather than
 * globbed — a token added to `globals.css` with a low-contrast value should
 * fail this test, not slip past it.
 */
const CODE_SYNTAX_TOKENS = [
  "color-code-comment",
  "color-code-string",
  "color-code-number",
  "color-code-keyword",
  "color-code-type",
  "color-code-fn",
] as const;

describe("code surface severity contrast", () => {
  it("does not fall back to the page status tokens on the code surface", () => {
    const module = CODE_BLOCK_CSS;
    expect(module, "CodeBlock.module.css must be reachable through the glob").not.toBe("");
    const declarations = [...module.matchAll(/color:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    // Deliberately a regex rather than a plain prefix comparison. oxlint's
    // prefer-string-starts-ends-with rule suggests rewriting this, but
    // `design-tokens.test.ts` scans source text — comments included — for
    // `var(--color-` references, so a quoted form of the prefix reads as a
    // reference to a token that does not exist. The backslash is what keeps the
    // pattern below invisible to that scan. The suggested rewrite fails it, and
    // so does spelling the prefix out in prose, hence the description.
    // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with
    const severityColors = declarations.filter((value) => /^var\(--color-code-/.test(value));
    expect(severityColors.length).toBeGreaterThanOrEqual(CODE_SEVERITY_TOKENS.length);
    for (const value of severityColors) {
      expect(value, `${value} must be a code-surface token`).toMatch(/^var\(--color-code-/);
    }
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("every severity token clears %s-theme contrast on the code background", (_theme, tokens) => {
    for (const token of CODE_SEVERITY_TOKENS) {
      const value = BASE[token];
      expect(value, `${token} must be defined once, outside the palette blocks`).toBeDefined();
      const ratio = contrastRatio(value!, tokens["color-code-bg"]!);
      expect(
        ratio,
        `--${token} (${value}) on --color-code-bg (${tokens["color-code-bg"]}) is only ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });
});

describe("code surface syntax contrast", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("every syntax token clears %s-theme contrast on the code background", (_theme, tokens) => {
    for (const token of CODE_SYNTAX_TOKENS) {
      const value = BASE[token];
      expect(value, `${token} must be defined once, outside the palette blocks`).toBeDefined();
      const ratio = contrastRatio(value!, tokens["color-code-bg"]!);
      expect(
        ratio,
        `--${token} (${value}) on --color-code-bg (${tokens["color-code-bg"]}) is only ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("styles every token kind the highlighter can emit", () => {
    // The highlighter and the stylesheet are two files; a new token kind with
    // no rule renders in the default code colour and the feature looks half
    // done. This closes that gap from the CSS side, matching the check
    // `highlight.test.ts` makes from the other direction.
    const styled = new Set(
      [...CODE_BLOCK_CSS.matchAll(/^\.code \.([a-z]+) \{/gm)].map((m) => m[1]!),
    );
    for (const kind of ["comment", "string", "number", "keyword", "type", "function"]) {
      expect(styled, `.code .${kind} must exist in CodeBlock.module.css`).toContain(kind);
    }
  });

  it("does not dim syntax tokens with opacity, which erodes the measured contrast", () => {
    // The obvious way to make comments read as "quieter" is an opacity on the
    // rule. It was tried, and it pushed the effective comment contrast to
    // 4.31:1 against the light-theme surface — below the bar the palette check
    // above enforces, and invisible to that check, which only reads token
    // values. So the quietness is carried by the colour itself and no token is
    // dimmed, and this asserts that stays true.
    const dimmed = [...CODE_BLOCK_CSS.matchAll(/^\.code \.[a-z]+ \{[^}]*opacity:/gm)];
    expect(
      dimmed.map((m) => m[0].split("{")[0]!.trim()),
      "syntax tokens must be dimmed by colour, not by opacity",
    ).toEqual([]);
  });
});

/**
 * The status pill pairs, as `{base, strong, tint}` token names.
 *
 * `--color-success` / `--color-danger` are *identity* colours: right as a
 * border, a dot, an accent, or as text on a plain surface. They are not
 * text-safe on the tinted surface they are normally paired with — light mode
 * measured 3.00:1 and 3.95:1, both under AA (issue #346) — so each gained a
 * `-strong` step that keeps the hue and drops the lightness. Dark inverts the
 * direction, because there the *tint* is the dark one and the text has to get
 * lighter.
 */
const STATUS_PILLS = [
  { base: "color-success", strong: "color-success-strong", tint: "color-success-light" },
  { base: "color-warning", strong: "color-warning-strong", tint: "color-warning-light" },
  { base: "color-danger", strong: "color-danger-strong", tint: "color-danger-light" },
] as const;

describe("status pill contrast", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("the -strong pill text clears %s-theme AA on its own tint", (_theme, tokens) => {
    for (const pill of STATUS_PILLS) {
      const text = tokens[pill.strong];
      const tint = tokens[pill.tint];
      expect(text, `--${pill.strong} must exist in the ${_theme} palette`).toBeDefined();
      expect(tint, `--${pill.tint} must exist in the ${_theme} palette`).toBeDefined();
      const ratio = contrastRatio(text!, tint!);
      expect(
        ratio,
        `--${pill.strong} (${text}) on --${pill.tint} (${tint}) is only ${ratio.toFixed(2)}:1 — the base --${pill.base} is ${contrastRatio(tokens[pill.base]!, tint!).toFixed(2)}:1, which is why the strong step exists`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("the -strong pill text also clears %s-theme AA on a card surface", (_theme, tokens) => {
    // A pill does not always sit on its own tint — a status pill on Profile and
    // SubmissionDetail sits on a card, and the form's error banner is
    // `--color-danger-strong` on `--color-danger-light` over a surface. Passing
    // on the tint is not evidence it passes on the surface behind it, so both
    // are held.
    for (const pill of STATUS_PILLS) {
      const text = tokens[pill.strong];
      const surface = tokens["color-surface"];
      expect(text, `--${pill.strong} must exist in the ${_theme} palette`).toBeDefined();
      const ratio = contrastRatio(text!, surface!);
      expect(
        ratio,
        `--${pill.strong} (${text}) on --color-surface (${surface}) is only ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("renders the strong step, so a compliant token nothing uses cannot pass on its own", () => {
    // The lesson from issue #345: assert the *declaration*, not just the token.
    // A palette can be perfectly compliant while the component still points at
    // the failing base token, and every check above would be green.
    const badge = MODULE_CSS["../components/Badge/Badge.module.css"];
    expect(badge, "Badge.module.css must be reachable through the glob").toBeTruthy();
    // `.success`/`.warning`/`.danger` are the pill classes. Match the whole rule
    // body so a comment mentioning the base token cannot satisfy this.
    for (const variant of ["success", "warning", "danger"]) {
      const body = badge.match(new RegExp(`\\.${variant} \\{([^}]*)\\}`))?.[1];
      expect(body, `Badge.module.css must define a .${variant} rule`).toBeTruthy();
      expect(
        body,
        `.${variant} must paint --color-${variant}-strong; the base --color-${variant} is not AA text on its own tint`,
      ).toContain(`var(--color-${variant}-strong)`);
    }
  });
});

/** Glob keys are relative to this file (`src/styles/`), e.g. `../pages/...`. */
function normalise(path: string): string {
  return path.replace(/^\.\.\//, "");
}

/** The bodies of every `@media (prefers-reduced-motion: ...)` block. */
function reducedMotionBlocks(css: string): string[] {
  const blocks: string[] = [];
  const opener = /@media\s*\(prefers-reduced-motion[^)]*\)\s*\{/g;
  for (const match of css.matchAll(opener)) {
    let depth = 0;
    for (let i = match.index + match[0].length - 1; i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          blocks.push(css.slice(match.index + match[0].length, i));
          break;
        }
      }
    }
  }
  // Comments are stripped first: prose that merely mentions a gradient (e.g.
  // "the gradient now lives in PageTitle") is not a declaration.
  return blocks.map((block) => block.replace(/\/\*[\s\S]*?\*\//g, ""));
}

describe("title gradient is not duplicated per page", () => {
  // `.reportScore` is the decorative score in the Features mock report: same
  // clip-text technique, but a 135deg sweep on a mock UI element, not a page
  // title. Everything else must come from the shared PageTitle module.
  const ALLOWED = new Set([
    "components/PageTitle/PageTitle.module.css",
    "pages/Features/Features.module.css",
  ]);

  /** All CSS modules plus globals.css, keyed by src-relative path. */
  function gradientStylesheets(): Record<string, string> {
    const modules = Object.fromEntries(
      Object.entries(MODULE_CSS).map(([path, css]) => [normalise(path), css]),
    );
    return { ...modules, "styles/globals.css": GLOBALS };
  }

  it("is declared in the shared PageTitle module and nowhere else", () => {
    const offenders = Object.entries(gradientStylesheets())
      .filter(([, css]) => /background-clip:\s*text/.test(css))
      .map(([path]) => path)
      .filter((path) => !ALLOWED.has(path));
    expect(offenders).toEqual([]);
  });

  it("leaves no page title with a light-mode override that drops the gradient", () => {
    // The old Home/Demo overrides neutralized the clip for light mode only,
    // which is what made sibling landing pages disagree. `--gradient-title`
    // handles both themes, so no stylesheet should do that any more.
    const offenders = Object.entries(gradientStylesheets())
      .filter(([, css]) => /\[data-theme="light"\]/.test(css) && /background:\s*none/.test(css))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("leaves reduced-motion title repainting to the shared component", () => {
    // A page module that repaints a title gradient under
    // `prefers-reduced-motion` competes with PageTitle for the same element:
    // whichever rule lands later in the cascade wins, so the heading either
    // loses its sweep or shows a clipped, half-painted gradient. This slipped
    // through the `background-clip: text` check above because such a block
    // re-declares the gradient without restating the clip.
    const offenders = Object.entries(gradientStylesheets())
      .filter(([path]) => !ALLOWED.has(path))
      .filter(([, css]) => reducedMotionBlocks(css).some((block) => /gradient/.test(block)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("scans the module tree, not an empty set (guards against a vacuous pass)", () => {
    // A wrong glob would yield no modules, and every offender list above would
    // be empty — which reads as a pass rather than a failure.
    const scanned = gradientStylesheets();
    expect(Object.keys(scanned).length).toBeGreaterThan(10);
    expect(scanned).toHaveProperty("components/PageTitle/PageTitle.module.css");
  });
});
