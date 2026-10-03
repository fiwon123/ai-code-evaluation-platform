import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { scoreVariant } from "../../utils/formatting";
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
    // The value is the only in-ring text, vertically centered (no label).
    const value = screen.getByText("72%");
    expect(value).toBeInTheDocument();
    expect(value.getAttribute("dominant-baseline")).toBe("central");
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

  it.each([
    [0, "ringDanger", "danger"],
    [59, "ringDanger", "danger"],
    [60, "ringWarning", "warning"],
    [79, "ringWarning", "warning"],
    [80, "ringSuccess", "success"],
    [100, "ringSuccess", "success"],
  ])("paints the flat band for %i as %s, agreeing with scoreVariant", (value, variant, expected) => {
    render(<ScoreRing value={value} label="Flat bands" />);
    const arc = screen
      .getByRole("img", { name: `Flat bands ${value} / 100` })
      .querySelector(".ringProgress");
    expect(arc?.getAttribute("class")).toBe(`ringProgress ${variant}`);
    expect(scoreVariant(value)).toBe(expected);
  });

  it("sets the ring-size CSS var and draws the track + progress circles", () => {
    render(<ScoreRing value={45} label="Half" size={120} />);
    const ring = screen.getByRole("img", { name: "Half 45 / 100" });
    expect(ring.style.getPropertyValue("--ring-size")).toBe("120px");
    expect(ring.querySelector(".ringTrack")).toBeInTheDocument();
    const progress = ring.querySelector(".ringProgress");
    expect(progress).toBeInTheDocument();
    expect(progress?.getAttribute("stroke-dasharray")).not.toBe("");
    expect(progress?.getAttribute("stroke-linecap")).toBe("round");
  });

  it.each([
    [0, "ringScoreRed"],
    [33.3, "ringScoreRed"],
    [59, "ringScoreRed"],
    [60, "ringScoreOrange"],
    [66.7, "ringScoreOrange"],
    [74, "ringScoreOrange"],
    [75, "ringScoreYellow"],
    [79, "ringScoreYellow"],
    [80, "ringScoreGreen"],
    [100, "ringScoreGreen"],
  ])("paints the score scale band for %s as %s", (value, band) => {
    render(<ScoreRing value={value} label="Scale" scale />);
    // The aria-label rounds, the same way the ring's number does, so the two
    // thirds in the table above are asked for as 33 and 67.
    const shown = Math.round(value);
    const arc = screen.getByRole("img", { name: `Scale ${shown} / 100` }).querySelector(
      ".ringProgress",
    );
    // One band at a time, and only that band: the scale is four flat colours, not
    // a gradient, so an arc carrying two of them would be ambiguous about which
    // one the score means.
    expect(arc?.getAttribute("class")).toBe(`ringProgress ${band}`);
    expect(arc?.getAttribute("style"), "no inline paint server is left").toBeNull();
    expect(screen.getByRole("img").querySelector("linearGradient")).not.toBeInTheDocument();
  });

  it("steps the colour through the scale while the number counts", async () => {
    // The point of the prop (#389): the arc is not coloured for the final score
    // from the start — it moves red → orange → yellow → green *as* the count-up
    // runs, so the change lands on the number the reader is watching. A ring
    // that is already yellow at 0% would carry no information the count-up
    // does not.
    vi.useFakeTimers();
    try {
      render(<ScoreRing value={100} label="Live" animate scale delayMs={0} durationMs={1000} />);
      const ring = screen.getByRole("img", { name: "Live 100 / 100" });
      const arc = () => ring.querySelector(".ringProgress")!.getAttribute("class");
      const shown = () => ring.querySelector(".ringValue")!.textContent;

      expect(arc(), "the scale must start at its first band").toBe("ringProgress ringScoreRed");

      // Sample the run and record the band at each change, with the number that
      // caused it — the pairing is the claim, so it is what is asserted.
      const seen: Array<[string, string]> = [];
      for (let elapsed = 0; elapsed <= 1100; elapsed += 50) {
        act(() => {
          vi.advanceTimersByTime(50);
        });
        seen.push([arc()!, shown()!]);
      }

      const bands = [...new Set(seen.map(([cls]) => cls.replace("ringProgress ", "")))];
      expect(
        bands,
        `the arc only ever used ${bands.join(" → ")} across the run`,
      ).toEqual(["ringScoreRed", "ringScoreOrange", "ringScoreYellow", "ringScoreGreen"]);

      // Each band change must coincide with the number crossing its threshold,
      // and never happen while the number sits inside the previous band. The
      // bounds come from `scoreBand`, which `formatting.test.ts` pins; 59/60 and
      // 79/80 are the two boundaries worth pinning here as well, because an
      // off-by-one there shows a band change at a number that does not belong
      // to it — and 80 is the boundary that must agree with every score chip.
      const bandOf = (n: number) =>
        n < 60
          ? "ringScoreRed"
          : n < 75
            ? "ringScoreOrange"
            : n < 80
              ? "ringScoreYellow"
              : "ringScoreGreen";
      for (const [cls, number] of seen) {
        expect(cls).toBe(`ringProgress ${bandOf(Number.parseInt(number, 10))}`);
      }
      // And it settles on the final score's band.
      expect(seen.at(-1)).toEqual(["ringProgress ringScoreGreen", "100%"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("publishes the arc length of the score already on the ring", () => {
    // `--ring-arc-from` is how the fill continues instead of emptying: an offset
    // of `arc - from` leaves exactly `from` drawn. The Home hero's arc is a CSS
    // animation, and a keyframe cannot read a value out of a hook — so if this
    // variable is missing or wrong the ring rewinds to empty on every count and
    // the bug looks like a CSS problem rather than a missing datum.
    render(<ScoreRing value={67} label="Continuing" scale countFrom={33.3} />);
    const ring = screen.getByRole("img", { name: "Continuing 67 / 100" });
    const circumference = Number.parseFloat(
      ring.style.getPropertyValue("--ring-circumference"),
    );
    // 33.3 rounds to 33, because that is the number the digits show — an arc held
    // at 33.3 would be a third of a percent ahead of them for the whole repair.
    expect(ring.style.getPropertyValue("--ring-arc-from")).toBe(
      `${(33 / 100) * circumference}px`,
    );
    expect(ring.style.getPropertyValue("--ring-arc")).toBe(
      `${(67 / 100) * circumference}px`,
    );
  });

  it("defaults the arc's start to empty, so nothing is held without being asked", () => {
    // Every other consumer counts up from nothing, and the default has to be the
    // empty arc rather than "whatever was passed last" — a stale `from` on a ring
    // that is not counting would leave an arc that cannot be explained by its own
    // score.
    render(<ScoreRing value={67} label="Plain" scale />);
    const ring = screen.getByRole("img", { name: "Plain 67 / 100" });
    expect(ring.style.getPropertyValue("--ring-arc-from")).toBe("0px");
  });

  it("clamps `countFrom` the same way as the score", () => {
    render(<ScoreRing value={50} label="Out of range" countFrom={400} />);
    const ring = screen.getByRole("img", { name: "Out of range 50 / 100" });
    // Clamped to the whole circle, in the same unit: a `from` past the end would
    // make the calc below come out negative and draw past the start.
    expect(ring.style.getPropertyValue("--ring-arc-from")).toBe(
      ring.style.getPropertyValue("--ring-circumference"),
    );
    expect(ring.style.getPropertyValue("--ring-circumference")).toMatch(/px$/);
  });

  it("counts up from `countFrom` rather than from zero", async () => {
    // The Home hero climbs 33 → 67 → 100 (#389). A count-up that started from
    // zero here would read as three unrelated rings rather than one that gets
    // there, and the second segment would spend its whole first beat at 0%.
    vi.useFakeTimers();
    try {
      render(
        <ScoreRing
          value={67}
          label="Continuing"
          animate
          scale
          countFrom={33.3}
          delayMs={0}
          durationMs={1000}
        />,
      );
      const value = () => screen.getByRole("img").querySelector(".ringValue");
      expect(value()?.textContent, "it starts at the number already on screen").toBe(
        "33%",
      );
      act(() => {
        vi.advanceTimersByTime(400);
      });
      const midway = Number(value()?.textContent?.replace("%", ""));
      expect(midway).toBeGreaterThan(33);
      expect(midway).toBeLessThan(67);
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(value()?.textContent).toBe("67%");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the flat bands for consumers that do not opt into the scale", () => {
    render(<ScoreRing value={67} label="Flat" />);
    const ring = screen.getByRole("img", { name: "Flat 67 / 100" });
    expect(ring.querySelector(".ringProgress")?.getAttribute("class")).toBe(
      "ringProgress ringWarning",
    );
    expect(ring.querySelector(".ringScoreYellow")).not.toBeInTheDocument();
    expect(ring.querySelector("linearGradient")).not.toBeInTheDocument();
  });

  it("gives the flat bands the final score even when the number is still counting", () => {
    // The scale reads the *animated* value, and that is only safe because it is
    // opt-in. A flat consumer that animated its number would otherwise show a
    // "danger" arc beside a counting-up 95%, which is a regression for the
    // Demo and the report.
    vi.useFakeTimers();
    try {
      render(<ScoreRing value={95} label="Flat animated" animate delayMs={0} durationMs={1000} />);
      const ring = screen.getByRole("img", { name: "Flat animated 95 / 100" });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(ring.querySelector(".ringProgress")?.getAttribute("class")).toBe(
        "ringProgress ringSuccess",
      );
      expect(ring.querySelector(".ringValue")?.textContent).not.toBe("95%");
    } finally {
      vi.useRealTimers();
    }
  });
});
