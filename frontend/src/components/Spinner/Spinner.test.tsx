import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Spinner from "./Spinner.tsx";

describe("Spinner", () => {
  it("renders a status with the default label", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAccessibleName("Loading");
  });

  it("uses a custom accessible label", () => {
    render(<Spinner label="Submitting evaluation" />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Submitting evaluation",
    );
  });

  it("applies the lg size class", () => {
    render(<Spinner size="lg" />);
    expect(screen.getByRole("status").className).toContain("lg");
  });

  it("can be rendered as decorative (aria-hidden)", () => {
    const { container } = render(<Spinner ariaHidden />);
    const spinner = container.querySelector("span");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });
});