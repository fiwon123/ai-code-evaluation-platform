import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import NotFound from "../NotFound.tsx";

function renderNotFound() {
  return render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
}

describe("NotFound", () => {
  it("shows a 404 message", () => {
    renderNotFound();
    expect(screen.getByRole("heading", { name: /404/i })).toBeInTheDocument();
    expect(
      screen.getByText(/the page you're looking for doesn't exist/i),
    ).toBeInTheDocument();
  });

  // The 404 was a bare `<div>` with no class, no shell and no gutter, so it had
  // no page rhythm and the page-rhythm lock could not see it. It now has a real
  // `.page` shell, and it is the one page a user reaches by following a dead
  // link — so it has to offer a way out.
  it("offers a way back into the app", () => {
    renderNotFound();
    expect(screen.getByRole("link", { name: /browse challenges/i })).toHaveAttribute(
      "href",
      "/challenges",
    );
    expect(screen.getByRole("link", { name: /back to home/i })).toHaveAttribute("href", "/");
  });

  // A dead end is the one place a `<Link><Button>` nesting is least forgivable:
  // it would be two focus stops for one action, on the page a keyboard user
  // lands on when something has already gone wrong.
  it("keeps each action a single focus stop", () => {
    renderNotFound();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.querySelector("button")).toBeNull();
    }
  });
});
