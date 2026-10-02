import { describe, expect, it } from "vitest";
import type { SubmissionStatus } from "../types.ts";
import { statusVariant } from "../utils/formatting.ts";
import languageSource from "../utils/language.ts?raw";
import globalsCss from "./globals.css?raw";
import scoreRingCss from "./score-ring.css?raw";
import homeSource from "../pages/Home/Home.tsx?raw";

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
/**
 * Strip CSS comments so prose explaining a rule is never read as a declaration.
 * The Home stylesheet documents its accent decisions in the file itself, and
 * several of the assertions below are "this value must NOT be mentioned" — a
 * phrase in a comment would otherwise satisfy them.
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

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

/**
 * Every language accent, read from the single source of truth rather than a
 * copied list — a hand-maintained copy would drift, and the drift is exactly
 * what this check exists to catch.
 */
const LANGUAGE_ACCENTS: Record<string, string> = Object.fromEntries(
  [...languageSource.matchAll(/"?([a-zA-Z0-9#-]+)"?:\s*\{[^}]*?color:\s*"(#[0-9A-Fa-f]{6})"/g)].map(
    (m) => [m[1]!, m[2]!],
  ),
);

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
  // `primary` was missing here until #348, and that omission is why the dark
  // theme's "processing" pill shipped at 3.13:1: it is the only status that
  // paints the primary variant, and the only family with no `-strong` step. The
  // list is now every family that `statusVariant` can return, so a status cannot
  // be added without its contrast being held.
  { base: "color-primary", strong: "color-primary-strong", tint: "color-primary-light" },
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

  it("covers every status `statusVariant` can return", () => {
    // This is the lock that would have prevented the bug #348 fixed. The dark
    // "processing" pill shipped at 3.13:1 for as long as `STATUS_PILLS` listed
    // three families instead of four — and it shipped *green*, because the list
    // and the thing it was supposed to describe were two separate hand-kept
    // inventories with no assertion connecting them. Adding a `SubmissionStatus`
    // or a variant to `statusVariant` without a pill entry here is now a
    // failure rather than a silent hole in the coverage.
    const STATUSES: SubmissionStatus[] = [
      "pending",
      "processing",
      "completed",
      "failed",
    ];
    const covered = new Set(STATUS_PILLS.map((pill) => pill.base));
    for (const status of STATUSES) {
      const variant = statusVariant(status);
      expect(
        covered.has(`color-${variant}` as (typeof STATUS_PILLS)[number]["base"]),
        `status "${status}" paints the .${variant} badge, so --color-${variant}-strong/-light must be in STATUS_PILLS and held to AA in both themes`,
      ).toBe(true);
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
    for (const variant of ["primary", "success", "warning", "danger"]) {
      const body = badge.match(new RegExp(`\\.${variant} \\{([^}]*)\\}`))?.[1];
      expect(body, `Badge.module.css must define a .${variant} rule`).toBeTruthy();
      expect(
        body,
        `.${variant} must paint --color-${variant}-strong; the base --color-${variant} is not AA text on its own tint`,
      ).toContain(`var(--color-${variant}-strong)`);
    }
  });

  it("paints the strong step in the Features report rows", () => {
    // #351 found the same defect in a second place, and the `-strong` tokens
    // already existed when it shipped: the Features page drew a pass row and a
    // fail row as 12px body text on their own tints, in *both* themes, at
    // 3.00:1 / 4.00:1 and 3.95:1 / 3.62:1. Every assertion in this file passed
    // while it was broken, because the file only ever asked whether the *tokens*
    // were compliant — which they were. The component was the part nobody read.
    //
    // So this asks the component question directly, and matches the whole rule
    // body so the comment above the rule cannot satisfy it.
    const features = MODULE_CSS["../pages/Features/Features.module.css"];
    expect(features, "Features.module.css must be reachable through the glob").toBeTruthy();
    for (const [cls, family] of [
      ["reportItemOk", "success"],
      ["reportItemBad", "danger"],
    ] as const) {
      const body = features.match(new RegExp(`\\.${cls} \\{([^}]*)\\}`))?.[1];
      expect(body, `Features.module.css must define a .${cls} rule`).toBeTruthy();
      expect(
        body,
        `.${cls} must paint --color-${family}-strong; the base --color-${family} on its own tint is under AA in both themes`,
      ).toContain(`var(--color-${family}-strong)`);
    }
  });
});

