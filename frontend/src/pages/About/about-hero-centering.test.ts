/**
 * The About hero subtitle must be *centered*, not just centered-looking.
 *
 * `.header` only sets `text-align: center`, which centers glyphs inside their
 * line boxes. The subtitle itself is a 600px block inside a much wider
 * container, so without auto side margins the whole box is flush left and the
 * text drifts left of the heading above it. #231.
 *
 * This reads the shipped stylesheet so the one-line fix cannot silently
 * regress: drop the auto margin and this fails, which is exactly the
 * mutation the file guards against.
 */
import { describe, expect, it } from "vitest";

import css from "./About.module.css?raw";

/** The body of a top-level rule (`.subtitle { ... }`), brace-balanced. */
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

const tagline = ruleBody(css, ".subtitle");
const header = ruleBody(css, ".header");

describe("About hero subtitle centering", () => {
  it("centers the hero block with text-align", () => {
    expect(header).toMatch(/text-align:\s*center/);
  });

  it("gives the narrower subtitle auto side margins", () => {
    // `margin: 0 auto` and the longhand pair are both valid; require one.
    const shorthand = /margin:\s*[^;]*\bauto\b/.test(tagline);
    const longhand = /margin-(left|right|inline-start|inline-end):\s*auto\b/.test(tagline);
    expect(
      shorthand || longhand,
      "`.subtitle` is capped at 600px inside a wider centered container, so it needs " +
        "`margin: 0 auto` (or auto side margins) — `text-align: center` alone leaves the " +
        "text block flush to the left (#231).",
    ).toBe(true);
  });

  it("keeps the width cap that makes the margin necessary", () => {
    // If the cap were removed the margins would be a no-op and the assertion
    // above would pass for the wrong reason.
    expect(tagline).toMatch(/max-width:\s*\d/);
  });
});
