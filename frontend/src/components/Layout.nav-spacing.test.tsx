/**
 * The header theme toggle needs breathing room on **both** sides.
 *
 * `.navRight` is a flex row whose first child is the toggle, followed by either
 * the avatar chip or the Log in / Sign up buttons. `.navRight` had no `gap`, so
 * the toggle touched that neighbour; on the left it inherited only `.nav`'s
 * minimum gap (#232).
 *
 * A CSS assertion alone would pass even if the toggle stopped being a child of
 * `.navRight` (a flex `gap` only separates *siblings*). So this checks the
 * structure too: the toggle must be a child of the `.navRight` element and the
 * first one, otherwise the gap does nothing. Reverting the CSS gap, or moving
 * the toggle out of `.navRight`, each fail here.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { maxWidthMediaBlocks, ruleBody } from "../test/cssRules";
import css from "./Layout.module.css?raw";
import styles from "./Layout.module.css";

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => ({ user: { username: "ada", email: "ada@example.com", is_admin: false }, logout: vi.fn() }),
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

describe("header theme toggle spacing (#232)", () => {
  it("separates the toggle from the auth controls with a flex gap", () => {
    const navRight = ruleBody(css, ".navRight");
    const gap = navRight.match(/gap:\s*([^;]+);/);
    expect(gap, "`.navRight` needs a `gap` or the toggle touches the avatar chip").not.toBeNull();
    expect(
      gap![1]!.trim(),
      "a `gap: 0` would keep the original bug",
    ).not.toMatch(/^0(px|rem|em)?$/);
  });

  it("adds margin on the nav-link side too", () => {
    const navRight = ruleBody(css, ".navRight");
    expect(
      /margin-left:\s*(?!0(px|rem|em)?;)/.test(navRight),
      "`.navRight` needs a left margin so the toggle does not hug the nav links",
    ).toBe(true);
  });

  it("renders the toggle as the first child of the .navRight element", () => {
    const { container } = renderLayout();
    const navRight = container.querySelector(`.${styles.navRight}`);
    expect(navRight, "the .navRight element was not rendered").not.toBeNull();

    const toggle = screen.getByRole("button", { name: /switch to|theme/i });
    expect(
      navRight!.firstElementChild,
      "the toggle must be a direct child of .navRight — a flex gap only separates siblings",
    ).toBe(toggle);
    // And something must follow it, otherwise the gap has no visible effect.
    expect(navRight!.children.length).toBeGreaterThan(1);
  });

  it("keeps the collapsed header untouched", () => {
    // Where the right cluster (toggle included) is replaced by the hamburger, the
    // spacing must not leak into that layout. The cutoff used to be 768px and
    // moved to 1023px in #400: above it `.nav` is a three-track grid centring the
    // links, which needs 971px to fit, so 769-1023px has to collapse with the rest
    // of the phone layout — it is also the band where the links used to overlap
    // these very controls. This assertion is what keeps that move deliberate.
    const collapsed = maxWidthMediaBlocks(css).find((block) => block.condition === "1023px");
    expect(collapsed, "the 1023px media block not found").toBeDefined();
    expect(ruleBody(collapsed!.body, ".navRight")).toMatch(/display:\s*none/);
  });
});
