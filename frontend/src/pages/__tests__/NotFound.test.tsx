import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "../NotFound.tsx";

describe("NotFound", () => {
  it("shows a 404 message", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", { name: /404/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the page you're looking for doesn't exist/i),
    ).toBeInTheDocument();
  });
});