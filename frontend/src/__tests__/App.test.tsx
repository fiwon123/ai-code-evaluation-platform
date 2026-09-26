import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import App from "../App.tsx";

describe("App", () => {
  it("renders the home page hero", async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole(
        "heading",
        { name: /Generate, execute, and evaluate AI-written code/i },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/See the demo/i)).toBeInTheDocument();
    expect(screen.getByText(/Everything you need to evaluate code/i)).toBeInTheDocument();
  });

  it("lazy-loads a nested route like the login page", async () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole(
        "heading",
        { name: /Welcome back/i },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
  });

  // The legal pages are tested directly in pages/Legal/legal.test.tsx. What
  // that cannot catch is a route that was never wired up — the link in the
  // footer would 404 into NotFound. Each case asserts the real document
  // heading, not just "something rendered".
  it.each([
    ["/privacy", /Privacy Policy/i],
    ["/terms", /Terms of Service/i],
    ["/security", /^Security$/i],
    ["/gdpr", /GDPR & Data Protection/i],
  ])("routes %s to its legal page", async (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: heading }, { timeout: 5000 }),
    ).toBeInTheDocument();
    // Guard against a silent fall through to the 404 page.
    expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
  });

  it("exposes a legal link in the footer for every legal page", async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    const footer = await screen.findByRole("contentinfo");
    for (const label of ["Privacy Policy", "Terms of Service", "Security", "GDPR"]) {
      expect(within(footer).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});
