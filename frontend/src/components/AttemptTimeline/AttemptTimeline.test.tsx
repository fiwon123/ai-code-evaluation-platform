import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AttemptTimeline from "./AttemptTimeline";
import type { EvaluationAttempt } from "../../types.ts";

function attempt(n: number, overrides: Partial<EvaluationAttempt> = {}): EvaluationAttempt {
  return {
    id: `a${n}`,
    attempt_number: n,
    code: `def attempt_${n}():\n    pass`,
    passed_tests: 1,
    total_tests: 2,
    score: 50,
    logs: `FAILED attempt ${n}`,
    logs_summary: `1 of 2 tests passed (score 50.0%)\nFailed tests (1):\n- test_sub`,
    metrics: {},
    test_results: [{ name: "test_sub", passed: false, message: "assert None" }],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A green attempt — the repair worked. */
function passingAttempt(n: number): EvaluationAttempt {
  return attempt(n, {
    passed_tests: 2,
    score: 100,
    logs: "2 passed",
    logs_summary: "2 of 2 tests passed (score 100.0%)",
    test_results: [{ name: "test_sub", passed: true, message: "" }],
  });
}

describe("AttemptTimeline", () => {
  it("renders nothing when there is no history", () => {
    // A run that passed on the first attempt must look exactly as it did
    // before v0.14 — no empty card, no stray heading.
    const { container } = render(
      <AttemptTimeline attempts={[]} maxAttempts={3} language="python" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("labels each attempt against the repair budget", () => {
    render(
      <AttemptTimeline
        attempts={[attempt(1), passingAttempt(2)]}
        maxAttempts={3}
        language="python"
      />,
    );

    expect(screen.getByText("Attempt 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Attempt 2 of 3")).toBeInTheDocument();
  });

  it("omits the budget when repairs are disabled", () => {
    // max_attempts=1 means the feature is off; "of 1" would be noise.
    render(<AttemptTimeline attempts={[attempt(1)]} maxAttempts={1} language="python" />);
    expect(screen.getByText("Attempt 1")).toBeInTheDocument();
  });

  it("shows why each attempt failed without opening anything", () => {
    // The summary is the whole point: the readable reason is on the row, and
    // the per-test list stays behind the closed disclosure.
    render(<AttemptTimeline attempts={[attempt(1)]} maxAttempts={3} language="python" />);

    expect(screen.getByText(/1 of 2 tests passed/)).toBeInTheDocument();
    expect(screen.getByText(/Failed tests \(1\)/)).toBeInTheDocument();

    const disclosure = screen.getByText(/code, tests and raw logs/i).closest("details");
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("hides code and raw logs behind a closed disclosure", () => {
    render(<AttemptTimeline attempts={[attempt(1)]} maxAttempts={3} language="python" />);

    const disclosure = screen.getByText(/code, tests and raw logs/i).closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    // Still in the DOM (a real <details>), but not the default view.
    expect(within(disclosure as HTMLElement).getByText(/def attempt_1/)).toBeInTheDocument();
  });

  it("marks the attempt the report was built from", () => {
    render(
      <AttemptTimeline
        attempts={[attempt(1), passingAttempt(2)]}
        maxAttempts={3}
        language="python"
        currentAttempt={2}
      />,
    );

    expect(screen.getByText("Final")).toBeInTheDocument();
    expect(screen.queryByText("Latest")).not.toBeInTheDocument();
  });

  it("marks a still-failing last attempt as latest rather than final", () => {
    render(
      <AttemptTimeline
        attempts={[attempt(1), attempt(2)]}
        maxAttempts={3}
        language="python"
        currentAttempt={2}
      />,
    );

    expect(screen.getByText("Latest")).toBeInTheDocument();
  });
});
