/**
 * Guards the ambient motion layer added to `globals.css`.
 *
 * The layer is decorative, which is exactly why it is easy to break without
 * noticing. Nothing fails when an animation keeps running under
 * `prefers-reduced-motion`, and nothing fails when a decoration starts
 * intercepting clicks — the page still looks right in a screenshot. These
 * assertions read the CSS as text, in the same style as `design-tokens.test.ts`,
 * so the opt-outs are checked where they are declared.
 *
 * What is checked:
 *   1. every ambient animation is disabled under `prefers-reduced-motion`,
 *   2. the scroll-driven reveal is additionally gated on motion being welcome,
 *   3. ambient decoration cannot intercept pointer events,
 *   4. no colour token was invented for the layer — tints come from
 *      `color-mix()` over tokens that already existed.
 */
import { describe, expect, it } from "vitest";

import globalsCss from "./globals.css?raw";

const HOME_CSS = import.meta.glob("../pages/Home/Home.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Strip comments so prose is never read as a declaration. Without this the
 *  check below matches the issue number in the layer's own header comment
 *  (`#221` is a perfectly good three-digit hex colour), which is a false
 *  positive on the very block the assertion is meant to police. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The ambient layer's contiguous region: from its own `/* ---- ` marker up to
 *  the next one. Major sections in `globals.css` are delimited by that marker
 *  style, so the layer is whatever sits between two of them. Slicing to
 *  end-of-file instead would sweep in every colour token definition and make
 *  the assertions below meaningless; slicing to the next comment of any kind
 *  would truncate the layer to its own header, since the section is commented
 *  throughout. */
function ambientLayer(css: string): string {
  const start = css.search(/^\/\* ---- Ambient motion layer/m);
  if (start === -1) return "";
  const rest = css.slice(start);
  const end = rest.slice(1).search(/^\/\* ---- /m);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

/** Everything between an `@media (prefers-reduced-motion: reduce)` and the
 *  next top-level at-rule. Good enough for a file this shape, and it fails
 *  loudly if the block is ever restructured into something unparseable. */
function reducedMotionBlock(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) return "";
  const rest = css.slice(start);
  // The block ends at the next top-level at-rule that is not nested inside it.
  const end = rest.slice(1).search(/^\}/m);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

/** Everything gated behind `@media (prefers-reduced-motion: no-preference)`. */
function motionWelcomeBlock(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-motion: no-preference)");
  if (start === -1) return "";
  const rest = css.slice(start);
  const end = rest.slice(1).search(/^\}/m);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

/** Infinite or scroll-driven ambient animations, and the colour blobs and
 *  scanline declared in the Home module. */
const AMBIENT_SELECTORS = [".codeGrid", ".codeFragment"] as const;

/** Opted out of ambient motion by being confined to a block that only applies
 *  when the reader has not asked for reduced motion. This is a stronger
 *  guarantee than an `animation: none` override, so both are accepted. */
const CONFINED_SELECTORS = [".scrollReveal"] as const;

const AMBIENT_KEYFRAMES = [
  "auroraDrift",
  "gridPan",
  "floatCode",
  "sheenSweep",
  "scanline",
  "viewReveal",
] as const;

