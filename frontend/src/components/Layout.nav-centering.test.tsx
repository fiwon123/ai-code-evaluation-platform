/**
 * The header's seven links sit on the header's centre line (#400).
 *
 * They used to sit immediately right of the logo, which put the group 147px left
 * of centre at 1440px — measured, not eyeballed. The cause is not a colour or a
 * spacing token: `justify-content: space-between` on a flex row distributes the
 * *gap*, so the group is centred only when the two ends are the same width, and
 * the actions cluster (188px) is 65px wider than the logo (123px). A flex row
 * cannot express "centre this middle group"; three tracks can, by making the two
 * outer tracks equal.
 *
 * So this file asserts the three things that make centring exact — equal outer
 * tracks, `auto` in the middle, and `space-between` gone — and, because a CSS
 * assertion passes no matter what the DOM does, also that the links are actually
 * in the middle track: the second child of `.nav`, between the brand and the
 * actions. Three tracks with the wrong element in the middle still centre
 * something; that is the same trap `Layout.nav-spacing.test.tsx` documents for
 * the theme toggle, and it is why the structure assertion is here at all.
 *
 * The rendered half of this lock — that the links' centre lands within a pixel of
 * the header's, and that nothing overlaps at 1024px — is `e2e/nav.spec.ts`,
 * because a stylesheet cannot tell you where a box ended up.
 */
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { maxWidthMediaBlocks, ruleBody } from "../test/cssRules";
import css from "./Layout.module.css?raw";
import styles from "./Layout.module.css";

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => ({ user: null, logout: vi.fn() }),
}));

const { default: Layout } = await import("./Layout");

function renderLayout() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("the header nav is centred (#400)", () => {
  it("uses three tracks with equal outer tracks", () => {
    const nav = ruleBody(css, ".nav");
    expect(nav, "`.nav` must be the three-track grid, not a flex row").toMatch(/display:\s*grid/);

    const columns = nav.match(/grid-template-columns:\s*([^;]+);/);
    expect(columns, "`.nav` needs an explicit `grid-template-columns`").not.toBeNull();
    const [left, middle, right] = columns![1]!.trim().split(/\s+/);
    // Equal outer tracks are the fix. `1fr auto 1fr` is the only shape that puts
    // the middle track on the container's centre line regardless of how wide the
    // brand and the actions each turn out to be.
    expect(
      left,
      `outer tracks must be equal — \`${columns![1]!.trim()}\` centres the middle ` +
        "only while the two sides happen to match, which is the bug this replaces",
    ).toBe(right);
    expect(middle, "the middle track holds the links and must size to them").toBe("auto");
  });

  it("no longer distributes the row with space-between", () => {
    const nav = ruleBody(css, ".nav");
    expect(
      nav,
      "`justify-content: space-between` distributes the gap, not the group: with " +
        "unequal ends it pushes the links off the centre line, which is the defect",
    ).not.toMatch(/justify-content:\s*space-between/);
  });

  it("puts the links in the middle track as the second child of .nav", () => {
    const { container } = renderLayout();
    const nav = container.querySelector(`.${styles.nav}`);
    const links = container.querySelector(`.${styles.links}`);
    expect(nav, "the .nav element was not rendered").not.toBeNull();
    expect(links, "the .links list was not rendered").not.toBeNull();

    // A grid centres whatever sits in the middle column, so the CSS above would
    // pass with the links anywhere. Only the DOM order says which track is which.
    expect(
      links!.parentElement,
      "the links must be a direct child of .nav — nested, they are not a track",
    ).toBe(nav);

    const children = [...nav!.children];
    expect(children.indexOf(links!), "the links must be the second child").toBe(1);
    expect(children[0]!.className, "the brand goes first").toContain(styles.brand);
    expect(children[2]!.className, "the actions go last").toContain(styles.navRight);
  });

  it("collapses to the two-item bar at 1023px, where the centred row cannot fit", () => {
    // Measured: the links are 547px wide, so a centred row needs 547 + 2 × 188
    // (the wider end) = 923px of nav, i.e. a 971px header. Leaving this at 768px
    // would put a three-track grid on a 769-1023px tablet, where the middle track
    // cannot fit and the links land on top of the theme toggle — the overlap that
    // is already in the issue this replaces.
    const collapsed = maxWidthMediaBlocks(css).find((block) => block.condition === "1023px");
    expect(
      collapsed,
      "no 1023px media block — the centred grid would be live on tablets",
    ).toBeDefined();
    expect(
      ruleBody(collapsed!.body, ".nav"),
      "`.nav` must return to flex below 1024px: in a grid the burger would take the " +
        "middle track, because `order` reorders grid items and the links are out of " +
        "flow here, leaving that track free",
    ).toMatch(/display:\s*flex/);
    expect(ruleBody(collapsed!.body, ".navRight")).toMatch(/display:\s*none/);
  });

  it("keeps the brand's own wrapper out of the stylesheet", () => {
    // `.navLeft` existed only to hold the logo and the links side by side. Left in
    // place it would either be an empty wrapper in the DOM or a dead rule, and
    // `max-width: 900px { .navLeft { gap } }` was the only thing that ever
    // referenced it.
    expect(css, "`.navLeft` is gone with the element it wrapped").not.toContain(".navLeft");
  });
});
