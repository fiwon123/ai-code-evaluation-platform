import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ScoreRing from "./ScoreRing";

function ScoreRingFixture() {
  return <ScoreRing value={72} label="Average score" />;
}

describe("ScoreRing", () => {
  it("renders the SVG ring with the score label and value", () => {
    render(<ScoreRingFixture />);
    expect(
      screen.getByRole("img", { name: "Average score 72 / 100" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Average score")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("clamps the value into the 0–100 range", () => {
    render(<ScoreRing value={-5} label="Under" />);
    expect(
      screen.getByRole("img", { name: "Under 0 / 100" }),
    ).toBeInTheDocument();

    render(<ScoreRing value={120} label="Over" />);
    expect(
      screen.getByRole("img", { name: "Over 100 / 100" }),
    ).toBeInTheDocument();
  });

  it("shows the danger variant for low scores", () => {
    render(<ScoreRing value={25} label="Dangerous" />);
    const ring = screen.getByRole("img", { name: "Dangerous 25 / 100" });
    expect(ring).toBeInTheDocument();
    expect(ring.querySelector(".ringDanger")).toBeInTheDocument();
  });

  it("shows the success variant for high scores", () => {
    render(<ScoreRing value={88} label="Great" />);
    const ring = screen.getByRole("img", { name: "Great 88 / 100" });
    expect(ring.querySelector(".ringSuccess")).toBeInTheDocument();
  });
});
