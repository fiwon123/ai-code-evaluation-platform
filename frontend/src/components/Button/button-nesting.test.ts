/**
 * No interactive content inside a link (issues #244, #249).
 *
 * `<Link to="/x"><Button>…</Button></Link>` renders a `<button>` inside an
 * `<a href>`. It is invalid HTML, and it costs a keyboard user two focus stops
 * to activate one thing, while a screen reader announces a link that contains a
 * button. Twenty call sites did this before `Button` grew a `to` prop.
 *
 * This is a source-level check on purpose. Rendering every page to assert it
 * would need a fixture per page and would still miss a route nobody renders in
 * a test — which is precisely how twenty of them accumulated. Comments are
 * stripped first, so the `Button` docstring can keep showing the old pattern as
 * the thing it replaced without tripping the test that forbids it.
 *
 * #249 added the second half. The conversion was correct in the source, but
 * `contrast.spec.ts` went on selecting `main a[href="/demo"] button` — a button
 * *inside* an anchor — and so died on "element(s) not found" in four places
 * while looking like a contrast regression. A test that waits for a shape the
 * app has moved on from keeps its name in the report while measuring nothing,
 * so specs are audited for the same defect here.
 *
 * Comments **and string literals** are blanked before either scan, which is what
 * makes it possible to test the detector at all: the fixtures below quote the
 * forbidden markup, and a lock that could not tell a fixture from a component
 * could only be tested by breaking the build.
 */
import { describe, expect, it } from "vitest";

/**
 * `../../**`, not `../**`: this file sits in `src/components/Button/`, so a
 * single `..` reaches only `src/components` — 53 files, none of them pages.
 * Every one of the twenty was in `src/pages` or `Layout`, so the first
 * version of this test passed while inspecting nothing that mattered. The
 * coverage assertion below is what caught it.
 */
const SOURCES = import.meta.glob("../../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The e2e suite, for the same audit applied to selectors. */
const SPECS = import.meta.glob("../../../e2e/**/*.spec.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Blank comments while preserving length and newlines.
 *
 * Length-preserving so a reported offset still maps to a real line; newline-
 * preserving so line numbers stay right inside a multi-line comment. The
 * `(^|[^:])` guard is what keeps `//` inside a URL from eating the rest of the
 * line.
 */
function blankComments(src: string): string {
  const spaces = (match: string) => match.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, spaces)
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (match, before: string) => before + spaces(match.slice(before.length)),
    );
}

