import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PageTitle from "./PageTitle.tsx";

/**
 * These tests cover the *contract* the shared title gives the 21 pages that use
 * it: one element, one treatment, and the size/variant knobs. The gradient
 * itself is CSS and is covered by `--gradient-title` in globals.css, which is
 * built from the per-theme primary tokens precisely so the treatment needs no
 * light-mode override.
 */
describe("PageTitle", () => {
  it("renders an h1 with the text as its content", () => {
    render(<PageTitle>Challenges</PageTitle>);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Challenges");
  });

  it("defaults to the app-page size step", () => {
    render(<PageTitle>Challenges</PageTitle>);
    const heading = screen.getByRole("heading", { level: 1 });
    // The md step is the shared default; a page must not silently change scale.
    expect(heading.className).toContain("md");
  });

  it.each([
    ["sm", "Welcome back"],
    ["md", "Challenges"],
    ["lg", "Features"],
  ] as const)("applies the %s size step", (size, text) => {
    render(<PageTitle size={size}>{text}</PageTitle>);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain(size);
  });

  it("keeps the page variant off the hero treatment by default", () => {
    render(<PageTitle>Features</PageTitle>);
    expect(screen.getByRole("heading", { level: 1 }).className).not.toContain("hero");
  });

  it("adds the hero treatment for the animated home headline", () => {
    render(
      <PageTitle variant="hero" size="lg">
        Generate, execute, and evaluate AI-written code
      </PageTitle>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("hero");
    expect(heading.className).toContain("lg");
  });

  it("merges a page className for layout without dropping the shared classes", () => {
    render(
      <PageTitle size="lg" className="page-module_title__abc123">
        Features
      </PageTitle>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.className).toContain("page-module_title__abc123");
    expect(heading.className).toContain("lg");
  });

  it("renders non-string children (challenge titles, usernames)", () => {
    render(<PageTitle>{"user".toUpperCase()}</PageTitle>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("USER");
  });
});
