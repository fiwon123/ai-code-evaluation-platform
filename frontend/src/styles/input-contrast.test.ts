/**
 * Form-control contrast (issue #345).
 *
 * The report behind #345 was that inputs are "hard to read" in light mode.
 * Measured, the text was never the problem:
 *
 *   value text      #0f172a on #ffffff  = 17.85:1   (needs 4.5)
 *   placeholder     #475569 on #ffffff  =  7.58:1   (needs 4.5)
 *   control border  #c9d4e0 on #ffffff  =  1.50:1   (needs 3.0)   <- the defect
 *
 * So the fix is the boundary, and the token that carries it is
 * `--color-input-border`. What this file protects is that fix, plus the two
 * things #345 said must not regress: the dark palette's appearance, and the
 * placeholder.
 *
 * #387 later made the field dark in *both* themes, so the value and placeholder
 * pairings below now name `--color-input-bg` as the background rather than the
 * light card. The value/placeholder assertions follow the `.input` declaration,
 * so they kept measuring the right pair without being rewritten; the boundary
 * assertions still compare the border against the *host* surface, because a
 * boundary is what separates the box from the card behind it.
 *
 * #397 added the last block, which is the mirror image of all of that: every
 * assertion above reads `.input` in `Input.module.css`, so all of them stay green
 * while a *page* overrides the fill underneath them. That is exactly how the
 * challenges search field broke — it painted `--color-surface-raised` (#ffffff in
 * light mode) and kept `.input`'s light-on-dark ink, 1.23:1 for anything typed in
 * it, with this file reporting a pass. The block asserts the absence of the
 * override instead of a value, because the fix *is* the absence.
 *
 * Two deliberate choices about *what* is asserted:
 *
 *  1. The border and placeholder are read out of the module that paints them,
 *     not out of the token table. Asserting the token's own value would pass
 *     the moment someone defined a compliant `--color-input-border` and left
 *     `.input` on `--color-border` — the token would look perfect in review
 *     while the field stayed at 1.50:1. Following the declaration cannot be
 *     satisfied by an unused token, and it also catches a typo, a hardcoded
 *     hex, or a future retune of whatever token the rule points at.
 *
 *  2. The border floor is checked against every surface a field can be placed
 *     on, not just the white card it happened to be measured on. A rule that
 *     only passes where it was measured is one layout change from failing, and
 *     `--color-bg` is the surface that fails first: #768a9f is 3.56:1 on white
 *     but 3.16:1 on #eef2f7, while the *lighter-looking* #7d90a6 clears white at
 *     3.28:1 and drops to 2.91:1 on the page background. That near-miss is the
 *     reason this test exists in this shape.
 *
 * Read through Vite's `?raw` / `import.meta.glob` rather than `node:fs`: the app
 * tsconfig has no node types, so touching node builtins here would mean adding a
 * `@types/node` dependency to the app project.
 */
import { describe, expect, it } from "vitest";

import globalsCss from "./globals.css?raw";

/** `eager` is load-bearing: a lazy glob yields loader functions, not strings. */
const MODULE_CSS = import.meta.glob("../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const INPUT_CSS =
  Object.entries(MODULE_CSS).find(([path]) =>
    path.endsWith("components/Input/Input.module.css"),
  )?.[1] ?? "";

const BADGE_SELECT_CSS =
  Object.entries(MODULE_CSS).find(([path]) =>
    path.endsWith("components/BadgeSelect/BadgeSelect.module.css"),
  )?.[1] ?? "";

const CHALLENGES_CSS =
  Object.entries(MODULE_CSS).find(([path]) => path.endsWith("pages/Challenges.module.css"))?.[1] ??
  "";

/**
 * `styles/focus.css` owns the focus border, and it is not a `*.module.css`, so
 * the glob above cannot see it. It needs its own pattern — a module-only glob
 * silently returns nothing for it, and the assertion reading it would then
 * resolve a rule body from an empty string. Same trap `focus-ring.test.ts`
 * documents.
 */
const SHARED_CSS = import.meta.glob("./focus.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FOCUS_CSS = SHARED_CSS["./focus.css"] ?? "";

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

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const GLOBALS = stripComments(globalsCss);

/** One palette's `--color-*` declarations. */
function palette(selector: string): Map<string, string> {
  const at = GLOBALS.indexOf(`${selector} {`);
  expect(at, `palette block not found: ${selector}`).toBeGreaterThan(-1);
  const body = GLOBALS.slice(at + selector.length + 2, GLOBALS.indexOf("\n}", at));
  const out = new Map<string, string>();
  for (const [, token, value] of body.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(token, value.trim());
  }
  return out;
}

const LIGHT = palette(':root,\n[data-theme="light"]');
const DARK = palette('[data-theme="dark"]');

/**
 * Every rule body declared for an exact selector, concatenated.
 *
 * Concatenated because a module may legitimately split one class across two
 * rules — `BadgeSelect.module.css` declares `.option` twice, once for the box
 * and once to set `--option-accent` — and a first-match lookup would silently
 * return the rule that happens not to carry the property under test.
 */
function ruleBody(css: string, selector: string): string {
  const bodies: string[] = [];
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1]!.trim() === selector) bodies.push(match[2]!);
  }
  expect(bodies, `no rule found for ${selector}`).not.toEqual([]);
  return bodies.join("\n");
}

