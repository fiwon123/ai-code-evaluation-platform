import { render, screen } from "@testing-library/react";
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
      await screen.findByRole("heading", {
        name: /Generate, execute, and evaluate AI-written code/i,
      }),
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
      await screen.findByRole("heading", { name: /Welcome back/i }),
    ).toBeInTheDocument();
  });
});