/** Also blanks string and template literals, so a fixture cannot trip a scan. */
function blankCode(src: string): string {
  const spaces = (match: string) => match.replace(/[^\n]/g, " ");
  return blankComments(src)
    .replace(/"(?:[^"\\]|\\.)*"/g, spaces)
    .replace(/'(?:[^'\\]|\\.)*'/g, spaces)
    .replace(/`(?:[^`\\]|\\.)*`/g, spaces);
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split("\n").length;
}

/**
 * Line numbers where a `<button>` is nested inside an anchor.
 *
 * Walks from each anchor's opening tag to its *matching* close, tracking depth
 * so a `<Link>` inside a `<Link>` does not end the search early, and skips
 * self-closing anchors because those have no children. `NavLink` is in the list
 * because it also renders an `<a href>`: the header's "Log in" was a `NavLink`
 * wrapping a `Button`, and a check that only knew `<Link` sailed past it.
 */
function nestedButtons(src: string): number[] {
  const code = blankCode(src);
  const found: number[] = [];

  for (const tag of ["Link", "NavLink"]) {
    const open = new RegExp(`<${tag}\\b`, "g");
    for (let match = open.exec(code); match; match = open.exec(code)) {
      // Step past this anchor's opening tag, so its own attributes are never
      // mistaken for children.
      let cursor = match.index;
      let depth = 0;
      let selfClosing = false;
      while (cursor < code.length) {
        if (code.startsWith("/>", cursor)) {
          selfClosing = true;
          cursor += 2;
          break;
        }
        if (code.startsWith(">", cursor)) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      if (selfClosing) {
        continue;
      }

      const edge = new RegExp(`<${tag}\\b|</${tag}\\s*>`, "g");
      edge.lastIndex = cursor;
      let boundary = -1;
      for (let step = edge.exec(code); step; step = edge.exec(code)) {
        if (step[0].startsWith("</")) {
          if (depth === 0) {
            boundary = step.index;
            break;
          }
          depth -= 1;
        } else {
          depth += 1;
        }
      }
      // Unbalanced source: scan to the end rather than pretending the subtree
      // ended somewhere it did not.
      if (boundary === -1) {
        boundary = code.length;
      }

      const button = /<(?:Button|button)\b/g;
      button.lastIndex = cursor;
      const inner = button.exec(code.slice(0, boundary));
      if (inner && inner.index >= cursor) {
        found.push(lineOf(src, inner.index));
      }
    }
  }

  return [...new Set(found)].sort((a, b) => a - b);
}

/**
 * Quoted strings in a spec that read as a selector nesting a `button` inside an
 * `a` — or the reverse, a link inside a button, which is equally invalid.
 *
 * Only comments are blanked: the string **is** the selector, so blanking
 * literals first would delete the very thing being audited and the scan would
 * pass while inspecting nothing.
 */
function anchorNestingSelectors(spec: string): string[] {
  const code = blankComments(spec);
  const offenders: string[] = [];
  // Delimiter forms matched separately, so `'main a[href="/demo"] button'` is
  // read whole — the inner double quotes must not terminate it.
  const quoted = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  // Only selector-shaped text. An interpolated or arrow-bearing string is code,
  // and flagging it would make the lock cry wolf on unrelated specs.
  const selectorShaped = /^[\w\s.#>[\]="'`~^$|*(),:@/-]+$/;
  for (let match = quoted.exec(code); match; match = quoted.exec(code)) {
    const content = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!content || content.includes("${") || !selectorShaped.test(content)) {
      continue;
    }
    if (/\ba\b[\s\S]*\bbutton\b/.test(content) || /\bbutton\b[\s\S]*\ba\b/.test(content)) {
      offenders.push(content);
    }
  }
  return offenders;
}

describe("interactive content is not nested inside a link", () => {
  it("has no <Link> containing a button", () => {
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(SOURCES)) {
      for (const line of nestedButtons(raw)) {
        offenders.push(`${path.replace(/^\.\.\//, "")}:${line}`);
      }
    }
    expect(
      offenders,
      "a <button> inside an <a href> is invalid and is two focus stops for one action — use <Button to=…>",
    ).toEqual([]);
  });

  it("inspected every component and page, rather than a sample", () => {
    // A glob that silently matches fewer files than intended would make the
    // test above pass without having looked at the pages — which is exactly
    // what a one-level `..` did here.
    const paths = Object.keys(SOURCES);
    expect(paths.length).toBeGreaterThan(90);
    // Both directories that actually contained offenders.
    expect(paths.filter((p) => p.includes("pages/")).length).toBeGreaterThan(20);
    expect(paths.some((p) => p.endsWith("Layout.tsx"))).toBe(true);
    expect(paths.some((p) => p.endsWith("Button.tsx"))).toBe(true);
    expect(paths.some((p) => p.endsWith("pages/Home/Home.tsx"))).toBe(true);
  });

  it("gives Button a `to` prop, so a link can look like a button", () => {
    // Without this the fix is "stop nesting" with no way to keep the
    // appearance, and the nesting comes back.
    const key = Object.keys(SOURCES).find((p) => p.endsWith("Button.tsx")) ?? "";
    const button = SOURCES[key] ?? "";
    expect(button, "Button.tsx was not in the glob").not.toBe("");
    expect(button).toMatch(/to:\s*To;/);
    expect(button).toMatch(/<Link/);
  });
});

