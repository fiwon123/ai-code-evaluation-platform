/**
 * The hero title is painted with `color: transparent` + `background-clip: text`,
 * so it is only visible where the gradient overlaps the text box. That makes the
 * sweep geometry a *correctness* concern, not a decoration one: if the animated
 * `background-position` range pushes the gradient off-canvas, the heading
 * silently renders as nothing.
 *
 * For a background of `size` (as a fraction of the box) at `position` percent,
 * CSS renders it at `offset = (1 - size) * position`, so the text box is fully
 * painted exactly when
 *
 *     offset <= 0  and  offset + size >= 1
 *  =>  0 <= position <= 1 / (size - 1)
 *
 * This test parses the shipped stylesheet and asserts that invariant over the
 * whole animation range, so a "prettier" sweep value cannot reintroduce the bug.
 */
import { describe, expect, it } from "vitest";

import css from "./PageTitle.module.css?raw";

/** A `background-size: 200% 100%` width, in box fractions. */
function parseWidthPercent(declarations: string): number | null {
  const match = declarations.match(/background-size:\s*([\d.]+)%/);
  return match ? Number(match[1]) / 100 : null;
}

/** Every `background-position: <x>%` found in a block, as fractions. */
function parsePositionsPercent(block: string): number[] {
  return [...block.matchAll(/background-position:\s*(-?[\d.]+)%/g)].map((m) =>
    Number(m[1]) / 100,
  );
}

/** The body of a top-level rule (`.hero { ... }`), brace-balanced. */
function ruleBody(stylesheet: string, selector: string): string {
  const start = stylesheet.indexOf(selector);
  expect(start, `selector ${selector} not found`).toBeGreaterThan(-1);
  const open = stylesheet.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < stylesheet.length; i += 1) {
    if (stylesheet[i] === "{") depth += 1;
    if (stylesheet[i] === "}") depth -= 1;
    if (depth === 0) return stylesheet.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

function keyframesBody(name: string): string {
  const start = css.indexOf(`@keyframes ${name}`);
  expect(start, `@keyframes ${name} not found`).toBeGreaterThan(-1);
  return ruleBody(css.slice(start), "{");
}

/** Does the gradient still paint every pixel of the text box? */
function coversBox(size: number, position: number): boolean {
  const offset = (1 - size) * position;
  return offset <= 1e-9 && offset + size >= 1 - 1e-9;
}

const hero = ruleBody(css, ".hero {");
const heroSize = parseWidthPercent(hero);
const sweep = keyframesBody("titleShift");
const sweepPositions = parsePositionsPercent(sweep);

describe("hero title sweep coverage", () => {
  it("animates a position range (guards the parsers)", () => {
    expect(heroSize).not.toBeNull();
    expect(sweepPositions.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the gradient covering the text box for the whole animation", () => {
    const size = heroSize as number;
    expect(size, "hero background must be wider than 100% to sweep").toBeGreaterThan(1);

    // The animation interpolates between its keyframes, so every intermediate
    // position must satisfy the coverage bound too; the bound is monotonic in
    // `position`, so checking the extremes is sufficient.
    for (const position of [Math.min(...sweepPositions), Math.max(...sweepPositions)]) {
      const maxSafe = 1 / (size - 1);
      expect(
        coversBox(size, position),
        `background-size ${size * 100}% with background-position up to ` +
          `${position * 100}% puts the gradient at [${((1 - size) * position).toFixed(2)}, ` +
          `${((1 - size) * position + size).toFixed(2)}] — the heading text is ` +
          `transparent there and would render as nothing (max safe: ${(maxSafe * 100).toFixed(0)}%)`,
      ).toBe(true);
    }
  });

  it("pins a static, fully painted gradient when motion is reduced", () => {
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/.exec(css);
    expect(reduced, "prefers-reduced-motion block not found").not.toBeNull();

    const block = (reduced as RegExpExecArray)[1];
    const heroInBlock = ruleBody(block, ".hero");
    expect(heroInBlock).toMatch(/animation:\s*none/);

    // Freezing a 200% sweep would show only part of the gradient, so the
    // window has to collapse back to the text box.
    expect(parseWidthPercent(heroInBlock), "reduced-motion hero must be 100% wide").toBe(1);
  });

  it("does not clip text without a gradient behind it", () => {
    // `color: transparent` is only safe while something is painted.
    expect(hero).toMatch(/background:\s*linear-gradient\(/);
  });
});
