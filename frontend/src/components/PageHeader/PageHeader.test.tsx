/**
 * Locks for the shared page header (issue #404).
 *
 * ## What this file asserts, and what it deliberately does not
 *
 * Two kinds of claim live here and they fail differently, on purpose.
 *
 * The *rendering* claims — a tone picks a title size, a breadcrumb marks the
 * current step, `actions` sits beside the text — are asserted by rendering the
 * component. `PageHeader` composes `AmbientBackdrop`, `PageTitle` and
 * `react-router-dom`, so those assertions run under the same providers the
 * pages give them.
 *
 * The *stylesheet* claims — the host trio, the two subtitle treatments, the
 * centring the legal pages had never received — are checked as source text. That
 * is not the source-grep this repo distrusts elsewhere: the claim is the narrow,
 * literal one ("this rule declares these properties"), and no browser
 * observation states it more precisely. What a source check cannot know — that
 * the wash actually paints behind this header, that the 640px measure is what
 * renders — is measured in computed style on the real routes in
 * `e2e/ambient-wash.spec.ts`, and `page-rhythm.test.ts` keeps reading this
 * component's marketing rule as the hero subtitle for the pages that delegate
 * to it.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import titleStyles from "../PageTitle/PageTitle.module.css";
import PageHeader from "./PageHeader.tsx";
import styles from "./PageHeader.module.css";

/** The stylesheet as text, for the declaration-level locks below. */
const CSS = import.meta.glob("./*.module.css", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const SHEET = stripComments(Object.values(CSS).join("\n"));

/** `body` of every rule, paired with its selector. */
function rules(source: string): { selector: string; body: string }[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").trim().split("\n").pop()!.trim(),
    body: match[2] ?? "",
  }));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The rule for a selector, or `undefined`. */
function rule(selector: string): string | undefined {
  return rules(SHEET).find((found) => found.selector === selector)?.body;
}

/** Declarations only — the same reason `AmbientBackdrop.test.tsx` has it. */
function decls(body: string): string {
  return stripComments(body);
}