describe("no spec waits for a button inside a link", () => {
  it("resolves a non-empty set of specs", () => {
    // A glob typo reads `{}`, every `for` iterates nothing, and the audit below
    // passes while inspecting nothing.
    expect(Object.keys(SPECS).length).toBeGreaterThan(4);
  });

  it("finds no anchor>button selector", () => {
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(SPECS)) {
      for (const selector of anchorNestingSelectors(raw)) {
        offenders.push(`${path.replace(/^\.\.\//, "")} selects \`${selector}\``);
      }
    }
    expect(
      offenders,
      "this selector describes markup that no longer exists — a spec that cannot match is not a passing spec",
    ).toEqual([]);
  });
});

/**
 * The detector, tested against fixtures.
 *
 * In #244 the fix and the lock that guarded it both matched the token `<Link`,
 * so both passed while a `<NavLink>`-wrapped `Button` — equally an `<a href>` —
 * reached production. Two artifacts with one blind spot corroborate each other
 * falsely, so the blind spot is pinned here rather than assumed absent.
 */
describe("the detector itself", () => {
  it("catches a button nested in a Link", () => {
    expect(
      nestedButtons(
        ['const x = (', '  <Link to="/demo">', '    <Button>Go</Button>', '  </Link>', ');'].join(
          "\n",
        ),
      ),
    ).toEqual([3]);
  });

  it("catches a button nested in a NavLink", () => {
    // The #244 blind spot: a detector that only knew `Link` passes this.
    expect(
      nestedButtons(
        [
          'const x = (',
          '  <NavLink to="/challenges">',
          '    <Button>Open</Button>',
          '  </NavLink>',
          ');',
        ].join("\n"),
      ),
    ).toEqual([3]);
  });

  it("catches a plain <button> as well as a <Button>", () => {
    expect(nestedButtons('<Link to="/x"><button>raw</button></Link>')).toEqual([1]);
  });

  it("catches a self-closing button inside an anchor", () => {
    expect(nestedButtons('<Link to="/x"><Button size="sm">x</Button></Link>')).toEqual([1]);
  });

  it("allows a self-closing anchor, which has no children", () => {
    expect(nestedButtons('<Link to="/x" />')).toEqual([]);
  });

  it("does not stop at a nested anchor of the same tag", () => {
    // The outer <Link> is not closed until the inner one closes, so a Button
    // after the inner close is still inside the outer one.
    expect(
      nestedButtons(
        ['<Link to="/a">', '  <Link to="/b">x</Link>', "  <Button>y</Button>", '</Link>'].join(
          "\n",
        ),
      ),
    ).toEqual([3]);
  });

  it("ignores a Button mentioned in a comment or a string", () => {
    const source = [
      '// <Link to="/x"><Button>no</Button></Link>',
      'const label = "<Link><Button>no</Button></Link>";',
      "const tpl = `<Link><Button>no</Button></Link>`;",
    ].join("\n");
    expect(nestedButtons(source)).toEqual([]);
  });

  it("reports the real line after a multi-line template literal", () => {
    // The literal is blanked, but its newlines survive, so the violation below
    // is still reported against its own line rather than one shifted up.
    const source = [
      "const a = 1;",
      "const t = `line one",
      "line two`;",
      "<Link>",
      "  <Button>x</Button>",
      "</Link>",
    ].join("\n");
    expect(nestedButtons(source)).toEqual([5]);
  });

  it("finds an anchor>button selector in a spec", () => {
    expect(
      anchorNestingSelectors(`const cta = page.locator('main a[href="/demo"] button');`),
    ).toEqual(['main a[href="/demo"] button']);
    expect(anchorNestingSelectors(`page.locator("a > button")`)).toEqual(["a > button"]);
  });

  it("allows a selector that is an anchor or a button, but not both", () => {
    expect(anchorNestingSelectors(`page.getByRole("button", { name: "Save" })`)).toEqual([]);
    expect(anchorNestingSelectors(`page.locator('main a[href="/demo"]')`)).toEqual([]);
    expect(anchorNestingSelectors(`page.locator("button span")`)).toEqual([]);
    expect(anchorNestingSelectors(`page.locator('[class*="summaryTitle"]')`)).toEqual([]);
  });
});
