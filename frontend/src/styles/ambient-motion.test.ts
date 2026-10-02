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

import AnimatedTerminalSource from "../pages/Home/AnimatedTerminal.tsx?raw";
import globalsCss from "./globals.css?raw";
import ambientCss from "./ambient.css?raw";
import enterCss from "./enter.css?raw";

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

/** Keyframes that belong to *this* file, because the rules using them are
 *  written here too.
 *
 *  `auroraDrift`, `scanline` and `fadeInUp` used to be on this list and were the
 *  whole defect (issue #366): a module cannot name a keyframe declared in an
 *  unscoped sheet, because the build rewrites the reference and not the
 *  definition, so every element that asked for one got an animation-name that
 *  matched nothing and rendered perfectly still. They live in `ambient.css` and
 *  `enter.css` now, and are reached with `composes`. */
const AMBIENT_KEYFRAMES = [
  "gridPan",
  "floatCode",
  "sheenSweep",
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
      "@keyframes gridPan",
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
    // Belt and braces. The opt-out that actually stops them now ships with the
    // composed class in `ambient.css` — these declarations cannot, on their own,
    // be what makes the drift stop, and they are kept for the same reason the
    // audit below accepts them: a module that later re-declares `animation`
    // locally would otherwise reintroduce motion for a reader who asked for
    // none. The composed opt-out is asserted in `shared motion sources` below.
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
 * The score ring's fill, and the empty state it has to have.
 *
 * This pair of rules exists because the arc used to be wrong in a way no test
 * could see. `ScoreRing` is handed the final score, because the number has to
 * count up *to* something, so `stroke-dasharray` is the score's arc from the
 * first frame. The fill was then animated with a keyframe whose `from` was a
 * hardcoded `stroke-dashoffset: 300` — a number copied from one radius — which
 * meant the arc was already two-thirds drawn for the whole run, sitting beside
 * digits reading 0%, and then snapped empty to refill when scoring began. The
 * screenshots showed it; the DOM assertions, which only asked whether an
 * animation was *named*, all passed.
 */
describe("Home score ring fill", () => {
  const homeCss = stripComments(Object.values(HOME_CSS)[0] ?? "");

  it("starts the arc empty, from the score's own arc length", () => {
    // Empty means "offset by exactly the arc length", which slides the whole
    // filled segment into the gap the dash pattern leaves behind. A literal
    // number here is the bug being guarded, not a style preference.
    const base = homeCss.match(
      /\.animPanel \.sampleReport :global\(\.ringProgress\)\s*\{([^}]*)\}/,
    );
    expect(base, "no base rule for the panel's ring arc").not.toBeNull();
    expect(base![1]).toMatch(/stroke-dashoffset:\s*var\(--ring-arc\)/);
    expect(base![1]).not.toMatch(/stroke-dashoffset:\s*\d/);
  });

  it("fills from empty rather than from a number copied off another radius", () => {
    const keyframes = homeCss.match(/@keyframes ringFill\s*\{([\s\S]*?)\n\}/);
    expect(keyframes, "no ringFill keyframes").not.toBeNull();
    expect(keyframes![1]).toMatch(/from\s*\{[^}]*stroke-dashoffset:\s*var\(--ring-arc\)/);
    expect(keyframes![1]).toMatch(/to\s*\{[^}]*stroke-dashoffset:\s*0/);
    // The specific defect: a literal offset in the `from` end.
    expect(keyframes![1]).not.toMatch(/from\s*\{[^}]*stroke-dashoffset:\s*\d/);
  });

  it("fills the arc for a reader who asked for no motion", () => {
    // Reduced motion removes the animation, which is not the same as asking for
    // a filled ring — the base rule now starts it empty on purpose. Without this
    // the same disagreement reappears beside a 67% number, just for the readers
    // who opted out.
    const block = reducedMotionBlock(Object.values(HOME_CSS)[0] ?? "");
    expect(block, "Home.module.css has no reduced-motion block").not.toBe("");
    const arc = block.match(
      /[^{}]*:global\(\.ringProgress\)[^{}]*\{([^}]*)\}/,
    );
    expect(arc, "the reduced-motion block does not reach the ring arc").not.toBeNull();
    expect(arc![1], "the arc is not animated off under reduced motion").toMatch(
      /animation:\s*none/,
    );
    expect(arc![1], "a reduced-motion reader gets an empty ring beside the score").toMatch(
      /stroke-dashoffset:\s*0/,
    );
  });

  it("keeps the arc drawn once the score is out", () => {
    // The trigger and the settled state are two attributes, and conflating them
    // leaves the ring blank at rest: the score stage ends, `data-scoring` goes
    // false, the rule naming the fill stops matching, and the arc snaps back to
    // the empty base while the digits keep the 67% the count-up left them.
    const settled = homeCss.match(
      /\.animPanel \.sampleReport\[data-complete="true"\] :global\(\.ringProgress\)\s*\{([^}]*)\}/,
    );
    expect(settled, "no settled state for the ring arc").not.toBeNull();
    expect(settled![1], "the settled arc is not drawn").toMatch(
      /stroke-dashoffset:\s*0/,
    );
  });

  it("holds the fill's end state rather than springing back to empty", () => {
    // `backwards` was fine while the base *was* the end state. The base is now
    // empty on purpose, so the fill has to be held with `forwards` — otherwise
    // the ring empties the moment the animation finishes.
    const base = homeCss.match(
      /\.animPanel \.sampleReport :global\(\.ringProgress\)\s*\{([^}]*)\}/,
    );
    expect(base![1], "the fill is not held after it finishes").toMatch(
      /animation-fill-mode:\s*forwards/,
    );
  });

  it("publishes the arc length the keyframes read", () => {
    // The CSS is inert without this: `--ring-arc` is only set here, so a rename
    // on either side silently yields an invalid offset and a ring that never
    // fills — which looks like a timing bug, not a wiring one.
    //
    // Read through the same `import.meta.glob` the rest of this file uses rather
    // than `readFileSync(new URL(..., import.meta.url))`: under vitest
    // `import.meta.url` is not a file URL, and `fileURLToPath` throws on it.
    const sources = import.meta.glob("../components/ScoreRing/ScoreRing.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const ring = stripComments(Object.values(sources)[0] ?? "");
    expect(ring, "ScoreRing.tsx was not read").not.toBe("");
    expect(ring).toMatch(/"--ring-arc":\s*`\$\{visibleArc\}`/);
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

/**
 * The scoping trap, stated as an invariant (issue #366).
 *
 * The audits above had a hole that let four families of animation die without a
 * single test noticing. `loopingSelectors` only counts a loop when the keyframe
 * is declared *in the same file*, which sounds like a feature and is the exact
 * reason the bug survived: the four dead references named a keyframe from
 * `globals.css`, so this scan skipped every one of them, and the
 * "every ambient keyframe is defined" list only ever checked `globals.css` —
 * where the definitions were, so it was satisfied. Both checks were green, the
 * build was clean, and the hero did not move.
 *
 * The rule is therefore not "is this keyframe defined somewhere" but "can this
 * file resolve this name": declared here, or reached through a `composes ... from`
 * pointing at a file that declares it. Anything else is a reference to nothing.
 *
 * This is a source-level check and cannot see the rename the build performs, so
 * it is a complement to `e2e/ambient-motion.spec.ts` rather than a replacement:
 * that spec is what proves the engine actually started something, and this is
 * what keeps a dead reference from being committed in the first place.
 */
describe("every animation a module names can be resolved", () => {
  /** This file's own directory, which the glob keys below are relative to. */
  const THIS_DIR = "src/styles";

  /** A glob key re-expressed as a path from `src/`. */
  function anchorToSrc(key: string): string {
    let ups = 0;
    let rest = key;
    while (rest.startsWith("../")) {
      ups += 1;
      rest = rest.slice(3);
    }
    if (rest.startsWith("./")) rest = rest.slice(2);
    const parts = THIS_DIR.split("/");
    for (let i = 0; i < ups; i += 1) parts.pop();
    return [...parts, rest].join("/");
  }

  /**
   * Every stylesheet in `src`, keyed by a path that is comparable across files.
   *
   * `import.meta.glob` keys are relative to *this* file's directory, which
   * makes them useless for comparing across the tree: `ambient.css` comes back
   * as `./ambient.css` and a page module as `../pages/Home/Home.module.css`.
   * Anchoring them all to `src/` is what lets a `composes` target in one file be
   * matched against a file the glob found in another.
   */
  const ALL_CSS = new Map<string, string>(
    Object.entries(
      import.meta.glob("../**/*.css", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>,
    ).map(([key, css]) => [anchorToSrc(key), css]),
  );

  /** Resolve a `composes ... from` target against the importing file. */
  function resolve(from: string, target: string): string {
    const parts = from.split("/").slice(0, -1);
    for (const step of target.split("/")) {
      if (step === "." || step === "") continue;
      if (step === "..") parts.pop();
      else parts.push(step);
    }
    return parts.join("/");
  }

  /**
   * The `animation` shorthand keywords, which are never keyframe names.
   *
   * An explicit list rather than a shape like "all lowercase", because keyframe
   * names are arbitrary idents and a shape-based filter silently drops the
   * lowercase ones — `scanline` was skipped by a `[a-z-]+` catch-all, which is
   * the exact kind of gap this test exists to close. The list is the set the
   * shorthand grammar defines, so it does not need growing in step with CSS.
   */
  const NOT_A_NAME =
    /^(none|normal|reverse|alternate|alternate-reverse|forwards|backwards|both|infinite|running|paused|ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end|inherit|initial|unset|revert.*|var\(.+\)|[a-z-]*\(.+\)|[0-9.]+m?s)$/;

  /** `animation`/`animation-name` values, one per declaration. */
  function animationValues(css: string): string[] {
    return [
      ...css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g),
    ].map(([, value]) => value);
  }

  /** Keyframe names a shorthand actually refers to. */
  function referencedNames(value: string): string[] {
    return value
      .split(",")
      .flatMap((part) => part.trim().split(/\s+/))
      // A bare `linear`/`infinite`/`both` is a keyword, and `var(--x)` is a
      // timing token. The regex drops both by shape: keywords are lower-case
      // words, tokens are wrapped in `var(`, durations end in `s`/`ms`.
      .filter((token) => token && !NOT_A_NAME.test(token));
  }

  /** `@keyframes` a file declares. */
  function declares(css: string): Set<string> {
    return new Set(
      [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(([, name]) => name),
    );
  }

  /** Files a file composes from, as `src`-anchored paths. */
  function composesFrom(file: string, css: string): string[] {
    return [
      ...css.matchAll(/composes:[^;]*?from\s+["']([^"']+)["']/g),
    ].map(([, target]) => resolve(file, target));
  }

  /** Names `file` can resolve, directly or through a composed class. */
  function resolvable(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return new Set();
    seen.add(file);
    const css = stripComments(ALL_CSS.get(file) ?? "");
    const out = declares(css);
    for (const target of composesFrom(file, css)) {
      for (const name of resolvable(target, seen)) out.add(name);
    }
    return out;
  }

  /** Every unresolvable `animation` name, per file. */
  function dangling(): Array<{ file: string; name: string }> {
    const findings: Array<{ file: string; name: string }> = [];
    for (const [file, raw] of ALL_CSS) {
      const resolvableHere = resolvable(file);
      for (const value of animationValues(stripComments(raw))) {
        for (const name of referencedNames(value)) {
          if (!resolvableHere.has(name)) findings.push({ file, name });
        }
      }
    }
    return findings;
  }

  it("has keyframes to check in the first place", () => {
    // Guard on the guard. `resolvable` walks a graph and returns an empty set on
    // a bad path lookup, which would make the assertion below pass while
    // checking nothing — the failure mode this file has already been bitten by
    // twice, so it is worth one test of its own.
    const homeKey = [...ALL_CSS.keys()].find((f) => f.endsWith("Home.module.css"));
    expect(homeKey, "Home.module.css was not picked up by the glob").toBeDefined();
    // A file that composes from another file must see through it.
    expect(
      [...resolvable(homeKey!)],
      "Home cannot resolve the shared keyframes it composes",
    ).toEqual(expect.arrayContaining(["auroraDrift", "scanline"]));
    // ...and one that does not compose must not.
    expect([...resolvable("src/styles/globals.css")]).not.toContain("auroraDrift");
  });

  it("resolves every animation name to a keyframes rule", () => {
    expect(
      dangling(),
      "animation name(s) that match no @keyframes in the same compilation — " +
        "a CSS module cannot reference a keyframe from an unscoped stylesheet, " +
        "because the build scopes the reference and not the definition",
    ).toEqual([]);
  });

  it("keeps the keyframes a module composes in the file it composes from", () => {
    // The inverse direction, and the one that actually catches the regression
    // this issue is about. Without it, moving `auroraDrift` back into
    // `globals.css` would leave `ambient.css` defining a copy that nothing
    // composes, and the modules would go back to naming the global one — which
    // resolves for nobody.
    const sources = ["src/styles/ambient.css", "src/styles/enter.css"];
    const shared = sources.flatMap((f) => [
      ...declares(stripComments(ALL_CSS.get(f) ?? "")),
    ]);
    expect(shared.sort(), "the shared motion sources define nothing").toEqual(
      expect.arrayContaining(["auroraDrift", "scanline", "fadeInUp"]),
    );

    const composedInto = new Set<string>();
    for (const [file, raw] of ALL_CSS) {
      for (const target of composesFrom(file, stripComments(raw))) composedInto.add(target);
    }
    for (const source of sources) {
      expect(
        composedInto.has(source),
        `${source} defines shared keyframes that no module composes`,
      ).toBe(true);
    }
  });
});

/**
 * The shared motion sources are now where the ambient layer's rules live, so
 * they cannot be an unguarded gap in the audit above: a new loop added there
 * with no opt-out has to fail, exactly as one added to a module would.
 */
describe("shared motion sources", () => {
  const ambient = stripComments(ambientCss);
  const enter = stripComments(enterCss);

  it("opts every shared loop out of reduced motion", () => {
    const block = reducedMotionBlock(ambient);
    expect(block, "ambient.css has no reduced-motion block").not.toBe("");
    for (const selector of [".ambientDrift", ".ambientScanline"]) {
      expect(block, `${selector} has no reduced-motion opt-out`).toContain(selector);
      // The selector may head a comma-separated list, as both of these do, so
      // the same allowance the globals check makes is needed here.
      const neutralised = new RegExp(
        `${selector.replace(".", "\\.")}\\s*(,[^{]*)?\\{[^}]*animation:\\s*none`,
      );
      expect(
        neutralised.test(block),
        `${selector} is not set to animation: none under reduced motion`,
      ).toBe(true);
    }
  });

  it("gates the looping rules on the opt-out, not the other way round", () => {
    // The opt-out has to be able to win. A module composing `.ambientDrift` may
    // re-declare `animation` itself, so the guarantee only holds if the
    // `prefers-reduced-motion` block is not outranked by a plain declaration —
    // which is the case whenever the animation and its opt-out live in the same
    // file and the opt-out is written last. Asserting the order here documents
    // the requirement, since the browser cannot see it.
    expect(ambient.lastIndexOf("prefers-reduced-motion")).toBeGreaterThan(
      ambient.indexOf("animation:"),
    );
  });

  it("keeps the one-shot entrance out of the looping audit", () => {
    // `enter.css` holds `fadeInUp`, which finishes after 0.6s. It must not be
    // swept into the looping-motion rule: an entrance that is gated on
    // `prefers-reduced-motion` would leave a reduced-motion reader with a page
    // that never appears, and no way to tell whether it had loaded.
    expect(enter).toContain("@keyframes fadeInUp");
    expect(enter).not.toContain("infinite");
    expect(enter).not.toContain("prefers-reduced-motion");
  });
});

describe("Home terminal entrance", () => {
  const homeCss = stripComments(Object.values(HOME_CSS)[0] ?? "");
  const source = stripComments(AnimatedTerminalSource);

  /**
   * The panel fades itself in and the story waits that fade out, so the opening
   * `generating` beat is watchable instead of being spent at `opacity: 0`. The
   * two numbers live in different files — a CSS duration and a JS lead-in — so
   * this is the one place that can notice them disagreeing. A plain snapshot
   * cannot: nothing throws, the story still completes, and the only symptom is
   * a frame captured at 700ms showing correct content at 10% opacity.
   */
  function entranceMs() {
    const match = source.match(/TERMINAL_ENTRANCE_MS = (\d+)/);
    expect(match, "no TERMINAL_ENTRANCE_MS in AnimatedTerminal").not.toBeNull();
    return Number(match![1]);
  }

  it("starts the panel hidden and reveals it on data-entered", () => {
    const base = homeCss.match(/\.animPanel\s*\{([^}]*)\}/);
    expect(base, "no base rule for the panel").not.toBeNull();
    expect(base![1]).toMatch(/opacity:\s*0/);

    const shown = homeCss.match(/\.animPanel\[data-entered="true"\]\s*\{([^}]*)\}/);
    expect(shown, "no [data-entered=true] rule").not.toBeNull();
    expect(shown![1]).toMatch(/opacity:\s*1/);
    expect(shown![1]).toMatch(/transform:\s*translateY\(0\)/);
  });

  it("keeps the CSS fallback in step with the lead-in it stands in for", () => {
    // The fallbacks only matter if the inline custom properties stop arriving,
    // and they are only right if they match the numbers the component sends. A
    // stale fallback would fade in over a different time than the story waits
    // for, reintroducing the overlap silently.
    const fallbacks = homeCss.match(/--terminal-entrance,\s*(\d+)ms/g) ?? [];
    expect(
      fallbacks.length,
      "the entrance duration has no numeric CSS fallback",
    ).toBeGreaterThan(0);
    for (const fallback of fallbacks) {
      expect(fallback).toContain(`${entranceMs()}ms`);
    }
  });

  it("waits out the whole entrance before the first frame", () => {
    // The first timeline frame is `generatingMs` long, so the lead-in only has
    // to outlast the *fade* for the opening beat to be fully visible. If the
    // lead-in were shorter the panel would still be translucent at t=0, and if
    // it were absent the beat would be lost entirely.
    const lead = source.match(/leadInMs: onScreen \? TERMINAL_ENTRANCE_MS : null/);
    expect(lead, "the story is not gated on the entrance").not.toBeNull();
    expect(entranceMs()).toBeGreaterThan(0);
  });

  it("never leaves the panel hidden from a reduced-motion reader", () => {
    // The one place on this panel that hides itself and relies on a state
    // change to appear, so the reset has to be declared explicitly. Under
    // reduced motion the hook also reports "on screen" immediately, and either
    // mechanism alone being wrong would be a blank terminal.
    const block = reducedMotionBlock(homeCss);
    expect(block, "Home.module.css has no reduced-motion block").not.toBe("");
    const reset = block.match(/\.animPanel\s*\{([^}]*)\}/);
    expect(reset, "the panel has no reduced-motion reset").not.toBeNull();
    expect(reset![1]).toMatch(/opacity:\s*1/);
    expect(reset![1]).toMatch(/transform:\s*none/);
  });
});

/**
 * The Home pipeline timeline (#353).
 *
 * This is the assertion that would have caught the defect #353 fixed. Five
 * cards shared one keyframe, each delayed by its own 2s slice — and the lit
 * state sat at 20-30% of *local* time, which is the *next* slice's opening. So
 * the sweep began a step late and each card was bright while a neighbouring card
 * was brighter. It looked fine: motion was present, the order was roughly right,
 * and nothing was ever counted.
 *
 * A screenshot cannot see this (a highlighted card is a highlighted card) and a
 * value assertion cannot see it (the page has no values). Only the agreement
 * between the keyframe's percentages, the animation duration and the delays can.
 */
describe("the Home pipeline timeline is self-consistent (#353)", () => {
  const homeCss = stripComments(Object.values(HOME_CSS)[0] ?? "");

  /** `@keyframes name { ... }` body, or `""` when absent. */
  function keyframeBody(name: string): string {
    return homeCss.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  }

  /** The percentage stops in a keyframe body, as `[percent, declarations]`. */
  function stops(body: string): [number, string][] {
    return [...body.matchAll(/([\d.]+)%\s*,\s*([\d.]+)%\s*\{([^}]*)\}|([\d.]+)%\s*\{([^}]*)\}/g)].map(
      (m) =>
        m[1] !== undefined
          ? ([Number(m[1]), `${m[2]}% {${m[3]}}`] as [number, string])
          : ([Number(m[4]), `${m[4]}% {${m[5]}}`] as [number, string]),
    );
  }

  it("gives every step the same cycle and one slice of it", () => {
    // Five classes, hand-written because a CSS module cannot loop. These are the
    // numbers the keyframe percentages below are relative to, so they are read
    // rather than restated.
    const delays: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const block = homeCss.match(new RegExp(`\\.step${i}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      // Only the delay. An earlier version read the `animation` shorthand first,
      // which captured the *duration* (`10s`) for all five classes and then
      // compared five identical values against five different expectations.
      delays[i] = /animation-delay:\s*([\d.]+s)/.exec(block)?.[1] ?? "";
      expect(block, `.step${i} not found`).not.toBe("");
      expect(block, `.step${i} must animate on the shared keyframe`).toContain(
        "pipelineStepActive",
      );
      expect(block, `.step${i} must run on the same 10s cycle`).toContain(
        "pipelineStepActive 10s",
      );
    }
    // One 2s slice each, in order. A duplicated or skipped delay is the exact
    // failure this file is here to prevent, and it is invisible in a screenshot.
    expect(delays).toEqual([
      "0s",
      "2s",
      "4s",
      "6s",
      "8s",
    ]);
  });

  it("lights each step inside its own slice, not the next one", () => {
    const body = keyframeBody("pipelineStepActive");
    expect(body, "pipelineStepActive was not found").not.toBe("");

    // The lit declaration is the one that paints the accent. Where it sits in
    // local time is the whole claim.
    const lit = stops(body).filter(([, decls]) =>
      decls.includes("border-color: var(--color-primary)"),
    );
    expect(lit.length, "the lit keyframe no longer paints the accent").toBeGreaterThan(0);
    const [litAt] = lit[0]!;

    // 20% of a 10s cycle is the *next* step's opening — the old bug.
    expect(
      litAt,
      `the card lights at ${litAt}% of local time, which is step ${
        (litAt / 20) | 0
      }'s slice rather than its own`,
    ).toBeLessThanOrEqual(20);

    // And it must be back to rest before the next step opens, or two cards are
    // lit at once and the sequence stops being readable.
    const litMax = Math.max(...lit.map(([pct]) => pct));
    expect(
      litMax,
      `the card is still lit at ${litMax}%, past the next step's opening`,
    ).toBeLessThan(40);
  });

  it("runs each connector in the slice of the step it leads into", () => {
    // The delays used to match the step on the connector's *left*, so every
    // arrow lit while the step behind it was still running and the flow read
    // backwards. `arrowN` now leads into step N+1.
    for (let i = 0; i < 4; i += 1) {
      const block =
        homeCss.match(new RegExp(`\\.pipelineConnector\\.arrow${i}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(block, `.arrow${i} not found`).not.toBe("");
      expect(block).toContain("connectorFlow");
      expect(
        /animation-delay:\s*([\d.]+s)/.exec(block)?.[1],
        `.arrow${i} must light as the step after it becomes active`,
      ).toBe(`${(i + 1) * 2}s`);
    }
    // Nothing lights in the first slice: there is no flow to show before step one.
    expect(homeCss).not.toMatch(/\.pipelineConnector\.arrow0\s*\{[^}]*animation-delay:\s*0s/);
  });

  it("steps the progress bar once per step", () => {
    const body = keyframeBody("progressStages");
    expect(body, "progressStages was not found").not.toBe("");
    // A single linear ramp ignored the cards entirely: the bar was halfway while
    // step one was still lit. Five plateaus on the same 2s boundaries is what
    // makes the bar a readout of this sequence instead of a decoration.
    const percentages = stops(body).map(([pct]) => pct);
    expect(percentages).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("opts every named timeline out for a reduced-motion reader", () => {
    // All nine per-index classes plus the bar, and the cards' entrance. A new
    // keyframe name has to be listed by hand here, which is the point: the
    // generic loop rule in this file cannot match them, because each names its
    // own keyframe.
    const reduce = reducedMotionBlock(homeCss);
    expect(reduce, "no reduced-motion block found in Home.module.css").not.toBe("");
    for (const selector of [
      ".step0",
      ".step1",
      ".step2",
      ".step3",
      ".step4",
      ".pipelineConnector.arrow0",
      ".pipelineConnector.arrow1",
      ".pipelineConnector.arrow2",
      ".pipelineConnector.arrow3",
      ".progressBar",
    ]) {
      expect(
        new RegExp(`${selector.replace(/\./g, "\\.")}\\s*(,|\\{)`).test(reduce),
        `${selector} animates forever and is not opted out for reduced motion`,
      ).toBe(true);
    }
  });

  it("hides the step cards only when motion is welcome", () => {
    // The entrance hides the cards with `opacity: 0`, and the state is undone by
    // `data-entered` rather than by the animation's own end. If that hiding rule
    // escaped the `no-preference` block, a reduced-motion reader would be one
    // missed selector away from four invisible cards — the same trap `.animPanel`
    // documents in this file's reduced-motion block.
    expect(homeCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{\s*\.stepCard\s*\{[^}]*opacity:\s*0/,
    );
    expect(homeCss).toMatch(
      /\.stepsGrid\[data-entered="true"\]\s+\.stepCard\s*\{\s*animation:\s*stepCardIn/,
    );
    // ...and the reduced-motion block has to name that cascade too, or it replays
    // for anyone who reached `data-entered` with motion reduced.
    expect(reducedMotionBlock(homeCss)).toMatch(
      /\.stepsGrid\[data-entered="true"\]\s+\.stepCard\s*\{\s*animation:\s*none/,
    );
  });
});
