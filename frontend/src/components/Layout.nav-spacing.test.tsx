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

import css from "./Layout.module.css?raw";
import styles from "./Layout.module.css";

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => ({ user: { username: "ada", email: "ada@example.com", is_admin: false }, logout: vi.fn() }),
}));

const { default: Layout } = await import("./Layout");

/** The body of a top-level rule (`.navRight { ... }`), brace-balanced. */
function ruleBody(stylesheet: string, selector: string): string {
  const start = stylesheet.indexOf(selector);
  expect(start, `selector ${selector} not found`).toBeGreaterThan(-1);
  const open = stylesheet.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < stylesheet.length; i += 1) {
    if (stylesheet[i] === "{") depth += 1;
    if (stylesheet[i] === "}") depth -= 1;
    if (depth === 0) return stylesheet.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after ${selector}`);
}

/** Every `@media` block whose condition contains `max-width`, keyed by condition. */
function mobileBlocks(stylesheet: string): { condition: string; body: string }[] {
  const blocks: { condition: string; body: string }[] = [];
  const pattern = /@media\s*\(max-width:\s*([^)]+)\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(stylesheet)) !== null) {
    const open = pattern.lastIndex - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < stylesheet.length; i += 1) {
      if (stylesheet[i] === "{") depth += 1;
      else if (stylesheet[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    blocks.push({ condition: match[1]!.trim(), body: stylesheet.slice(open + 1, end) });
    pattern.lastIndex = end;
  }
  return blocks;
}

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

  it("keeps the mobile header untouched", () => {
    // Below 768px the whole right cluster (toggle included) is replaced by the
    // hamburger, so the new spacing must not leak into that layout.
    const phone = mobileBlocks(css).find((block) => block.condition.startsWith("768px"));
    expect(phone, "the 768px media block not found").toBeDefined();
    expect(ruleBody(phone!.body, ".navRight")).toMatch(/display:\s*none/);
  });
});
