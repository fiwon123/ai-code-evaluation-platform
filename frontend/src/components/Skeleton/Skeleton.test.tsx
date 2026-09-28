import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Skeleton from "./Skeleton.tsx";

describe("Skeleton", () => {
  it("renders with the default text variant", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild?.className).toContain("text");
  });

  it("applies variant and inline size styles", () => {
    const { container } = render(
      <Skeleton variant="circle" width={48} height="2rem" />,
    );
    const skeleton = container.firstElementChild;
    expect(skeleton?.className).toContain("circle");
    expect(skeleton).toHaveStyle({ width: "48px", height: "32px" });
  });

  it("exposes a status role when an accessible label is provided", () => {
    render(<Skeleton label="Loading challenges" />);
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Loading challenges",
    );
  });
});