/** The value of one declaration inside a rule body. */
function declaration(body: string, property: string): string {
  const match = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`));
  expect(match, `no ${property} declaration in: ${body.trim().slice(0, 120)}`).not.toBeNull();
  return match![1]!.trim();
}

/**
 * Resolve a colour declaration to a hex value.
 *
 * Handles the `border` shorthand as well as a bare colour, because the whole
 * point of reading declarations instead of tokens is to see what is actually
 * painted — and `1px solid var(--color-input-border)` is what is actually
 * painted. The colour is the final component of a shorthand, so that is the
 * token resolved.
 *
 * Only `var(--token)` and a bare hex are accepted. Anything else — a gradient,
 * `color-mix()`, a named colour — fails loudly rather than being skipped,
 * because a silently unresolved value would turn every assertion below into a
 * no-op that passes on `NaN` comparisons.
 */
function resolveColor(value: string, tokens: Map<string, string>, where: string): string {
  const parts = value.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";

  // A second colour earlier in the shorthand (`1px solid red var(--x)`) would
  // mean the one resolved here is not what paints, so refuse rather than guess.
  const earlier = parts.slice(0, -1).join(" ");
  expect(
    earlier,
    `${where}: "${value}" names more than one colour, so which one paints is ambiguous`,
  ).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);

  if (/^#[0-9a-fA-F]{3,8}$/.test(last)) return last;
  const ref = last.match(/^var\((--color-[a-z0-9-]+)\)$/);
  expect(ref, `${where}: cannot resolve "${value}" to a single colour token`).not.toBeNull();
  const resolved = tokens.get(ref![1]!);
  expect(resolved, `${where}: ${ref![1]} is not a hex in this palette`).toMatch(
    /^#[0-9a-fA-F]{3,8}$/,
  );
  return resolved!;
}

/** The colour a field's own background resolves to, per theme. */
function inputBackground(tokens: Map<string, string>, theme: string): string {
  const body = ruleBody(INPUT_CSS, ".input");
  return resolveColor(declaration(body, "background"), tokens, `${theme} .input background`);
}

/** WCAG 1.4.3 — normal text. */
const MIN_TEXT = 4.5;
/** WCAG 1.4.11 — the boundary of an interactive control. */
const MIN_BOUNDARY = 3;

/**
 * Surfaces a form field can be placed on inside a card, and the one it can land
 * on without one. All three are asserted because `.input` is reused on every
 * form in the app and nothing in the component knows which surface it ended up
 * on — `Card` uses `--color-surface`, nested panels use
 * `--color-surface-secondary`, and a field rendered straight onto the page uses
 * `--color-bg`.
 */
const PLACEMENT_SURFACES = [
  ["--color-surface", "a card or panel"],
  ["--color-surface-secondary", "a nested surface"],
  ["--color-bg", "the page background"],
] as const;

describe("form controls are visible in light mode", () => {
  it("reads both modules, so a rename cannot make this vacuous", () => {
    expect(INPUT_CSS, "Input.module.css must be reachable through the glob").not.toBe("");
    expect(BADGE_SELECT_CSS, "BadgeSelect.module.css must be reachable").not.toBe("");
    expect(CHALLENGES_CSS, "Challenges.module.css must be reachable").not.toBe("");
    expect(FOCUS_CSS, "styles/focus.css must be reachable through its own glob").not.toBe("");
    expect(LIGHT.get("--color-input-border")).toBeDefined();
  });

  it.each(PLACEMENT_SURFACES)(
    "clears 3:1 against %s (%s), the surface the defect was least visible on",
    (token, description) => {
      const border = resolveColor(
        declaration(ruleBody(INPUT_CSS, ".input"), "border"),
        LIGHT,
        "light .input border",
      );
      const host = LIGHT.get(token)!;
      const ratio = contrastRatio(border, host);
      expect(
        ratio,
        `the control border ${border} is only ${ratio.toFixed(2)}:1 against ${host} ` +
          `(${token}, ${description}) — WCAG 1.4.11 needs ${MIN_BOUNDARY}:1. ` +
          `A field there is white on white with a nearly invisible edge.`,
      ).toBeGreaterThanOrEqual(MIN_BOUNDARY);
    },
  );

  it("is a different colour from --color-border, so the fix is visible in review", () => {
    // Guards the token being "fixed" by aliasing the container border back. The
    // number above would then fail anyway, but only after someone re-ran this
    // file; this states the intent in one line and fails immediately.
    const inputBorder = LIGHT.get("--color-input-border");
    expect(inputBorder).toBeDefined();
    expect(
      inputBorder,
      "--color-input-border is --color-border in light mode, which is the 1.50:1 " +
        "value #345 replaced",
    ).not.toBe(LIGHT.get("--color-border"));
  });

  it("paints the radio grid's option box with the same control border", () => {
    // A radio option is a form control too, and it was on --color-border for
    // the same reason. Locked against the same token so the two cannot drift
    // apart into "fields are visible, option chips are not".
    const option = declaration(ruleBody(BADGE_SELECT_CSS, ".option"), "border");
    const input = declaration(ruleBody(INPUT_CSS, ".input"), "border");
    expect(option, ".option and .input must agree on the control border").toBe(input);
    expect(option).toContain("var(--color-input-border)");
  });
});

describe("form control text is readable in both themes", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("%s value text clears 4.5:1 on the field's own background", (_theme, tokens) => {
    const body = ruleBody(INPUT_CSS, ".input");
    const value = resolveColor(declaration(body, "color"), tokens, "value text");
    const background = inputBackground(tokens, _theme);
    const ratio = contrastRatio(value, background);
    expect(
      ratio,
      `value text ${value} on ${background} is only ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_TEXT);
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)(
    "%s placeholder clears 4.5:1, so retuning its token cannot dim it",
    (_theme, tokens) => {
      // Since #387 the placeholder has its own token (`--color-input-placeholder`)
      // because the field is now dark in both themes and neither theme's
      // `--color-text-muted` is light enough for the dark fill. Asserting the
      // *declaration* rather than the token is still the point: a retune of
      // that token, or a rule that stops pointing at it, is caught here before
      // it ships as an unreadable hint in every form in the app.
      const body = ruleBody(INPUT_CSS, ".input::placeholder");
      const value = resolveColor(declaration(body, "color"), tokens, "placeholder");
      const background = inputBackground(tokens, _theme);
      const ratio = contrastRatio(value, background);
      expect(
        ratio,
        `placeholder ${value} on ${background} is only ${ratio.toFixed(2)}:1 — a ` +
          "placeholder this faint is a label the user cannot read",
      ).toBeGreaterThanOrEqual(MIN_TEXT);
    },
  );

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("%s errored field keeps a 3:1 boundary", (_theme, tokens) => {
    // `.error` replaces the resting border rather than layering on it, so the
    // error state has to clear the boundary bar on its own or an invalid field
    // becomes less visible than a valid one.
    const value = resolveColor(
      declaration(ruleBody(INPUT_CSS, ".error"), "border-color"),
      tokens,
      "error border",
    );
    const background = inputBackground(tokens, _theme);
    const ratio = contrastRatio(value, background);
    expect(
      ratio,
      `error border ${value} on ${background} is only ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(MIN_BOUNDARY);
  });
});

describe("focus still reads as a change of state", () => {
  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("%s focus border is a different colour from the resting border", (_theme, tokens) => {
    // Darkening the resting border shrinks the step to the focused one, so the
    // change has to be asserted rather than assumed. The 3px ring is locked by
    // `focus-ring.test.ts`; this covers the half that test cannot see — a
    // focus border equal to the resting one would make the border change a
    // no-op, the same class of bug as the #197 hover-surface no-op.
    const resting = resolveColor(
      declaration(ruleBody(INPUT_CSS, ".input"), "border"),
      tokens,
      "resting border",
    );
    const focused = resolveColor(
      declaration(ruleBody(FOCUS_CSS, ".focusRingField:focus"), "border-color"),
      tokens,
      "focus border",
    );
    expect(
      focused,
      `the focus border is ${focused}, the same as the resting border in the ` +
        `${_theme} palette — the only focus signal would be the ring`,
    ).not.toBe(resting);
  });
});

describe("the dark palette renders exactly as it did before #345", () => {
  it("keeps --color-input-border equal to the dark --color-border", () => {
    // #345 scoped itself to light mode ("dark mode remains unchanged"). That is
    // a real decision with a real number attached — the dark border is 1.54:1
    // on its surface, below the 3:1 the light token now clears — so it is
    // pinned here rather than left to drift. Retuning the dark border is a
    // legitimate follow-up; changing it quietly in a light-mode fix is not.
    const darkInput = DARK.get("--color-input-border");
    expect(darkInput, "the dark palette must define --color-input-border").toBeDefined();
    expect(
      darkInput,
      "the dark control border no longer matches the dark --color-border: #345 " +
        "changed the dark palette's appearance. If that was intended, retune it " +
        "deliberately and update the note in globals.css and this assertion",
    ).toBe(DARK.get("--color-border"));
  });

  it("documents the known dark gap rather than hiding it", () => {
    // The asymmetry is recorded in `globals.css` next to the token, where
    // someone editing the dark palette will actually see it. This keeps the
    // note from being deleted as "stale" without a replacement.
    expect(globalsCss).toContain("1.54:1");
    expect(globalsCss).toContain("--color-input-border");
  });
});

describe("a page cannot re-fill a shared field under the tokens (#397)", () => {
  /**
   * Properties that decide what a control looks like, checked as *absences*.
   *
   * `background`, `border-color`/`border` and `box-shadow` are the ways a page
   * module reaches past `.input` and repaints the control. None of them is
   * forbidden in general — a page may legitimately want a different control — but
   * on this one the override is what produced white-on-white text, so the rule is
   * "inherit, do not repaint". Asserting the absence rather than a value is what
   * makes that the claim: a rewrite to any other surface token fails here, while
   * a rewrite to a compliant one would pass a value assertion.
   */
  const REPAINT = ["background", "background-color", "border", "border-color", "box-shadow"];

  it.each(REPAINT)(".searchInput declares no %s, so it paints .input's fill", (property) => {
    const body = ruleBody(CHALLENGES_CSS, ".searchInput");
    expect(
      body,
      `.searchInput sets \`${property}\`, which overrides the shared field's fill ` +
        "and leaves .input's light ink (#e2e8f0) on whatever surface this page " +
        "paints — white-on-white in light mode, 1.23:1 measured (#397)",
    ).not.toMatch(new RegExp(`(?:^|;)\\s*${property}\\s*:`));
  });

  it("keeps the shared focus ring and its own padding, the two things it does declare", () => {
    // The negative assertions above would also pass if someone deleted the rule,
    // so the positive half is checked here: `.searchInput` is still a search
    // field, not an empty class.
    const body = ruleBody(CHALLENGES_CSS, ".searchInput");
    expect(body).toContain("composes: focusRingField");
    expect(body).toMatch(/padding-right:\s*2\.5rem/);
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ] as const)("%s search hint clears 4.5:1 on the field it sits inside", (_theme, tokens) => {
    // `.searchHint` is the `/` key cap positioned *over* the field. It used to
    // carry page tokens — `--color-text-muted` on `--color-bg-subtle` — which is
    // legible against the old white fill and a pale box inside the shared dark
    // one. It now takes the field's own ink, so the pairing asserted here is the
    // placeholder pairing: the same grey the placeholder text uses, on the same
    // fill, in both themes.
    const hint = ruleBody(CHALLENGES_CSS, ".searchHint");
    const value = resolveColor(declaration(hint, "color"), tokens, `${_theme} .searchHint`);
    const background = inputBackground(tokens, _theme);
    const ratio = contrastRatio(value, background);
    expect(
      ratio,
      `the "/" hint is ${value} on the field's ${background}: only ` +
        `${ratio.toFixed(2)}:1 — a key cap this faint is a hint nobody sees`,
    ).toBeGreaterThanOrEqual(MIN_TEXT);
    expect(declaration(hint, "border")).toBe("1px solid var(--color-input-border)");
  });

  it("leaves the hint unfilled, so there is no second box inside the field", () => {
    const body = ruleBody(CHALLENGES_CSS, ".searchHint");
    expect(
      body,
      ".searchHint paints its own background, which is a light box inside the " +
        "shared dark field (--color-bg-subtle, #e6edf8) — the outline plus the " +
        "field's own ink is the whole chip (#397)",
    ).not.toMatch(/(?:^|;)\s*background(?:-color)?\s*:/);
  });
});
