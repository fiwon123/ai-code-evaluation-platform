import { describe, expect, it } from "vitest";

/**
 * Two CSS-modules footguns that fail silently rather than loudly.
 *
 * 1. A module that composes from itself (issue #346) — Vite recurses until the
 * heap is exhausted and Vitest simply dies, taking every test file that imports
 * a shared component with it.
 * 2. A module that contains two verbatim copies of itself (issue #372) — the
 * cascade resolves it, nothing complains, and editing the *first* copy of a
 * duplicated selector does nothing because the second one wins.
 *
 * Both are checked here because both are properties of the corpus rather than
 * of one file, and both are checked against the same glob.
 *
 * --- on (1) ---
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
 * --- on (2) ---
 *
 * `Profile.module.css` shipped as two concatenated copies of itself: 1113 lines,
 * 50 selectors declared twice, the second copy starting at the file's midpoint.
 * Nothing about that is invalid CSS. The cascade resolves it, the build is
 * clean, and the page looks exactly like a single stylesheet — which is the
 * problem. It was found in #361 by editing the first copy of a selector and
 * watching nothing happen, and the copies had already drifted (one of them had
 * the wrong comment), so "they are the same" was an assumption rather than a
 * fact anyone could check.
 *
 * The lock is deliberately narrow, because the obvious version of it is wrong.
 * "No selector may appear twice" would fail on three legitimate shapes this
 * repo uses: a grouped rule plus a specific one for a single member
 * (`.listTitle, .listBody` and then `.listTitle`), the same selector under two
 * different at-rule preludes, and one class name shared by two components that
 * genuinely lay out differently. Those are not copies of anything.
 *
 * What actually is a copy is a selector declared twice **with the same
 * declarations** — the paste signature. So that is what is checked, per
 * at-rule path, and the negative controls at the bottom feed the detector the
 * three legitimate shapes to prove they stay quiet.
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

interface Rule {
  /** Enclosing at-rule preludes, outermost first. `""` at the top level. */
  path: string;
  /** One selector — a grouped rule contributes one entry per member. */
  selector: string;
  /** The declarations, whitespace-collapsed and sorted, so formatting is not a signal. */
  declarations: string;
}

/**
 * Flatten a stylesheet into one entry per (at-rule path, selector).
 *
 * A hand-written brace scanner rather than a regex, because the one thing that
 * makes this lock trustworthy is that it does not stop early: a rule it fails to
 * see is a copy it fails to report, which is the silent failure this whole file
 * exists to prevent. Comments are removed first (so a file may explain itself),
 * then every `{` is matched to its `}` and its prelude kept, so a selector's
 * at-rule path is part of its identity.
 */
function rules(css: string, path = ""): Rule[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  let preludeStart = 0;
  let i = 0;
  while (i < source.length) {
    if (source[i] !== "{") {
      i += 1;
      continue;
    }
    const prelude = source.slice(preludeStart, i).trim();
    let depth = 1;
    let j = i + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") depth -= 1;
      j += 1;
    }
    const body = source.slice(i + 1, j - 1);

    if (prelude.startsWith("@")) {
      // An at-rule is a container, not a rule: descend and prefix the path, so
      // `.a` at the top level and `.a` inside `@media` are two identities.
      out.push(...rules(body, path ? `${path} ${prelude}` : prelude));
    } else if (prelude) {
      const declarations = body
        .split(";")
        // Normalise each declaration to `name:value` with single spaces inside
        // each half. Without this, `margin: 0` and `margin:0` read as different
        // rules and a re-indented copy passes as a second rule — which is the
        // exact change this lock exists to notice.
        .map((decl) => {
          const colon = decl.indexOf(":");
          if (colon === -1) return "";
          const name = decl.slice(0, colon).replace(/\s+/g, " ").trim();
          const value = decl.slice(colon + 1).replace(/\s+/g, " ").trim();
          return name && value ? `${name}:${value}` : "";
        })
        .filter(Boolean)
        .sort()
        .join("; ");
      for (const selector of prelude.split(",").map((one) => one.replace(/\s+/g, " ").trim())) {
        if (selector) out.push({ path, selector, declarations });
      }
    }

    i = j;
    preludeStart = j;
  }
  return out;
}

/**
 * Selectors this stylesheet declares twice **with the same declarations** —
 * the paste signature, and the only kind of repeat this lock treats as a bug.
 */
function verbatimCopies(css: string): string[] {
  const seen = new Map<string, number>();
  for (const rule of rules(css)) {
    const key = `${rule.path} ${rule.selector} {${rule.declarations}}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
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

describe("no CSS module carries two copies of itself", () => {
  it("finds no verbatim duplicate rule across every module", () => {
    const offenders: string[] = [];
    for (const [path, css] of Object.entries(MODULES)) {
      for (const key of verbatimCopies(css)) {
        offenders.push(`${path}: ${key}`);
      }
    }
    expect(
      offenders,
      "the same selector declared twice with the same declarations is a pasted copy of a rule, not a second rule. The later copy silently wins, so editing the first one appears to do nothing. Keep one instance — see #372, where Profile.module.css was found to be two of itself.",
    ).toEqual([]);
  });

  it("reads the module the copies were found in, and reaches real rules in it", () => {
    // The corpus check above only proves the glob is populated. This proves the
    // file that actually had the bug is in it, and that parsing it yields rules
    // rather than nothing — an empty parse would satisfy the lock vacuously.
    const path = "../pages/Profile/Profile.module.css";
    expect(Object.keys(MODULES)).toContain(path);
    const parsed = rules(MODULES[path]!);
    expect(parsed.length).toBeGreaterThan(50);
    // Both halves of the merge are still reachable: a rule that only existed in
    // the second copy of the old file, and one that only existed in the first.
    expect(parsed.map((r) => r.selector)).toContain(".page");
    expect(parsed.map((r) => r.selector)).toContain(".failedRuns");
    // …and the two `@media` blocks, because a parser that ignored at-rules would
    // not see the responsive copies at all.
    expect(parsed.filter((r) => r.path.includes("@media")).length).toBeGreaterThan(0);
  });

  it("proves the detector can see a pasted copy, and leaves the three legitimate repeats alone", () => {
    // A check that cannot fail is not a check. These are written inline so they
    // never touch a real file.
    expect(verbatimCopies(`.a { color: red; }\n.a { color: red; }\n`)).toHaveLength(1);
    // Whitespace and declaration order are not a difference…
    expect(verbatimCopies(`.a {\n  color: red;\n  margin: 0;\n}\n.a { margin:0; color:red }\n`)).toHaveLength(1);
    // …but different declarations are a second rule, not a copy.
    expect(verbatimCopies(`.a { color: red; }\n.a { color: blue; }\n`)).toHaveLength(0);
    // A grouped rule plus one member on its own: how `.listTitle, .listBody`
    // is followed by `.listTitle`.
    expect(verbatimCopies(`.a, .b { color: red; }\n.a { font-weight: 600; }\n`)).toHaveLength(0);
    // The same selector under two at-rules is two conditional rules.
    expect(
      verbatimCopies(`.a { color: red; }\n@media (max-width: 600px) { .a { color: red; } }\n`),
    ).toHaveLength(0);
    // Two members of a group pasted twice is still one copy of each.
    expect(verbatimCopies(`.a, .b { color: red; }\n.b, .a { color: red; }\n`)).toHaveLength(2);
    // …and the copies nested inside an at-rule are reported too.
    expect(
      verbatimCopies(`@media (max-width: 600px) { .a { color: red; } }\n@media (max-width: 600px) {\n  .a { color: red; }\n}\n`),
    ).toHaveLength(1);
  });
});
