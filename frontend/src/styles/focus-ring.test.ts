/**
 * One focus treatment (issue #244).
 *
 * Focus was expressed five different ways before this, every one of them at a
 * higher specificity than the global `:focus-visible` rule, so every one of them
 * silently won:
 *
 * | Selector                    | Treatment                                        |
 * |-----------------------------|--------------------------------------------------|
 * | `Input .input:focus`        | `outline: none` + `--color-primary-light`        |
 * | `ThemeToggle .toggle`       | `outline: none` + `--color-primary-light`        |
 * | `Challenges .searchInput`   | `outline: none` + `--color-focus-ring`           |
 * | `ChallengeDetail` key input | `outline: none` + border-colour — **no ring**   |
 * | `Contact .handoffTitle`     | `outline-offset: 4px`, not the global 2px         |
 *
 * The API-key input was the outright failure: no outline and no ring leaves a
 * 1px border-colour change, which changes no area and does not meet WCAG 2.4.11.
 *
 * `styles/focus.css` now owns the ring, and modules opt in with `composes`. This
 * test fails if one grows its own again.
 */
import { describe, expect, it } from "vitest";

const MODULES = import.meta.glob("../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The shared treatment is not a `*.module.css`, so it needs its own glob — a
 * `*.module.css` pattern silently does not match it, and the first version of
 * this test therefore read `undefined` and reported the treatment as missing.
 */
const SHARED_GLOBS = import.meta.glob("../styles/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FOCUS_CSS = "./focus.css";

/** Ring colours a module may legitimately use in a focus rule. */
const RING_TOKENS = ["--color-focus-ring", "--color-danger-light"];

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every `:focus` / `:focus-visible` block body, with its selector. */
function focusRules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = m[1].trim();
    // `:focus-within` is a container state, not a focus indicator.
    if (!/:focus(-visible)?\b/.test(selector)) continue;
    if (/:focus-within/.test(selector)) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

describe("focus is expressed one way", () => {
  it("has a shared focus stylesheet, with a ring for controls and for fields", () => {
    const shared = SHARED_GLOBS[FOCUS_CSS];
    expect(shared, "styles/focus.css is missing — the shared treatment is gone").toBeDefined();
    // Both shapes, one geometry: the ring must be the same 3px in each.
    expect(shared).toMatch(/\.focusRing:focus-visible/);
    expect(shared).toMatch(/\.focusRingField:focus/);
    const rings = [...shared.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(rings.length, "focus.css declares no ring").toBeGreaterThan(0);
    for (const ring of rings) {
      expect(ring).toMatch(/0 0 0 3px var\(--color-focus-ring\)/);
    }
  });

  it("gives every focusable control an indicator that adds area or a ring", () => {
    // The defect this exists to catch: `outline: none` with no ring, leaving a
    // border-colour change as the only signal.
    const offenders: string[] = [];
    for (const [path, css] of Object.entries(MODULES)) {
      if (path === FOCUS_CSS) continue;
      for (const { selector, body } of focusRules(css)) {
        const killsOutline = /outline:\s*none/.test(body);
        const ring = /box-shadow:[^;]*var\(--color-(focus-ring|danger-light)\)/.test(body);
        if (killsOutline && !ring) {
          offenders.push(`${path.replace(/^\.\.\//, "")} ${selector}`);
        }
      }
    }
    expect(
      offenders,
      "outline: none with no ring — the only focus signal left is a border-colour change",
    ).toEqual([]);
  });

  it("routes focus rings through the shared tokens, not a local colour", () => {
    const offenders: string[] = [];
    for (const [path, css] of Object.entries(MODULES)) {
      if (path === FOCUS_CSS) continue;
      for (const { selector, body } of focusRules(css)) {
        for (const m of body.matchAll(/box-shadow:\s*([^;]+);/g)) {
          const shadow = m[1];
          // Not every box-shadow in a focus rule is a ring: `StatCard` lifts its
          // card when the wrapping link takes focus, and that is an elevation,
          // not an indicator. Ring geometry is `0 0 0 <n>px`.
          if (!/0 0 0 \d/.test(shadow)) continue;
          if (!RING_TOKENS.some((t) => shadow.includes(`var(${t})`))) {
            offenders.push(`${path.replace(/^\.\.\//, "")} ${selector}: ${shadow.trim()}`);
          }
        }
      }
    }
    expect(offenders, "a module hand-rolled its own focus ring").toEqual([]);
  });

  it("keeps the ring the same size wherever it appears", () => {
    // One geometry means a keyboard user learns it once. A 3px ring in one place
    // and a 4px ring in another is two things to notice.
    const offenders: string[] = [];
    for (const [path, css] of Object.entries(MODULES)) {
      if (path === FOCUS_CSS) continue;
      for (const { selector, body } of focusRules(css)) {
        for (const m of body.matchAll(/0 0 0 (\d+)px/g)) {
          if (m[1] !== "3") {
            offenders.push(`${path.replace(/^\.\.\//, "")} ${selector}: ${m[1]}px ring`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("actually reaches the controls it claims to", () => {
    // Every control that used to hand-roll a ring now composes the shared one.
    // A `composes` that names a class focus.css does not export would be
    // silently dropped by the CSS-modules build, leaving no focus style at all.
    const shared = SHARED_GLOBS[FOCUS_CSS] ?? "";
    const exported = [...shared.matchAll(/^\.([A-Za-z][\w-]*):focus/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(["focusRing", "focusRingField"]);

    const composed = Object.entries(MODULES)
      .filter(([p]) => p !== FOCUS_CSS)
      .flatMap(([path, css]) =>
        [...stripComments(css).matchAll(/composes:\s*([\w-]+)\s+from\s+["'][^"']*focus\.css["']/g)].map(
          (m) => ({ page: path.replace(/^\.\.\//, ""), cls: m[1] }),
        ),
      );
    expect(
      composed.map((c) => c.cls).filter((c) => !exported.includes(c)),
      "a module composes a focus class that focus.css does not export",
    ).toEqual([]);
    // The five controls that had their own treatment.
    const pages = composed.map((c) => c.page);
    for (const expected of [
      "components/Input/Input.module.css",
      "components/ThemeToggle/ThemeToggle.module.css",
      "pages/Challenges.module.css",
      "pages/ChallengeDetail.module.css",
      "pages/Contact/Contact.module.css",
    ]) {
      expect(pages, `${expected} no longer composes the shared focus ring`).toContain(expected);
    }
  });

  it("inspected every module, rather than a sample", () => {
    const paths = Object.keys(MODULES);
    expect(paths.length).toBeGreaterThan(30);
    expect(paths.filter((p) => p.includes("pages/")).length).toBeGreaterThan(15);
    expect(Object.keys(SHARED_GLOBS)).toContain(FOCUS_CSS);
  });
});
