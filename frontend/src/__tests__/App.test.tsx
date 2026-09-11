import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import App from "../App.tsx";

describe("App", () => {
  it("renders the home page hero", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", {
        name: /Generate, execute, and evaluate AI-written code/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/See the demo/i)).toBeInTheDocument();
    expect(screen.getByText(/Everything you need to evaluate code/i)).toBeInTheDocument();
  });
});