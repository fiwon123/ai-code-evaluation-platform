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
import { render } from "@testing-library/react";
import { createElement } from "react";

import PageTitle from "./PageTitle";
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
    expect(hero).toMatch(/background-image:\s*linear-gradient\(/);
  });
});

/**
 * The clip itself, checked through the cascade rather than through any single
 * rule. `#201`: `.hero` overrode the background with the `background` SHORTHAND,
 * which resets every background longhand it omits — `background-clip` among them
 * — to `border-box`. Because `.hero` follows `.title` at equal specificity the
 * reset won, the gradient painted across the whole text box as a rectangle, and
 * `color: transparent` left the letters invisible. The sweep tests above never
 * noticed: they read `.hero` on its own and the geometry was fine.
 *
 * So simulate the cascade for the classes the component actually renders, and
 * require the winning `background-clip` to still be `text`. A shorthand anywhere
 * downstream now fails here instead of in a browser.
 */
type Paint = { clip: string; image: boolean; color: string };

/** The local class names on the rendered element, e.g. `_hero_1r24y_33` -> hero. */
function renderedClassNames(variant: "page" | "hero"): string[] {
  // `children` goes in the props object: this file is `.ts`, so there is no JSX
  // to pass it as a third argument without tripping the props type.
  const { container, unmount } = render(
    createElement(PageTitle, { variant, size: "lg", children: "Tagline" }),
  );
  const className = container.querySelector("h1")?.className ?? "";
  unmount();
  return className
    .split(/\s+/)
    // Vite appends `_<line>` in the browser (`_title_1r24y_4`) but not under
    // Vitest (`_title_ad5948`), so accept both.
    .map((token) => /^_([A-Za-z][A-Za-z0-9]*)_[a-z0-9]+(?:_\d+)?$/.exec(token)?.[1])
    .filter((name): name is string => Boolean(name));
}

/**
 * One declaration block applied to the cascade.
 *
 * Declarations are replayed **in source order**, because that is what decides a
 * shorthand/longhand conflict inside a single block: `background-clip: text;
 * background: linear-gradient(...)` ends up clipped nowhere, while the same two
 * declarations in the other order end up clipped. Resolving the shorthand first
 * regardless of order — the obvious shortcut — would make the guard agree with
 * whichever order it happened to be written in.
 */
function apply(body: string, paint: Paint): Paint {
  const next = { ...paint };
  for (const declaration of body.split(";")) {
    const property = declaration.trim().split(":")[0]?.trim().toLowerCase();
    const value = declaration.slice(declaration.indexOf(":") + 1).trim();
    if (!property || !value) continue;
    switch (property) {
      // The shorthand resets every background longhand it omits.
      case "background":
        next.clip = "border-box";
        if (/gradient/.test(value)) next.image = true;
        break;
      case "background-clip":
      case "-webkit-background-clip":
        next.clip = value;
        break;
      case "background-image":
        if (/gradient/.test(value)) next.image = true;
        break;
      case "color":
        next.color = value;
        break;
      default:
        break;
    }
  }
  return next;
}

/** All top-level rule bodies, plus the ones nested in @media blocks. */
function ruleBodies(stylesheet: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stylesheet)) !== null) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < stylesheet.length; i += 1) {
      if (stylesheet[i] === "{") depth += 1;
      else if (stylesheet[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    // Strip comments: this file documents the very declarations being parsed
    // (including a `background: none` recipe), and a naive scan would read the
    // prose as CSS.
    rules.push({
      selector: match[1]!.trim(),
      body: stylesheet
        .slice(open + 1, end)
        .replace(/\/\*[\s\S]*?\*\//g, ""),
    });
    pattern.lastIndex = end;
  }
  return rules;
}

/** Replay every rule that targets the element, in source order. */
function cascade(names: string[], includeMedia: boolean): Paint {
  let paint: Paint = { clip: "border-box", image: false, color: "" };
  let depth = 0;
  for (const { selector, body } of ruleBodies(css)) {
    const isAtRule = selector.startsWith("@");
    if (isAtRule) depth += isAtRule && selector.startsWith("@media") ? depth + 1 : depth;
    if (!isAtRule && (includeMedia || depth === 0)) {
      if (names.some((name) => selector.includes(`.${name}`))) {
        paint = apply(body, paint);
      }
    }
  }
  return paint;
}

describe("hero title gradient clip", () => {
  it.each([
    ["page", false],
    ["page", true],
    ["hero", false],
    ["hero", true],
  ] as const)(
    "%s variant keeps background-clip: text (reduced-motion rules: %s)",
    (variant, includeMedia) => {
      const names = renderedClassNames(variant);
      expect(names.length, "PageTitle must render hashed CSS-module classes").toBeGreaterThan(1);

      const paint = cascade(names, includeMedia);
      expect(
        paint.clip,
        `winning background-clip is ${paint.clip}; the gradient would paint across the ` +
          `whole text box as a rectangle while the text is transparent. Classes: ` +
          `${names.join(", ")}`,
      ).toBe("text");
      expect(paint.image, "the clipped text needs a gradient behind it").toBe(true);
      expect(paint.color, "clipped text needs a transparent fill").toBe("transparent");
    },
  );

  it("re-applies the clip after any `background` shorthand in the same block", () => {
    // The shorthand is the only thing that can silently reset `background-clip`,
    // and it is easy to reach for by habit. Within one block, a clip declared
    // *before* a shorthand loses; after it, it wins.
    for (const { selector, body } of ruleBodies(css)) {
      const declarations = body
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d.includes(":"))
        .map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim()]);

      let clipped = false;
      for (const [property, value] of declarations) {
        if (property === "background") {
          expect(
            clipped,
            `${selector} declares background-clip: text and then the \`background\` ` +
              "shorthand, which resets it to border-box. Use the `background-image` longhand.",
          ).toBe(false);
        }
        if (property === "background-clip") clipped = value === "text";
      }
    }
  });
});