function renderHeader(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("the shared page header", () => {
  it("hosts the ambient wash with the contract the backdrop needs", () => {
    // The trio is what makes a `z-index: -1` backdrop mean "behind this header"
    // instead of "behind the page background", and what clips the blobs' 80px
    // blur to the header. It was copy-pasted into sixteen stylesheets before this
    // component existed; `AmbientBackdrop.test.tsx` checks it on the shells that
    // still declare their own, and this is the one every other shell inherits.
    const header = rule(".header");
    expect(header, "the header must declare the host contract").toBeDefined();
    expect(decls(header!)).toMatch(/position:\s*relative/);
    expect(decls(header!)).toMatch(/isolation:\s*isolate/);
    expect(decls(header!)).toMatch(/overflow:\s*hidden/);
  });

  it("mounts the wash itself, so a caller cannot forget it", () => {
    const { container } = renderHeader(<PageHeader title="Challenges" />);
    expect(container.querySelector("[aria-hidden='true']"), "the header carries no backdrop")
      .toBeTruthy();
  });

  it("renders the title as the page's one h1, sized by the tone", () => {
    const app = renderHeader(<PageHeader title="Challenges" subtitle="Sub" />);
    // The size is `PageTitle`'s, not this component's, so the tier is asserted
    // against `PageTitle`'s own module: `md` for app pages, `lg` for marketing —
    // the tiers #309 measured, adopted here rather than relitigated.
    const heading = app.container.querySelector("h1");
    expect(heading?.className).toContain(titleStyles.md!);
    expect(heading?.className).not.toContain(titleStyles.lg!);
    // And it is genuinely the shared title, not a re-implemented `<h1>`.
    expect(heading?.className).toContain(titleStyles.title!);

    const marketing = renderHeader(
      <PageHeader tone="marketing" title="Privacy" subtitle="Sub" />,
    );
    expect(marketing.container.querySelector("h1")?.className).toContain(titleStyles.lg!);
  });

  it("renders the optional pieces, and omits the ones a page did not ask for", () => {
    const { container } = renderHeader(
      <PageHeader
        title="Create a challenge"
        subtitle="Define a coding task."
        eyebrow="Legal"
        meta={<p className="revision">Last updated</p>}
        actions={<button type="button">New challenge</button>}
        breadcrumb={[
          { label: "Challenges", to: "/challenges" },
          { label: "Edit" },
        ]}
      />,
    );

    // The breadcrumb is a nav with a name, not a row of links — the reason the
    // label is the component's to supply rather than each page's.
    const nav = container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Breadcrumb");
    // Two crumbs, one separator, and the current page marked as such: the last
    // crumb has no `to`, which is how a step says "you are here".
    expect(nav?.querySelectorAll("a")).toHaveLength(1);
    expect(nav?.querySelector("[aria-current='page']")?.textContent).toBe("Edit");
    expect(nav?.textContent).toContain("/");
    // The separator is decorative, so it must not be announced between steps.
    const separators = [...(nav?.querySelectorAll("span") ?? [])].filter(
      (span) => span.getAttribute("aria-hidden") === "true",
    );
    expect(separators).toHaveLength(1);

    expect(container.querySelector(".eyebrow")?.textContent).toBe("Legal");
    expect(container.querySelector(".revision")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New challenge" })).toBeTruthy();
    expect(container.querySelector("p")?.className).toContain(styles.subtitle!);
  });

  it("leaves the slots empty rather than rendering empty wrappers", () => {
    // An empty `<nav>` or a stray empty `<p>` is announced as nothing but still
    // occupies a line in the accessibility tree and a class in the stylesheet;
    // a page with no breadcrumb should not grow one.
    const { container } = renderHeader(<PageHeader title="Challenges" />);
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector(".eyebrow")).toBeNull();
  });

  it("gives both tones the same subtitle colour, because it is one role", () => {
    // The drift this closes: one subtitle role, two colour tokens — `--color-
    // text-muted` on Contact and Features, `--color-text-secondary` on About,
    // Pricing and the legal pages. Both tones now read the same token, so a page
    // migrated later cannot reintroduce the split from its own stylesheet.
    const app = rule(".app .subtitle");
    const marketing = rule(".marketing .subtitle");
    expect(app, "the app tone must style its subtitle").toBeDefined();
    expect(marketing, "the marketing tone must style its subtitle").toBeDefined();
    const token = /color:\s*([^;]+);/.exec(decls(app!))?.[1]?.trim();
    expect(token, "the app subtitle must set a colour token").toBeDefined();
    expect(decls(marketing!), "the marketing subtitle must use the same token")
      .toContain(`color: ${token};`);
  });

  it("centres the marketing hero, measure included", () => {
    // What `/legal` never had: it carried the 600px measure from #309 but sat
    // hard against the left edge, because centring was four other pages' private
    // `text-align: center` rather than part of the marketing header.
    const marketing = rule(".marketing");
    expect(decls(marketing!), "the marketing tone must centre its header")
      .toMatch(/text-align:\s*center/);
    const subtitle = decls(rule(".marketing .subtitle") ?? "");
    // `text-align` alone would centre an unbounded line; the measure is what
    // makes centring a paragraph legible, and `margin: 0 auto` centres the box.
    expect(subtitle, "the marketing measure is missing").toMatch(/max-width:\s*600px/);
    expect(subtitle, "the measured box is not centred").toMatch(/margin:\s*0\s+auto/);
  });

  it("keeps the app tone a flex row that still stacks on a phone", () => {
    const app = rule(".app");
    const body = decls(app!);
    // `/challenges` puts "New challenge" to the right of the title, which is why
    // this is a row and not a block.
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-wrap:\s*wrap/);
    // …and the column fallback is what keeps that usable at 640px. Asserted as
    // a declaration rather than a rendered breakpoint: the phone rendering is
    // `ambient-wash.spec.ts`'s job, on a real viewport.
    expect(SHEET).toMatch(/@media\s*\(max-width:\s*640px\)\s*{\s*\.app\s*{\s*flex-direction:\s*column/);
  });

  it("plays the entrance only when a page asks for it", () => {
    // The two challenge forms rose into place and `/challenges` never did. A
    // tone default would have added motion to a page nobody asked to move, so
    // this is a prop — and it composes the shared animation rather than
    // declaring its own, which would be rewritten to a scoped keyframe name that
    // matches nothing (the trap `enter.css` documents).
    expect(rule(".animated")).toMatch(
      /composes:\s*fadeInUp\s+from\s+"\.\.\/\.\.\/styles\/enter\.css"/,
    );
    const plain = renderHeader(<PageHeader title="Challenges" />);
    expect(plain.container.querySelector("header")?.className).not.toContain(
      styles.animated!,
    );
    const animated = renderHeader(<PageHeader animate title="Create a challenge" />);
    expect(animated.container.querySelector("header")?.className).toContain(
      styles.animated!,
    );
  });

  it("lets a page set its own measure without touching the shell", () => {
    // The challenge forms cap the header at 760px to match the form below it.
    // That is a page decision, and the escape hatch is `className` — not a prop
    // that would put a form's measure in a header component.
    const { container } = renderHeader(
      <PageHeader className="narrow" title="Create a challenge" />,
    );
    expect(container.querySelector("header")?.className).toContain("narrow");
  });
});
