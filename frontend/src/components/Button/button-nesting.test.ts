/**
 * No interactive content inside a link (issue #244).
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

/** Remove block and line comments, so documentation is not mistaken for code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("interactive content is not nested inside a link", () => {
  it("has no <Link> containing a button", () => {
    const offenders: string[] = [];
    for (const [path, raw] of Object.entries(SOURCES)) {
      const src = stripComments(raw);
      // `<Link` alone is not enough: `NavLink` also renders an `<a href>`, and
      // the header's "Log in" was a `NavLink` wrapping a `Button` — so both this
      // test and the codemod that preceded it matched `<Link`, sailed past
      // `<NavLink`, and the production build still shipped a `button` in an `a`.
      // Non-greedy to the first closing tag: a `<Button>` after the link closes
      // is a sibling, not a child, and must not be reported.
      for (const m of src.matchAll(/<(?:Nav)?Link\b[^>]*>([\s\S]*?)<\/(?:Nav)?Link>/g)) {
        if (/<Button\b/.test(m[1]) || /<button\b/.test(m[1])) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${path.replace(/^\.\.\//, "")}:${line}`);
        }
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
