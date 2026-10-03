import { describe, expect, it } from "vitest";

/**
 * The select chevron's stroke is hardcoded per state.
 *
 * A `background-image` data URI cannot resolve `currentColor` or a CSS
 * variable, so the stroke colour has to be a literal — and a literal silently
 * drifts the moment someone retunes the token it was copied from. The first
 * draft of this rule hardcoded `#94a3b8` for the dark theme, which looked
 * perfectly fine in a screenshot and was simply the wrong colour: the dark
 * `--color-text-secondary` is `#a9b8cf`.
 *
 * Screenshots cannot catch that. Two images, both "an arrow, visible, on a dark
 * control", differ in a way no eye or vision model is being asked to judge. So
 * the value is checked against the live token here instead, which is the only
 * check that actually fails when the token moves.
 *
 * Since #387 a form control is dark in *both* themes, so a single arrow
 * suffices: the rest state is `--color-input-placeholder` and the hover state
 * brightens to `--color-input-text`. The test below therefore pins each state's
 * hex to its token and proves both palettes define those tokens with the same
 * value (otherwise the arrow would be wrong in one of them).
 */
const CSS = import.meta.glob("../../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const GLOBALS = import.meta.glob("../../styles/globals.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const selectCssRaw = CSS["./Input.module.css"];
const globals = GLOBALS["../../styles/globals.css"];

/**
 * Comments stripped. These assertions describe what the *stylesheet* does, and
 * this file's own comment explains the theme mechanism in prose — including the
 * literal string `prefers-color-scheme`, which a naive "is this mentioned
 * anywhere" check reports as a violation. Matching against prose is how a guard
 * test starts failing for the wrong reason.
 */
const selectCss = selectCssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

function token(name: string, theme: "light" | "dark"): string {
  // Slice the theme block, then read the declaration out of it.
  const start = globals.indexOf(`[data-theme="${theme}"] {`);
  expect(start, `no [data-theme="${theme}"] block in globals.css`).toBeGreaterThan(-1);
  const block = globals.slice(start, globals.indexOf("}", start));
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(block);
  expect(match, `--${name} is not defined in the ${theme} theme`).not.toBeNull();
  return match![1].toLowerCase();
}

describe("the select chevron", () => {
  it("lives in the shared Input module", () => {
    expect(selectCss, "Input.module.css did not resolve").toBeDefined();
  });

  it("draws its own arrow instead of leaving it to the platform", () => {
    // `appearance: auto` hands the arrow (and its contrast, and its position)
    // back to the browser, which is the thing being fixed.
    expect(selectCss).toMatch(/\.select\s*\{[^}]*appearance:\s*none/);
    expect(selectCss).toMatch(/\.select\s*\{[^}]*background-image:/);
  });

  it("reserves room for the arrow so option text cannot run under it", () => {
    // Left padding is --space-3 (12px); the right must be strictly larger or a
    // long option would be overlapped by the chevron.
    const space3 = /--space-3:\s*([\d.]+rem)/.exec(globals);
    expect(space3, "--space-3 not found in globals.css").not.toBeNull();
    const leftPx = parseFloat(space3![1]) * 16;
    const right = /\.select\s*\{[^}]*padding-right:\s*calc\(var\(--space-3\)\s*\+\s*([\d.]+)rem\)/.exec(
      selectCss,
    );
    expect(right, "padding-right is not reserving an arrow gutter").not.toBeNull();
    const rightPx = leftPx + parseFloat(right![1]) * 16;
    expect(rightPx).toBeGreaterThan(leftPx);
  });

  it("insets the arrow by the same amount as the text", () => {
    // Symmetry is the point: an arrow touching the border reads as outside the
    // control. `--space-3` on both sides is what makes it read as part of it.
    expect(selectCss).toMatch(
      /\.select\s*\{[^}]*background-position:\s*right var\(--space-3\) center/,
    );
  });

  it("draws its rest arrow in the control's placeholder colour", () => {
    const light = token("color-input-placeholder", "light");
    const dark = token("color-input-placeholder", "dark");
    expect(light).toBe("#94a3b8");
    // The control is dark in both themes, so a shared arrow is only correct if
    // both palettes agree on the colour it was copied from.
    expect(dark).toBe(light);
    expect(selectCss).toContain("stroke='%2394a3b8'");
  });

  it("brightens the arrow to the control's text colour on hover", () => {
    // The hover arrow is the state change; if it equals the resting stroke the
    // hover is a no-op that no screenshot would flag.
    const light = token("color-input-text", "light");
    const dark = token("color-input-text", "dark");
    expect(light).toBe("#e2e8f0");
    expect(dark).toBe(light);
    const hover = /\.select:hover\s*\{([^}]*)\}/.exec(selectCss)?.[1] ?? "";
    expect(hover, ".select:hover must draw its own arrow").toContain(
      "stroke='%23e2e8f0'",
    );
    expect(hover).not.toContain("%2394a3b8");
  });

  it("uses one arrow for both themes, never prefers-color-scheme", () => {
    // The control is dark in both palettes (#387), so an OS-media-query or a
    // [data-theme] override would be a second opinion about a control that no
    // longer changes colour with the theme.
    expect(selectCss).not.toContain("prefers-color-scheme");
    expect(selectCss).not.toContain('[data-theme="dark"]');
  });
});
