/**
 * Locks the stat-card colour system (issue #236).
 *
 * The dashboards grew a row of headline numbers — profile score, completion
 * rate, admin status counts — and all of them were the same grey. That is the
 * failure mode this file exists to prevent: a new stat card that is added
 * without an accent, or with one that has drifted off the scale, is invisible
 * to every other kind of review because nothing looks *wrong* with a grey card.
 *
 * The system has two kinds of colour and they must not be confused:
 *
 *   identity  — `primary` / `teal` / `violet` / `rose`. For a plain count. A
 *               number has no opinion about being good, so its hue only says
 *               "a different thing".
 *   judgement — `success` / `warning` / `danger`. For a value that *is* a
 *               verdict (a score, a rate), and these must come from
 *               `scoreVariant` so one reader learns the scale once.
 *
 * What is checked:
 *   1. every `accent` the component accepts resolves to a defined token,
 *   2. every accent clears 3:1 against the card surface in BOTH themes —
 *      a 1.875rem bold value is large text, and a stat number is the one place
 *      a designer will be tempted to use the 2:1 pass,
 *   3. `scoreVariant` and the `accent*` classes agree, so a score can never be
 *      rendered in a colour that contradicts the chips next to it,
 *   4. the value text uses the accent (not `--color-text`), so the number
 *      actually carries the identity,
 *   5. the wash and the bar are derived from the same `--stat-accent`, and no
 *      module invents a second hex.
 */
import { describe, expect, it } from "vitest";

import statCardCss from "../components/StatCard/StatCard.module.css?raw";
import { scoreVariant } from "../utils/formatting.ts";
import globalsCss from "./globals.css?raw";

/** Strip comments so prose about a token is never read as a declaration. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const GLOBALS = stripComments(globalsCss);
const STAT_CARD = stripComments(statCardCss);

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

const LIGHT = palette(GLOBALS, ':root,\n[data-theme="light"]');
const DARK = palette(GLOBALS, '[data-theme="dark"]');

/** WCAG relative luminance. */
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

/** Follow a `var(--token)` chain to the hex it finally resolves to. */
function resolve(token: string, tokens: Map<string, string>, seen = new Set<string>()): string {
  if (seen.has(token)) return "";
  seen.add(token);
  const raw = tokens.get(token);
  if (!raw) return "";
  const nested = raw.match(/var\((--[a-z0-9-]+)\)/);
  if (nested) return resolve(nested[1], tokens, seen);
  const hex = raw.match(/#[0-9a-f]{6}/i);
  return hex ? hex[0] : "";
}

/** The accent class names the component exposes, mapped to their custom property. */
function accentClasses(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, cls, value] of STAT_CARD.matchAll(
    /\.accent([A-Za-z]+)\s*\{([^}]*)\}/g,
  )) {
    const prop = value.match(/--stat-accent:\s*var\((--[a-z0-9-]+)\)/);
    if (prop) out.set(cls.toLowerCase(), prop[1]);
  }
  return out;
}

const ACCENTS = accentClasses();

/** `--color-surface`, what a stat card actually sits on. */
function surface(tokens: Map<string, string>): string {
  return resolve("--color-surface", tokens);
}

