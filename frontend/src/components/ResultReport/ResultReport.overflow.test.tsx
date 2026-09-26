/**
 * Containment of evaluation output (#234) — the fast, browserless half.
 *
 * `e2e/overflow.spec.ts` is the real proof: it renders a pathological result
 * and measures `scrollWidth` against `clientWidth` in a real browser, which is
 * the only way to know a box actually contains its content. This file covers
 * the two things a browser check would miss:
 *
 * 1. **The declarations themselves.** A future refactor that drops
 *    `overflow-wrap: anywhere` from a rule the e2e fixture happens not to
 *    exercise today would otherwise pass silently. Each rule below is
 *    mutation-checked: removing the declaration fails this file.
 * 2. **The DOM shape the styles attach to.** A `.testName` rule is worthless if
 *    nothing carries the class, so the component test renders the pathological
 *    payload and asserts the wrapping elements are the ones holding the long
 *    text.
 *
 * jsdom has no layout engine, so nothing here claims to measure overflow.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ResultReport from "./ResultReport";
import AttemptTimeline from "../AttemptTimeline/AttemptTimeline";
import reportStyles from "./ResultReport.module.css";
import timelineStyles from "../AttemptTimeline/AttemptTimeline.module.css";
import type { EvaluationAttempt, EvaluationResult } from "../../types.ts";

/** Read a rule's body out of a CSS module, or "" when the rule is absent. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  return match ? match[1] : "";
}

async function readReportCss(): Promise<string> {
  return (await import("./ResultReport.module.css?raw")).default;
}

async function readTimelineCss(): Promise<string> {
  return (await import("../AttemptTimeline/AttemptTimeline.module.css?raw")).default;
}

/** A token with no break opportunity, so it can only fit if the box breaks it. */
const UNBREAKABLE = "A".repeat(240);

function pathologicalResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    id: "r1",
    passed_tests: 0,
    total_tests: 2,
    score: 0,
    logs: `FAILED tests/test_math.py::test_two_sum_${UNBREAKABLE}`,
    logs_summary: `AssertionError: expected 3 == 4 at /tmp/${UNBREAKABLE}/solution.py`,
    metrics: { primary_error: `HTTPStatusError: 429 for ${UNBREAKABLE}` },
    test_results: [
      { name: `test_two_sum_${UNBREAKABLE}`, passed: false, message: UNBREAKABLE },
      { name: "test_ok", passed: true },
    ],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ResultReport overflow containment", () => {
  it("lets a long test name break mid-token", async () => {
    const css = await readReportCss();
    // `anywhere`, not `break-word`: only `anywhere` also reduces the item's
    // min-content width, which is what lets a flex row shrink at all.
    expect(ruleBody(css, ".testName")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("lets a long failure message break mid-token", async () => {
    const css = await readReportCss();
    expect(ruleBody(css, ".testMessage")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("lets a long summary token break while keeping its own line breaks", async () => {
    const css = await readReportCss();
    const body = ruleBody(css, ".summary");
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
    // pre-line is what preserves the one-entry-per-line failed-test list.
    expect(body).toMatch(/white-space:\s*pre-line/);
  });

  it("does not force the metric key onto one line", async () => {
    const css = await readReportCss();
    // A table cell cannot shrink below its content, so a nowrap key widens the
    // whole table past its card.
    expect(ruleBody(css, ".metricKey")).not.toMatch(/white-space:\s*nowrap/);
  });

  it("lets a long metric value break mid-token", async () => {
    const css = await readReportCss();
    expect(ruleBody(css, ".metricTable th,\n.metricTable td")).toMatch(
      /overflow-wrap:\s*anywhere/,
    );
  });

  it("applies the wrapping classes to the elements holding the long text", () => {
    render(
      <ResultReport
        result={pathologicalResult()}
        code="def two_sum(): ..."
        language="python"
        status="completed"
      />,
    );

    const name = screen.getByText(`test_two_sum_${UNBREAKABLE}`);
    expect(name.className).toBe(reportStyles.testName);

    const message = screen.getByText(UNBREAKABLE, { selector: "span" });
    expect(message.className).toBe(reportStyles.testMessage);

    expect(
      screen.getByText(/AssertionError: expected 3 == 4/).className,
    ).toBe(reportStyles.summary);
  });
});

describe("AttemptTimeline overflow containment", () => {
  const attempt: EvaluationAttempt = {
    id: "a1",
    attempt_number: 1,
    code: "def two_sum(): ...",
    passed_tests: 0,
    total_tests: 2,
    score: 0,
    logs: "FAILED",
    logs_summary: `AssertionError: expected 3 == 4 at /tmp/${UNBREAKABLE}`,
    metrics: {},
    test_results: [
      { name: `test_two_sum_${UNBREAKABLE}`, passed: false, message: UNBREAKABLE },
    ],
    created_at: "2026-01-01T00:00:00Z",
  };

  it("lets a long summary token break", async () => {
    const css = await readTimelineCss();
    const body = ruleBody(css, ".summary");
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(body).toMatch(/white-space:\s*pre-line/);
  });

  it("lets the per-test name and message break mid-token", async () => {
    const css = await readTimelineCss();
    expect(ruleBody(css, ".testName")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(ruleBody(css, ".testMessage")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("renders the long text inside the wrapping elements", () => {
    render(
      <AttemptTimeline
        attempts={[attempt]}
        currentAttempt={1}
        maxAttempts={2}
        language="python"
      />,
    );

    expect(
      screen.getByText(/AssertionError: expected 3 == 4/).className,
    ).toBe(timelineStyles.summary);
    expect(screen.getByText(`test_two_sum_${UNBREAKABLE}`).className).toBe(
      timelineStyles.testName,
    );
  });
});
