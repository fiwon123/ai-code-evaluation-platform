import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Footer from "./Footer.tsx";

describe("Footer", () => {
  it("renders product and company navigation links", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Features" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pricing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contact" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up" })).toBeInTheDocument();
  });

  it("renders a Legal column linking to every legal page", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Legal" })).toBeInTheDocument();
    // Asserted as hrefs, not just labels: a legal link with the right text
    // pointed at the wrong route is the failure this column exists to prevent.
    for (const [label, href] of [
      ["Privacy Policy", "/privacy"],
      ["Terms of Service", "/terms"],
      ["Security", "/security"],
      ["GDPR", "/gdpr"],
    ] as const) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("links to the GitHub repository", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "GitHub repository" })).toHaveAttribute(
      "href",
      "https://github.com/fiwon123/ai-code-evaluation-platform",
    );
  });

  it("shows the current year in the copyright", () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(new RegExp(`© ${new Date().getFullYear()}`)),
    ).toBeInTheDocument();
  });
});