/**
 * `--color-surface-card` (#351) exists because every other light surface was
 * *lighter* than the page, so a feature card built from one separated from
 * `--color-bg` by 1.05:1 and its inner panel by 1.00:1 — the same colour. The
 * new token darkens instead.
 *
 * Darkening a surface is not free: it spends the contrast the body copy has, so
 * the step has to be bounded from both sides. Invisible from the page is the
 * bug being fixed; unreadable body text would be a worse one, and it is the
 * kind of regression that arrives later as "the cards look a bit heavy" rather
 * than as a failing audit. Both bounds are asserted here so neither can be
 * crossed by adjusting the hex.
 */
describe("card surface", () => {
  const BOUNDED = [
    ["light", LIGHT],
    ["dark", DARK],
  ] as const;

  it.each(BOUNDED)("is defined in the %s palette", (_theme, tokens) => {
    expect(tokens["color-surface-card"], `--color-surface-card is missing in ${_theme}`).toBeDefined();
  });

  it.each(BOUNDED)("is visibly distinct from the %s page", (_theme, tokens) => {
    const step = contrastRatio(tokens["color-surface-card"]!, tokens["color-bg"]!);
    // The same 1.05:1 floor the design system applies to a hover step, and the
    // figure the old `--color-bg-subtle` pairing sat just *under* at 1.05:1.
    expect(
      step,
      `--color-surface-card (${tokens["color-surface-card"]}) on --color-bg (${tokens["color-bg"]}) is only ${step.toFixed(2)}:1 — that is the flatness #351 was filed for`,
    ).toBeGreaterThanOrEqual(1.05);
  });

  it.each(BOUNDED)("leaves %s body copy readable on the card", (_theme, tokens) => {
    const ratio = contrastRatio(tokens["color-text-muted"]!, tokens["color-surface-card"]!);
    expect(
      ratio,
      `--color-text-muted (${tokens["color-text-muted"]}) on --color-surface-card (${tokens["color-surface-card"]}) is only ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
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

describe("language accent tags (issue #346)", () => {
  // Issue #346 painted the example buttons' language tags with the brand accent
  // and wrote the tag's text in `--color-surface`. That was the wrong token: the
  // accent fill is theme-invariant (a fixed colour per language) but
  // `--color-surface` flips white -> near-black with the theme, so the text
  // flipped too and landed at 3.47:1 in dark against Python's #3776AB. A browser
  // measurement, not a guess.
  //
  // `--color-on-accent` is the token for exactly this job, and its own
  // definition already calls out #3776AB as an accent that must not take dark
  // ink. Held here so a retune of any accent, or of the token, fails in the
  // fast suite rather than in a diff nobody reads.
  for (const [theme, tokens] of [
    ["light", LIGHT],
    ["dark", DARK],
  ] as const) {
    it(`writes accent tags in a token that does not flip with the ${theme} theme`, () => {
      const css = MODULE_CSS["../components/ChallengeForm/challenge-form.module.css"]!;
      const tag = css.slice(css.indexOf(".exampleTag"), css.indexOf("}", css.indexOf(".exampleTag")));
      expect(tag).toMatch(/color:\s*var\(--color-on-accent\)/);
      expect(tag).not.toMatch(/color:\s*var\(--color-surface\)/);
      // The fill is the accent, which is what makes this contrast obligation exist.
      expect(tag).toMatch(/background:\s*var\(--example-accent\)/);
    });

    it(`keeps every language accent legible on its own tag in ${theme}`, () => {
      const ink = tokens["color-on-accent"]!;
      const failures = Object.entries(LANGUAGE_ACCENTS)
        .map(([name, accent]) => [name, accent, contrastRatio(ink, accent)] as const)
        .filter(([, , ratio]) => ratio < 4.5)
        .map(([name, accent, ratio]) => `${name} ${accent} at ${ratio.toFixed(2)}:1`);
      expect(failures).toEqual([]);
    });
  }

  it("scans the real accent table, not an empty one", () => {
    // A regex that stopped matching would leave an empty record, and
    // `expect([]).toEqual([])` above would read as a pass.
    expect(Object.keys(LANGUAGE_ACCENTS).length).toBeGreaterThanOrEqual(20);
    expect(LANGUAGE_ACCENTS["python"]).toBe("#3776AB");
  });
});

/**
 * The other half of the status-pill contract: what the *components* paint.
 *
 * Every check above reads `globals.css`. That is the gap both #352 defects fell
 * through, and it is worth being precise about why:
 *
 * The palette has held a `-strong` step for each family since #346, and the pill
 * checks prove `--color-warning-strong` measures 6.37:1 on its tint. All of that
 * was true while the Home score ring painted `--color-warning` — the *base* hue
 * — and shipped at 2.15:1 on the hero surface. A palette can contain a correct
 * colour and still never be used, and no assertion that only measures the
 * palette can see that.
 *
 * So these read the stylesheets that ship the pixels. The rule is deliberately
 * narrow — "these specific rules must name the `-strong` step" — because a
 * general "no base hue anywhere" ban would be wrong: the base hue is the correct
 * colour for a 1px border and a 2px underline, and banning it would push people
 * to use a text-weight colour for non-text. What is forbidden is the base hue
 * for the *large* graphical objects and for text on a tint, where the base
 * cannot reach the bar.
 */

/** The body of the first rule whose selector contains `selector`. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `no rule matching ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at));
}

/** WCAG 1.4.11 — non-text content, including a thick stroke. */
const MIN_NON_TEXT = 3;

/**
 * Two independent ring implementations paint the same three bands.
 *
 * `ScoreRing` (the global sheet) is what Home, the Demo and the admin pages use;
 * ResultReport carries its own copy. Fixing only the shared one would have left
 * the report ring at 2.15:1 and every assertion in this file green — the same
 * shape as the #348 gap, which is why both files are named here.
 */
const RING_SHEETS = [
  { file: "src/styles/score-ring.css", css: scoreRingCss },
  {
    file: "src/components/ResultReport/ResultReport.module.css",
    css: MODULE_CSS["../components/ResultReport/ResultReport.module.css"]!,
  },
] as const;

const RING_VARIANTS = ["Success", "Warning", "Danger"] as const;

describe("score ring arcs are graphical objects, not text", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])("every ring arc clears %s-theme 1.4.11 on a card surface", (_theme, tokens) => {
    // The number in the middle is text and is held by its own rule; this is the
    // 12px stroke around it. A user who cannot make out the arc cannot tell
    // 40% from 70% from 95%, which is the entire content of the ring.
    const surface = tokens["color-surface"]!;
    for (const family of ["success", "warning", "danger"]) {
      const strong = tokens[`color-${family}-strong`]!;
      expect(strong, `--color-${family}-strong must exist`).toBeDefined();
      expect(
        contrastRatio(strong, surface),
        `--color-${family}-strong is only ${contrastRatio(strong, surface).toFixed(2)}:1 on ${surface}`,
      ).toBeGreaterThanOrEqual(MIN_NON_TEXT);
      // The base is read only to include its number in the message below; it is
      // not asserted against the bar, because it is not uniformly on the wrong
      // side of it. `--color-success` measures 3.30:1 on white and would pass.
      // The bar is the strong step, and the arc rules are held to it uniformly so
      // the three bands cannot drift apart.
    }
  });

  it.each(
    RING_SHEETS.flatMap((sheet) =>
      RING_VARIANTS.map((variant) => ({ file: sheet.file, css: sheet.css, variant })),
    ),
  )("$file paints .ring$variant with the -strong step", ({ css, variant }) => {
    const family = variant.toLowerCase();
    const body = ruleBody(css, `.ring${variant} {`);
    // The measured reason, in the message, because "use the strong step" is a
    // rule someone will eventually want to relax. Note the base is not
    // uniformly bad here: `--color-success` already clears 1.4.11 on white at
    // 3.30:1, while `--color-warning` does not. So this is a uniformity rule —
    // one band may use the base, the other two may not — and the failure message
    // says which case you are in.
    expect(
      body,
      `the ${variant} arc is a graphical object; on the light surface the base hue ` +
        `measures ${contrastRatio(LIGHT[`color-${family}`]!, LIGHT["color-surface"]!).toFixed(2)}:1 ` +
        `against a 3:1 bar, and the strong step ${contrastRatio(LIGHT[`color-${family}-strong`]!, LIGHT["color-surface"]!).toFixed(2)}:1`,
    ).toMatch(new RegExp(`stroke:\\s*var\\(--color-${family}-strong\\)`));
    expect(body).not.toMatch(new RegExp(`stroke:\\s*var\\(--color-${family}\\)`));
  });
});