describe("stat card accents", () => {
  it("exposes an accent class for every accent the component accepts", () => {
    // The `accent` prop and the CSS classes are two declarations of one list.
    // A typo in either shows up as a card with no colour.
    for (const accent of [
      "primary",
      "teal",
      "violet",
      "rose",
      "success",
      "warning",
      "danger",
    ]) {
      expect(ACCENTS.has(accent), `missing .accent${accent} class`).toBe(true);
    }
  });

  it.each([
    ["light", LIGHT],
    ["dark", DARK],
  ])("every accent clears 3:1 against the card surface in %s", (_theme, tokens) => {
    const bg = surface(tokens);
    expect(bg, "could not resolve --color-surface").toMatch(/^#[0-9a-f]{6}$/i);

    for (const [name, token] of ACCENTS) {
      const hex = resolve(token, tokens);
      expect(hex, `${token} (accent ${name}) did not resolve to a hex`).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
      // 3:1, not 2:1: the value is 1.875rem bold, and a stat number has to be
      // readable as the headline of the card, not just noticeable.
      expect(
        contrast(hex, bg),
        `accent ${name} (${hex}) is only ${contrast(hex, bg).toFixed(2)}:1 on ${bg}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses the strong warning token, because the plain one is not readable", () => {
    // --color-warning is tuned for a 1px border and a background wash. It is
    // 2.1:1 on the light surface, so using it for a 1.875rem number would fail
    // the check above. This pins WHY the class points at the strong token.
    expect(ACCENTS.get("warning")).toBe("--color-warning-strong");
  });

  it("keeps identity accents separate from judgement accents", () => {
    // Mixing the two is how a count ends up looking like a failure. Identity is
    // the three accents plus primary; judgement is the status scale.
    const identity = ["primary", "teal", "violet", "rose"];
    const judgement = ["success", "warning", "danger"];
    for (const name of identity) {
      expect(ACCENTS.get(name)).toMatch(/^--(color-primary|color-accent-)/);
    }
    for (const name of judgement) {
      expect(ACCENTS.get(name)).toMatch(/^--color-(success|warning|danger)/);
    }
    // No overlap: a name may not be in both groups.
    for (const name of judgement) expect(identity).not.toContain(name);
  });
});

describe("stat value scale", () => {
  it.each([
    [100, "success"],
    [80, "success"],
    [79, "warning"],
    [60, "warning"],
    [59, "danger"],
    [0, "danger"],
  ])("scoreVariant(%i) is %s, and that name has an accent class", (score, expected) => {
    // A score is a judgement, so the number on the card must be allowed the
    // same verdict as the chip beside it.
    const variant = scoreVariant(score);
    expect(variant).toBe(expected);
    expect(ACCENTS.has(variant), `scoreVariant returned "${variant}" with no accent class`).toBe(
      true,
    );
  });

  it("colours the value with the accent, not the default text colour", () => {
    // If this regresses to --color-text the accent bar is the only identity
    // left, and the number — the part being read — goes back to grey.
    const value = STAT_CARD.match(/\.statValue\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(value).toContain("var(--stat-accent)");
    expect(value).not.toContain("var(--color-text)");
  });
});

describe("stat card derivation", () => {
  it("derives the bar, the wash and the border from the one accent property", () => {
    // Three layers of identity from a single custom property: they cannot drift
    // apart, and adding an accent needs no new CSS.
    expect(STAT_CARD).toMatch(/\.statCard\s*\{[^}]*--stat-accent:\s*var\(/);
    expect(STAT_CARD).toMatch(/\.statCard::before\s*\{[^}]*background:\s*var\(--stat-accent\)/);
    expect(STAT_CARD).toMatch(
      /\.statCard\s*\{[^}]*background:[^;]*color-mix\(in srgb, var\(--stat-accent\)/,
    );
    expect(STAT_CARD).toMatch(
      /\.statCard\s*\{[^}]*border-color:[^;]*color-mix\(in srgb, var\(--stat-accent\)/,
    );
  });

  it("invents no colour of its own", () => {
    // A hardcoded hex here would be a fourth theme nobody maintains.
    expect(STAT_CARD).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(STAT_CARD).not.toMatch(/\b(rgba?|hsla?)\(/);
  });

  it("animates only opacity and transform", () => {
    // `statRise` runs on a compositor-friendly property pair so it does not
    // force layout on a dashboard that can be showing hundreds of rows.
    const frames = STAT_CARD.match(/@keyframes\s+statRise\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(frames).toMatch(/from\s*\{[^}]*opacity/);
    expect(frames).toMatch(/transform/);
    for (const property of ["width", "height", "top", "left", "margin", "padding"]) {
      expect(frames, `statRise animates ${property}`).not.toContain(property);
    }
  });
});
