import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Logo from "./Logo.tsx";

describe("Logo", () => {
  it("renders the wordmark by default", () => {
    const { container } = render(<Logo />);
    expect(container.textContent).toMatch(/AICodeEval/);
  });

  it("hides the wordmark when showText is false", () => {
    const { container } = render(<Logo showText={false} />);
    expect(container.textContent).not.toMatch(/AICodeEval/);
  });

  it("applies the requested size class", () => {
    const { container } = render(<Logo size="sm" />);
    expect(container.querySelector("span")?.className).toContain("sm");
  });
});