describe("the Home terminal's stage tag is text on a tint", () => {
  /**
   * The tag's colours are keyed off `data-stage` rather than a class per stage,
   * so a new stage that nobody added a rule for would render as unstyled
   * inherited text. `STAGES` is therefore read from the hook's own label
   * function: the list cannot drift from the values the component emits.
   */
  /** The hook's own source, for the union read below. */
  const useTerminalStorySource = import.meta.glob("../hooks/useTerminalStory.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  })["../hooks/useTerminalStory.ts"] as string;

  const STAGE_TINTS: Record<string, { family: string; since: string }> = {
    generating: { family: "primary", since: "before the prompt is typed" },
    prompt: { family: "primary", since: "while the prompt is typed" },
    running: { family: "warning", since: "the first test starts" },
    results: { family: "warning", since: "the last test resolves" },
    score: { family: "primary", since: "the suite has resolved" },
    ready: { family: "success", since: "the score lands" },
  };

  it("gives every stage a tint and a -strong text colour", () => {
    const css = MODULE_CSS["../pages/Home/Home.module.css"]!;
    for (const [stage, { family, since }] of Object.entries(STAGE_TINTS)) {
      const at = css.indexOf(`.animStatus[data-stage="${stage}"]`);
      expect(at, `no .animStatus rule for stage "${stage}" (${since})`).toBeGreaterThan(-1);
      // Read to the end of the group: the selectors for one family are written
      // as a comma list, so a stage's colours are on a shared line with others.
      const group = css.slice(at, css.indexOf("}", at));
      expect(
        group,
        `stage "${stage}" paints text with var(--color-${family}) — the base hue, ` +
          `which is ${contrastRatio(LIGHT[`color-${family}`]!, LIGHT[`color-${family}-light`]!).toFixed(2)}:1 on its own tint`,
      ).toMatch(new RegExp(`color:\\s*var\\(--color-${family}-strong\\)`));
      expect(group).toMatch(new RegExp(`background:\\s*var\\(--color-${family}-light\\)`));
    }
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])("every stage tag clears %s-theme AA on its tint", (_theme, tokens) => {
    for (const [stage, { family }] of Object.entries(STAGE_TINTS)) {
      const ratio = contrastRatio(
        tokens[`color-${family}-strong`]!,
        tokens[`color-${family}-light`]!,
      );
      expect(ratio, `stage "${stage}" is only ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("paints every stage the story can actually enter", () => {
    // The same trap the status-pill list fell into: `STAGE_TINTS` above and the
    // states `useTerminalStory` emits are two separate hand-kept inventories, and
    // nothing forced them to agree. The hook is the source of truth, so its union
    // is read out of the source and checked against the stylesheet.
    //
    // (TypeScript already closes half of this: `STAGE_LABELS` is
    // `Record<StoryStage, string>`, so a new stage cannot be added without a
    // label. It says nothing about the CSS, which is the half that was missing.)
    const homeModule = MODULE_CSS["../pages/Home/Home.module.css"]!;
    const stages = [
      ...(useTerminalStorySource.match(
        /export type StoryStage\s*=([\s\S]*?);/,
      )?.[1] ?? "").matchAll(/"([a-z]+)"/g),
    ].map(([, name]) => name!);

    // The vacuity guard, and it is not optional. The first version of this test
    // named the type `TerminalStage` when the hook calls it `StoryStage`, so the
    // regex matched nothing, the loop iterated zero times, and it passed green
    // while checking nothing at all — the exact failure mode the "scans the real
    // table, not an empty one" test above exists to prevent, reintroduced one
    // screen away from it. If the union is renamed or reformatted, this fails
    // loudly instead of the next assertion going quietly hollow.
    expect(
      stages.length,
      "could not read the StoryStage union out of useTerminalStory.ts — " +
        "this check is only meaningful if it found the stages",
    ).toBeGreaterThanOrEqual(6);

    expect(
      stages.filter((name) => !(name in STAGE_TINTS)),
      "stages the story can enter that no .animStatus rule paints: a stage " +
        "with no colour falls back to inherited text on no tint",
    ).toEqual([]);
    // And the reverse, scanning the *stylesheet* rather than the table above.
    // The first version compared the hook against `Object.keys(STAGE_TINTS)`,
    // which can only ever contain stages the hook already has — it was authored
    // by the same hand as the union, so the "dead CSS" direction had nothing to
    // find. Reading the `data-stage="…"` selectors out of the module asks the
    // question that can actually fail: does the CSS paint a stage that no longer
    // exists, or one renamed without this file being updated.
    const painted = [
      ...homeModule.matchAll(/\.animStatus\[data-stage="([a-z]+)"\]/g),
    ].map(([, name]) => name!);
    expect(
      painted.length,
      "no .animStatus[data-stage] selectors were found — the stage scan " +
        "would check nothing",
    ).toBeGreaterThan(0);
    expect(
      [...new Set(painted)].filter((name) => !stages.includes(name)),
      "stage selectors in Home.module.css that useTerminalStory cannot enter: " +
        "dead CSS that a renamed stage would leave behind",
    ).toEqual([]);
  });
});

/**
 * The Home step stats (#354).
 *
 * These four numbers used to be a separate strip whose caption said they were
 * sample figures, two of them being illustrative. They now sit inside the
 * How-it-works cards, so the values are read as facts about the step above them.
 * That is only safe if each is painted with a colour that carries 4.5:1 against
 * the card's own surface — and the accents are decorative hues chosen for
 * identity, not for contrast, which is exactly the case where a token has to be
 * checked rather than assumed.
 */
describe("the Home step stats are readable in both themes", () => {
  const homeModule = stripCssComments(MODULE_CSS["../pages/Home/Home.module.css"]!);

  it("paints every value with its accent, never with muted or default text", () => {
    const value = homeModule.match(/\.stepStatValue\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(value, "could not read .stepStatValue out of Home.module.css").not.toBe("");
    expect(value).toContain("var(--stat-accent)");
    // The label is the part that is allowed to recede; the number is the content.
    expect(value).not.toMatch(/--color-text-secondary|--color-text-muted|--color-text\b/);
  });

  it("keeps the label legible rather than tinting it with the accent", () => {
    const label = homeModule.match(/\.stepStatLabel\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(label).not.toBe("");
    // Tinting the label with the accent would double the coloured area per stat
    // and push it under 4.5:1 for the lighter hues. It stays on text-secondary.
    expect(label).not.toContain("var(--stat-accent)");
    expect(label).toContain("--color-text-secondary");
  });

  it("gives each of the four accents a rule, so no value renders colourless", () => {
    // A new accent in STEPS with no matching rule would silently inherit
    // --color-primary — two steps the same colour, and the identity the class
    // comment claims would be gone.
    const painted = [
      ...homeModule.matchAll(/\.stepStat\[data-accent="([a-z]+)"\]/g),
    ].map(([, name]) => name!);
    expect(painted.length, "no .stepStat[data-accent] rules were found").toBeGreaterThan(0);

    const used = [
      ...homeSource.matchAll(/accent:\s*"([a-z]+)"/g),
    ].map(([, name]) => name!);
    expect(used.length, "could not read the accents out of Home.tsx").toBeGreaterThan(0);
    expect(
      used.filter((name) => name !== "primary" && !painted.includes(name)),
      "STEPS accents with no .stepStat rule: these fall back to primary",
    ).toEqual([]);
  });

  it("reserves tabular figures so the labels do not shift mid-sweep", () => {
    // Four values counting at once would otherwise reflow their own labels as
    // the digit widths changed — the sweep would read as a layout jump.
    expect(homeModule).toMatch(/\.stepStatValue\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});
