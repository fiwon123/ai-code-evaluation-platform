import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import App from "../App.tsx";

describe("App", () => {
  it("renders the home page", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /AI Code Evaluation Platform/i }),
    ).toBeInTheDocument();
  });
});
