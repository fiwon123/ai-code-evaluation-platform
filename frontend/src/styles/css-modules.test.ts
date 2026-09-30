import { describe, expect, it } from "vitest";

/**
 * Locks one CSS-modules footgun that fails in the least obvious way possible
 * (issue #346).
 *
 * Sharing a base rule between two classes in the *same* stylesheet is the obvious
 * way to keep two rules in step, and the CSS Modules spec has a tool for it:
 *
 *     .paint,
 *     .control {
 *       composes: layer from "./CodeArea.module.css";
 *     }
 *
 * That `from` points at the file that declares it, so `.paint` composes a class
 * that transitively includes `.paint`. Vite 8's CSS-modules pipeline does not
 * detect the cycle — it resolves it until the heap is exhausted. It does not
 * throw, does not warn, and emits no usable class: the stylesheet simply never
 * finishes transforming.
 *
 * The reason this needs a lock rather than a code comment is the *symptom*. The
 * failure is not "your stylesheet is wrong", it is "Vitest died". Because Vite
 * transforms modules per test file, one malformed stylesheet takes down every
 * test that imports it — and in a run that imports a shared component, that can
 * be the whole batch. During #346 this presented as `challenge-form.test.tsx`
 * taking 57s and then being OOM-killed while the other 31 component test files
 * finished in 2-4s, which reads as "one slow test file" and not as "one CSS
 * file is malformed". It cost a full bisection to localise.
 *
 * The fix is the *local* compose form, with no `from` at all — which is what
 * the repo already does for this exact shape (`Input.module.css` has both
 * `.select` and `.textarea` doing `composes: input;`). The lock exists so that
 * form cannot be "simplified" back into the cyclic one.
 *
 * Files are read through `import.meta.glob(..., { query: "?raw" })` rather than
 * `node:fs`: the app tsconfig has no node types on purpose, and `focus-ring.test.ts`
 * notes the same constraint.
 */

/** Every CSS module under `src/`, keyed by glob path, as raw source text. */
const MODULES = import.meta.glob("../**/*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Resolve a `composes … from` path against the directory of the file that
 * declares it, collapsing `.`/`..` segments. Purely lexical — these keys never
 * leave the module tree, so no filesystem access is involved or wanted.
 */
function resolve(importer: string, from: string): string {
  const importerDir = importer.slice(0, importer.lastIndexOf("/") + 1);
  const segments: string[] = [];
  for (const segment of `${importerDir}${from}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      // A leading `..` must be *kept*, not popped away. The glob keys are
      // relative to this file (`src/styles/`), so every one of them starts with
      // `../`; popping past the start of the stack rewrites
      // `../components/Fake/Fake.module.css` into `components/Fake/fake.module.css`,
      // which then never compares equal to the importer and the lock below
      // passes vacuously. `..` cancels the segment before it only when there is
      // one to cancel.
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else segments.push("..");
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/** Every `composes: <name> from <path>` declaration in a stylesheet. */
function crossFileComposes(css: string): { name: string; from: string }[] {
  // Comments are stripped first. A stylesheet that *explains* the footgun in a
  // comment must not trip the lock that guards against it — otherwise the
  // documentation and the check cannot both exist in one file.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...source.matchAll(/composes:\s*([\w-]+)\s+from\s+["']([^"']+)["']/g)].map((m) => ({
    name: m[1]!,
    from: m[2]!,
  }));
}

describe("no CSS module composes from itself", () => {
  it("finds no self-referential composes across every module", () => {
    const offenders: string[] = [];
    for (const [path, css] of Object.entries(MODULES)) {
      for (const { name, from } of crossFileComposes(css)) {
        if (resolve(path, from) === path) {
          offenders.push(`${path}: composes: ${name} from "${from}"`);
        }
      }
    }
    expect(
      offenders,
      "a module that composes from itself makes Vite's CSS-modules transform recurse until the heap is exhausted, and the run dies without a diagnosable error. Use the local form — `composes: layer;` with no `from` — as Input.module.css does.",
    ).toEqual([]);
  });

  it("inspected every module, rather than a sample", () => {
    // Without this, emptying the glob would make the test above pass vacuously —
    // which is exactly the failure mode `focus-ring.test.ts` guards against in
    // its own "inspected every module" lock.
    const paths = Object.keys(MODULES);
    expect(paths.length).toBeGreaterThan(20);
    // The two files that carry the most `composes` usage, so the scan is known
    // to reach real composition rather than merely counting filenames.
    expect(paths).toContain("../components/Input/Input.module.css");
    expect(paths).toContain("../components/CodeArea/CodeArea.module.css");
  });

  it("proves the detector can see a self-reference, rather than trusting a green run", () => {
    // A check that cannot fail is not a check. This feeds the same detector a
    // stylesheet that does compose from itself — written inline, so it never
    // touches a real file — and requires it to be reported.
    const selfReferential = `.layer { color: red; }\n.a { composes: layer from "./Fake.module.css"; }\n`;
    const crossFile = `.a { composes: layer from "./other.module.css"; }\n`;
    const importer = "../components/Fake/Fake.module.css";

    const flagged = (css: string) =>
      crossFileComposes(css).some(({ from }) => resolve(importer, from) === importer);

    expect(flagged(selfReferential)).toBe(true);
    // A genuine cross-file composition, and a `./`-less sibling path, must not
    // be flagged — otherwise the lock above would fire on legitimate code.
    expect(flagged(crossFile)).toBe(false);
    expect(flagged(`.a { composes: layer from "../Shared/layer.module.css"; }\n`)).toBe(false);
  });
});