describe("ambient motion layer", () => {
  it("resolves the layer region to the layer's own rules", () => {
    // Guard on the guard. An earlier version of `ambientLayer` truncated at
    // the first column-zero comment and returned only the layer's header, so
    // every "no colour token" and "no hex literal" assertion below passed
    // against an empty string. If the region ever stops resolving to the real
    // rules, fail here rather than silently asserting nothing.
    const layer = ambientLayer(globalsCss);
    for (const marker of [
      ":root {",
      "@keyframes auroraDrift",
      ".ambientLayer {",
      ".codeGrid {",
      ".codeFragment {",
      ".scrollReveal",
    ]) {
      expect(layer, `ambient layer region is missing \`${marker}\``).toContain(
        marker,
      );
    }
  });

  it("defines every keyframe it references", () => {
    for (const name of AMBIENT_KEYFRAMES) {
      expect(globalsCss, `missing @keyframes ${name}`).toContain(
        `@keyframes ${name}`,
      );
    }
  });

  it("disables every ambient animation under reduced motion", () => {
    const block = reducedMotionBlock(globalsCss);
    expect(block, "globals.css has no reduced-motion block").not.toBe("");

    for (const selector of AMBIENT_SELECTORS) {
      // The selector must appear inside the block AND be neutralised there, so
      // that adding a new decoration without an opt-out is a failing test
      // rather than an inaccessible page.
      expect(block, `${selector} has no reduced-motion opt-out`).toContain(
        selector,
      );
      const neutralised = new RegExp(
        `${selector.replace(".", "\\.")}\\s*(,[^{]*)?\\{[^}]*animation:\\s*none`,
      );
      expect(
        neutralised.test(block),
        `${selector} is not set to animation: none under reduced motion`,
      ).toBe(true);
    }
  });

  it("confines every ambient animation to readers who want motion", () => {
    // Belt and braces on the block above: nothing ambient may be declared
    // outside both a reduced-motion opt-out and a no-preference gate.
    const welcome = motionWelcomeBlock(globalsCss);
    for (const selector of CONFINED_SELECTORS) {
      expect(
        welcome,
        `${selector} is not gated on prefers-reduced-motion: no-preference`,
      ).toContain(selector);
    }
  });

  it("gates the scroll-driven reveal on motion being welcome", () => {
    // `animation-timeline: view()` is unsupported in some browsers, so the
    // reveal is inside @supports — and inside `prefers-reduced-motion:
    // no-preference`, or a reduced-motion reader would get the animation with
    // nothing to switch it off.
    const supportsIndex = globalsCss.indexOf("@supports (animation-timeline: view())");
    expect(supportsIndex, "scroll reveal is not inside @supports").toBeGreaterThan(-1);

    const supportsBlock = globalsCss.slice(supportsIndex);
    expect(supportsBlock).toMatch(
      /@supports \(animation-timeline: view\(\)\)[\s\S]*@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.scrollReveal/,
    );
  });

  it("keeps ambient decoration from intercepting pointer events", () => {
    expect(globalsCss).toMatch(/\.ambientLayer\s*\{[^}]*pointer-events:\s*none/);
  });

  it("introduces no new colour token for the layer", () => {
    // The layer tints with color-mix() over existing tokens so
    // design-tokens.test.ts stays green by construction. A new --color-* here
    // would need documenting in docs/DESIGN_SYSTEM.md.
    const layer = stripComments(ambientLayer(globalsCss));
    expect(layer, "ambient layer marker is missing").not.toBe("");

    const definedInLayer =
      layer.match(/--color-[a-z0-9-]+(?=\s*:)/g) ?? [];
    expect(
      definedInLayer,
      `the ambient layer defines new colour tokens: ${definedInLayer.join(", ")}`,
    ).toEqual([]);
    // Sanity: the file as a whole does define colour tokens, so the check
    // above is not passing simply because the regex finds nothing anywhere.
    expect(globalsCss.match(/--color-[a-z0-9-]+(?=\s*:)/g)?.length ?? 0).toBeGreaterThan(0);
  });

  it("tints with color-mix over existing tokens rather than literals", () => {
    const layer = stripComments(ambientLayer(globalsCss));
    expect(layer).toContain("color-mix(");
    // A raw hex or rgb() in the layer would bypass both palettes. The mask
    // gradient is the one allowed literal, and it is a mask, not a paint.
    const withoutMask = layer.replace(
      /mask-image:[^;]+;/g,
      "",
    );
    expect(withoutMask).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe("Home hero decoration", () => {
  const homeCss = Object.values(HOME_CSS)[0] ?? "";

  it("stops the hero blobs and scanline under reduced motion", () => {
    // These are declared in the Home module rather than globals, so they need
    // their own opt-out — the globals block cannot reach them.
    const block = reducedMotionBlock(homeCss);
    expect(block, "Home.module.css has no reduced-motion block").not.toBe("");
    for (const selector of [".blobPrimary", ".blobAccent", ".blobSuccess", ".panelScan"]) {
      expect(block, `${selector} has no reduced-motion opt-out`).toContain(selector);
    }
  });

  it("keeps the hero backdrop from intercepting clicks", () => {
    expect(homeCss).toMatch(/\.heroBackdrop\s*\{[^}]*pointer-events:\s*none/);
  });
});
