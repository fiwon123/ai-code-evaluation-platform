import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ComparisonMark from "./ComparisonMark.tsx";

describe("ComparisonMark", () => {
  it("renders text values unchanged", () => {
    render(<ComparisonMark value="Unlimited" />);
    expect(screen.getByText("Unlimited")).toBeTruthy();
  });

  it("gives an included cell the accessible name 'Included'", () => {
    const { container } = render(<ComparisonMark value />);
    // The SVG is aria-hidden, so the name comes from the visually-hidden text.
    // A cell whose only content were the glyph would be announced as empty.
    expect(container.textContent).toBe("Included");
  });

  it("gives a not-included cell the accessible name 'Not included'", () => {
    const { container } = render(<ComparisonMark value={false} />);
    expect(container.textContent).toBe("Not included");
  });

  it("hides the glyph from assistive tech", () => {
    const { container } = render(<ComparisonMark value />);
    const svg = container.querySelector("svg")!;
    // Decorative, so it must not be announced — the text beside it carries the
    // meaning. Without this the screen reader reads "check mark Included".
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    // `role="presentation"` + `focusable="false"`: the second stops IE/Edge
    // from putting the SVG in the tab order.
    expect(svg.getAttribute("role")).toBe("presentation");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("draws a check for true and a cross for false", () => {
    const yes = render(<ComparisonMark value />).container;
    const no = render(<ComparisonMark value={false} />).container;
    const yesPath = yes.querySelector("path")!;
    const noPath = no.querySelector("path")!;

    // One path each, so the two marks are the same element with the same stroke
    // weight and read as the same size in a column.
    expect(yes.querySelectorAll("path")).toHaveLength(1);
    expect(no.querySelectorAll("path")).toHaveLength(1);
    expect(yesPath.getAttribute("d")).not.toBe(noPath.getAttribute("d"));
  });

  it("colours the two marks differently", () => {
    const yes = render(<ComparisonMark value />).container;
    const no = render(<ComparisonMark value={false} />).container;
    // Distinct classes, because colour is the fast channel for a table whose
    // job is scanning which rows differ between tiers.
    //
    // `getAttribute`, not `.className`: on an <svg> the IDL attribute is an
    // `SVGAnimatedString`, not a string, so `toContain` would be asserting
    // against the wrong object entirely.
    expect(yes.querySelector("svg")!.getAttribute("class")).toContain("yes");
    expect(no.querySelector("svg")!.getAttribute("class")).toContain("no");
  });
});
