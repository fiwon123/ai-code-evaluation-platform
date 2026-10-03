import { describe, expect, it } from "vitest";

import cardCssRaw from "./Card.module.css?raw";
import globalsCss from "../../styles/globals.css?raw";

/**
 * `Card variant="dark"` (#387).
 *
 * The variant re-points the ordinary tokens for its subtree rather than
 * restyling children, which is only correct if the light palette's inverse
 * tokens are actually distinct from the ordinary ones (otherwise the "dark"
 * card renders as a default card) and the dark palette's inverse tokens are
 * exactly equal to them (otherwise the variant changes the dark theme, where it
 * is meant to be a no-op).
 *
 * It also holds the dark card's body copy to AA on the inverse fill: this is a
 * marketing surface, so muted body text is the first thing a retune would sink
 * before any screenshot review noticed.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const CARD = stripComments(cardCssRaw);
const GLOBALS = stripComments(globalsCss);

function palette(selector: string): Record<string, string> {
  const at = GLOBALS.indexOf(`${selector} {`);
  expect(at, `palette block not found: ${selector}`).toBeGreaterThan(-1);
  const body = GLOBALS.slice(at, GLOBALS.indexOf("\n}", at));
  const out: Record<string, string> = {};
  for (const [, token, value] of body.matchAll(/(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[token] = value;
  }
  return out;
}

const LIGHT = palette(':root,\n[data-theme="light"]');
const DARK = palette('[data-theme="dark"]');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The body of the `.dark` rule, comments already stripped. */
const DARK_RULE = CARD.match(/\.dark\s*\{([^}]*)\}/)?.[1] ?? "";

describe("the Card dark variant", () => {
  it("re-points the tokens descendants read, not just its own background", () => {
    // A variant that only set `background` would leave dark ink from the light
    // palette on a dark fill. The remap is what makes descendants work
    // unmodified, so each pair is asserted.
    expect(DARK_RULE, "Card.module.css must define a .dark rule").not.toBe("");
    for (const [ordinary, inverse] of [
      ["--color-surface", "--color-surface-inverse"],
      ["--color-border", "--color-border-inverse"],
      ["--color-text", "--color-text-inverse"],
      ["--color-text-secondary", "--color-text-inverse-secondary"],
    ] as const) {
      expect(
        DARK_RULE,
        `.dark must remap ${ordinary} to var(${inverse})`,
      ).toContain(`${ordinary}: var(${inverse})`);
    }
  });

  it("is a real surface change in the light palette", () => {
    expect(LIGHT["--color-surface-inverse"]).not.toBe(LIGHT["--color-surface"]);
    expect(LIGHT["--color-text-inverse"]).not.toBe(LIGHT["--color-text"]);
    // The fill must be darker than the page, or a "dark card" on a pale page
    // would read as a lighter panel and defeat the point.
    expect(
      luminance(LIGHT["--color-surface-inverse"]),
      "the light-theme inverse surface must be darker than the page background",
    ).toBeLessThan(luminance(LIGHT["--color-bg"]));
  });

  it("is a no-op in the dark palette", () => {
    // The variant asks for "a strong panel", not "invert the theme". In the
    // dark theme the inverse tokens alias the ordinary ones, so a dark card
    // renders exactly like a default card.
    for (const [inverse, ordinary] of [
      ["--color-surface-inverse", "--color-surface"],
      ["--color-border-inverse", "--color-border"],
      ["--color-text-inverse", "--color-text"],
      ["--color-text-inverse-secondary", "--color-text-secondary"],
    ] as const) {
      expect(
        DARK[inverse],
        `${inverse} must equal ${ordinary} in the dark palette so the variant is a no-op`,
      ).toBe(DARK[ordinary]);
    }
  });

  it("keeps body copy readable on the inverse fill in the light palette", () => {
    for (const token of ["--color-text-inverse", "--color-text-inverse-secondary"]) {
      const ratio = contrast(LIGHT[token], LIGHT["--color-surface-inverse"]);
      expect(
        ratio,
        `${token} (${LIGHT[token]}) on --color-surface-inverse is only ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
