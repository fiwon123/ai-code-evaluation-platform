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

/**
 * The invariant this file had been missing: it checked the ambient layer in
 * `globals.css` and the Home module by name, so every *other* module could
 * grow an animation without an opt-out and stay green. Two did, unremarked:
 * `Features` grew a 3s infinite `bob` on its pipeline icons, and every
 * `Skeleton` in the app swept a highlight across itself forever.
 *
 * So the rule is now stated once, generally: an animation that loops forever is
 * decoration, and decoration stops when a reader has asked it to.
 */
describe("looping motion across modules", () => {
  const ALL_MODULES = import.meta.glob("../**/*.module.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  /**
   * Selectors exempted from the rule, each with the reason it is not
   * decoration. Listed rather than left silent, so "we decided to skip this
   * one" is reviewable instead of being an oversight.
   */
  const FUNCTIONAL_FEEDBACK: Record<string, string> = {
    // A spinner's rotation *is* the message — it is what distinguishes "still
    // working" from "finished". Stopping it would leave a static ring that
    // reads as broken, which is worse for this reader than the motion is. The
    // alternatives (an opacity pulse, a determinate bar) are a redesign, not
    // an opt-out.
    ".spinner": "rotation is the loading signal, not decoration",
  };

  /** Selector lists inside a block, flattened: `a,\n b {` yields `a` and `b`. */
  function selectorsOf(block: string): string[] {
    return block
      .split(",")
      .map((s) => s.trim().replace(/^:global\((.+)\)$/, "$1"))
      .filter(Boolean);
  }

  /**
   * Selectors in `css` whose `animation` shorthand names a looping keyframe.
   *
   * A keyframe is treated as a loop when its declaration carries `infinite`.
   * That is the signal that matters: the same keyframe is an entrance on one
   * selector and a loop on another.
   */
  function loopingSelectors(css: string): string[] {
    const keyframes = [
      ...css.matchAll(/@keyframes\s+([A-Za-z0-9_]+)/g),
    ].map(([, name]) => name);

    const out: string[] = [];
    // `matchAll` yields exec arrays, which have no `.group()` — destructure.
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (!/\banimation\s*:/.test(body) || !/\binfinite\b/.test(body)) continue;
      if (!keyframes.some((k) => body.includes(k))) continue;
      // A single rule can carry several selectors, and every one of them loops.
      out.push(...selectorsOf(selectors));
    }
    return [...new Set(out)];
  }

  /** Selectors that a module neutralises under `prefers-reduced-motion`. */
  function optedOut(css: string): Set<string> {
    const out = new Set<string>();
    for (const m of css.matchAll(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g,
    )) {
      for (const [, selectors, body] of m[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (/animation:\s*none/.test(body)) {
          for (const sel of selectorsOf(selectors)) out.add(sel);
        }
      }
    }
    return out;
  }

  /** Every module that loops something it has not already handled. */
  function audit(): Array<{ file: string; selector: string }> {
    const findings: Array<{ file: string; selector: string }> = [];
    for (const [file, raw] of Object.entries(ALL_MODULES)) {
      const css = stripComments(raw);
      const handled = optedOut(css);
      for (const selector of loopingSelectors(css)) {
        if (handled.has(selector) || selector in FUNCTIONAL_FEEDBACK) continue;
        findings.push({ file, selector });
      }
    }
    return findings;
  }

  it("finds the loops it is meant to police", () => {
    // Guard on the guard. An earlier version of this scan matched a selector
    // with `sel\s*\{`, which silently missed every selector that was one item
    // in a comma-separated list — including all fifteen in Home — so the
    // assertion below would have passed while protecting nothing.
    const all = Object.values(ALL_MODULES).flatMap((css) =>
      loopingSelectors(stripComments(css)),
    );
    expect(all.length, "the looping-motion scan found nothing to check").toBeGreaterThan(0);

    // A comma-separated list inside one rule has to be flattened, not
    // truncated to its first item.
    const stepped = all.filter((s) => s.startsWith(".step"));
    expect(stepped.length, "Home's per-step loops were not all detected").toBe(5);

    // The pseudo-element case: the loop lives on `::after`, not the element.
    const skeleton = all.find((s) => s.startsWith(".skeleton"));
    expect(skeleton, "the skeleton shimmer was not detected").toMatch(/::after$/);
  });

  it("stops every looping animation when reduced motion is requested", () => {
    expect(
      audit(),
      "looping animation(s) with no prefers-reduced-motion opt-out",
    ).toEqual([]);
  });

  it("keeps the exemption list small and justified", () => {
    // An exemption is a decision. If most of the app ends up here, the rule is
    // being worked around rather than satisfied.
    const exempt = Object.keys(FUNCTIONAL_FEEDBACK);
    expect(exempt.length, "unexpectedly large exemption list").toBeLessThanOrEqual(2);
    for (const [selector, reason] of Object.entries(FUNCTIONAL_FEEDBACK)) {
      expect(reason.length, `${selector} has no reason recorded`).toBeGreaterThan(20);
    }
  });
});
