import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultReport from "./ResultReport";
import codeBlockStyles from "../CodeBlock/CodeBlock.module.css";
import type { EvaluationResult } from "../../types.ts";

const LOGS = ["tests/test_math.py::test_add PASSED   [100%]", "FAILED tests/test_math.py::test_sub"].join(
  "\n",
);

function result(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id: "r1",
    passed_tests: 1,
    total_tests: 2,
    score: 50,
    logs: LOGS,
    metrics: {},
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * The log view is opt-in per call site, so the wiring is the thing that can rot:
 * a dropped `log` prop would silently leave every report a wall of plain text
 * and no unit test of CodeBlock alone would notice.
 */
describe("ResultReport log rendering", () => {
  it("numbers and tints the execution logs", () => {
    const { container } = render(
      <ResultReport result={result()} code={null} language="python" />,
    );

    expect(screen.getByText(/raw output/i)).toBeInTheDocument();
    const numbers = [...container.querySelectorAll(`.${codeBlockStyles.lineNumber}`)].map(
      (el) => el.textContent,
    );
    expect(numbers).toEqual(["1", "2"]);

    const failed = [...container.querySelectorAll(`.${codeBlockStyles.line}`)].find((row) =>
      row.textContent?.includes("FAILED"),
    );
    expect(failed?.className).toContain(codeBlockStyles.lineError);
  });

  it("leaves generated source as a plain code block", () => {
    // Same component, two surfaces: severity tints and a gutter on generated
    // code would be misleading (a "FAIL" in a docstring is not a failed test).
    const { container } = render(
      <ResultReport
        result={result()}
        code={'def subtract(a, b):\n    """FAIL when wrong"""\n    return a - b'}
        language="python"
      />,
    );

    expect(screen.getByText("solution.py")).toBeInTheDocument();
    const codeGutter = [...container.querySelectorAll(`.${codeBlockStyles.lineNumber}`)];
    expect(codeGutter).toHaveLength(2); // the two log lines only
    expect(container.querySelectorAll(`.${codeBlockStyles.lineError}`)).toHaveLength(1);
  });
});

/**
 * The complaint that motivated v0.14: the runner dump was the only failure
 * output on the page, and it is unreadable. The summary leads; the dump is one
 * click away. These pin that split, including the legacy case where a report
 * predates summaries and has nothing to lead with.
 */
describe("ResultReport readable summary", () => {
  it("leads with the summary instead of the raw dump", () => {
    render(
      <ResultReport
        result={result({
          logs_summary: "1 of 2 tests passed (score 50.0%)\nFailed tests (1):\n- test_sub",
        })}
        code={null}
        language="python"
      />,
    );

    expect(
      screen.getByText(/1 of 2 tests passed/),
    ).toBeInTheDocument();
  });

  it("keeps the raw dump collapsed behind a disclosure", () => {
    render(
      <ResultReport
        result={result({ logs_summary: "1 of 2 tests passed (score 50.0%)" })}
        code={null}
        language="python"
      />,
    );

    const disclosure = screen.getByText(/show raw output/i).closest("details");
    expect(disclosure).not.toBeNull();
    // Closed by default: the log body must not be visible without a click.
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("still renders a report whose summary is missing", () => {
    // Results written before v0.14 have no summary column value. The card has
    // to degrade to a pointer at the raw logs, not render an empty heading.
    render(<ResultReport result={result()} code={null} language="python" />);

    expect(screen.getByText(/no summary was recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/show raw output/i)).toBeInTheDocument();
  });
});
