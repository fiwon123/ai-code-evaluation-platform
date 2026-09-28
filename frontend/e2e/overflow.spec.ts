import { expect, test, type Page } from "@playwright/test";
import {
  completedSubmission,
  failedAttempt,
  mockAuthenticatedSubmission,
  mockSubmissionSocket,
  processingSubmission,
  terminalMessage,
  type WireAttempt,
  type WireSubmission,
} from "./helpers/socket";

/**
 * Browser-level containment for evaluation output (#234).
 *
 * The component tests assert *which* CSS rules exist; only a real browser can
 * tell you whether the result actually stayed inside its card. jsdom has no
 * layout engine, so "the row has `flex-wrap: wrap`" is a claim about the
 * stylesheet, not about what a reader sees. These specs render a deliberately
 * pathological result and measure `scrollWidth` against `clientWidth`.
 *
 * The fixture is the point: a real suite produced the shapes here —
 *
 * * a parametrized test name with a long `[...]` payload (pytest, Go table
 *   tests, JUnit display names),
 * * a failure summary carrying a filesystem path and an object repr with no
 *   spaces to break at,
 * * a metric key and a metric value that are each one long unbreakable token
 *   (the primary-provider error from #233 is exactly this shape).
 *
 * Nothing is mocked beyond the API: the socket helper intercepts `/api`, so the
 * suite still needs no backend.
 */

const SUBMISSION_ID = "e2e-submission-overflow";

/**
 * A token with no break opportunity — the thing that overflows everything.
 *
 * Plain ASCII letters on purpose: a name like `test_x[…]` has a break
 * opportunity at the bracket, so it wraps *without* `overflow-wrap` and would
 * make the whole fixture prove nothing. A run of letters cannot break anywhere,
 * so the only way it fits is if the box is allowed to break mid-token.
 */
const UNBREAKABLE = "A".repeat(240);
const LONG_PATH = `/tmp/evaluations/${"nested-directory/".repeat(8)}solution.py`;

/**
 * The worst case the report can be handed: long name, long message, long
 * summary token, long metric key, long metric value.
 */
function pathologicalSubmission(id: string) {
  const wire = completedSubmission(id);
  return {
    ...wire,
    evaluation_result: {
      ...wire.evaluation_result!,
      logs_summary: `AssertionError: expected 3 == 4 at ${LONG_PATH}\n${UNBREAKABLE}`,
      metrics: {
        duration_ms: 412,
        primary_error: `HTTPStatusError: 429 rate_limit_exceeded for request ${UNBREAKABLE}`,
        [`${"very_long_metric_key_".repeat(12)}suffix`]: UNBREAKABLE,
      },
      test_results: [
        { name: `test_two_sum_${UNBREAKABLE}`, passed: false, message: UNBREAKABLE },
        { name: "test_ok", passed: true },
      ],
    },
  };
}

/**
 * The same pathology, but on a *repaired* run: the repair timeline only renders
 * with two or more attempts, so it has its own copy of the summary and per-test
 * rows and its own overflow risk.
 */
function pathologicalRepaired(id: string) {
  const wire = completedSubmission(id);
  const first: WireAttempt = {
    ...failedAttempt(),
    logs_summary: `AssertionError: expected 3 == 4 at ${LONG_PATH}\n${UNBREAKABLE}`,
    test_results: [
      { name: `test_two_sum_${UNBREAKABLE}`, passed: false, message: UNBREAKABLE },
      { name: "test_ok", passed: true },
    ],
  };
  return {
    ...wire,
    attempts: [
      first,
      {
        ...first,
        id: "a-e2e-2",
        attempt_number: 2,
        passed_tests: 2,
        total_tests: 2,
        score: 100,
        logs_summary: wire.evaluation_result!.logs_summary,
      },
    ],
  };
}

/** The per-test list, located by its accessible name (it has no text of its own). */
const testBreakdown = (page: Page) =>
  page.getByRole("list", { name: "Per-test breakdown" });

/**
 * Any element wider than its parent means the page grew a horizontal scrollbar.
 * `+ 1` absorbs sub-pixel rounding, which is not a layout bug.
 */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > docWidth + 1) {
      out.push(`document (scrollWidth ${document.documentElement.scrollWidth} > ${docWidth})`);
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      // The raw log block is *meant* to be a scroller; a wide child inside it
      // is contained by that scroller rather than widening the page.
      if (el.closest("pre")) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        out.push(
          `${el.tagName.toLowerCase()}.${el.className || "(no class)"} ` +
            `(${el.scrollWidth} > ${el.clientWidth})`,
        );
      }
    }
    return out;
  });
}

test.describe("Result output stays inside its box", () => {
  test("a pathological result widens neither the page nor any card", async ({ page }) => {
    const api = await mockAuthenticatedSubmission(page, pathologicalSubmission(SUBMISSION_ID) as never);
    await page.goto(`/submissions/${SUBMISSION_ID}`);

    // The report is on screen: the containment claims are about rendered output,
    // and an empty page would pass the measurement trivially.
    await expect(testBreakdown(page)).toBeVisible();
    // The metrics table carries the long value too, so a wide table would show
    // up here as well as in the measurement below.
    await expect(page.getByRole("heading", { name: "Metrics" })).toBeVisible();
    await expect(page.getByText(UNBREAKABLE).first()).toBeVisible();

    expect(await overflowingElements(page)).toEqual([]);
    // And the content really is on screen — this is the fixture working, not a
    // blank report that happens to measure zero.
    expect(await page.getByText(/AssertionError/).count()).toBeGreaterThan(0);
    expect(api.calls()).toBeGreaterThan(0);
  });

  test("a long status stays in the Status card when fonts run wide", async ({ page }) => {
    // CI caught this where the sandbox cannot: the runner's font metrics render
    // "completed" ~16px wider than the dev image's, so the word exceeded its
    // stat column and pushed every card past the page. Font metrics are never
    // the sandbox's, so the breaker has to be an *unbreakable token* that is
    // renderer-independent: `CCC…` is long enough to exceed the ~126px column
    // on any font scale, and short enough that the header Badge (a much smaller
    // type size) is never involved — the CI failure was the stat card alone.
    await mockAuthenticatedSubmission(page, {
      ...pathologicalSubmission(SUBMISSION_ID),
      status: "CCC".repeat(4),
    } as never);
    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await expect(testBreakdown(page)).toBeVisible();

    expect(await overflowingElements(page)).toEqual([]);
  });

  test("a long test name wraps instead of stretching its row", async ({ page }) => {
    await mockAuthenticatedSubmission(page, pathologicalSubmission(SUBMISSION_ID) as never);
    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await expect(testBreakdown(page)).toBeVisible();

    // The name is a single unbreakable token: it can only fit if it breaks
    // mid-token, so a multi-line box proves the wrap rather than a lucky break.
    const nameBox = await page
      .getByText(`test_two_sum_${UNBREAKABLE}`)
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(nameBox).toBeGreaterThan(40);

    expect(await overflowingElements(page)).toEqual([]);
  });

  test("the repair timeline stays inside its box too", async ({ page }) => {
    // A separate component with its own copy of the summary and per-test rows,
    // and it only renders once a run has two or more attempts.
    //
    // The socket's terminal frame has to carry the pathological attempts as
    // well: it replaces the REST payload's `attempts`, so a fixture that only
    // patched the REST response would measure the helper's pristine attempts.
    const wire = pathologicalRepaired(SUBMISSION_ID);
    const api = await mockAuthenticatedSubmission(
      page,
      processingSubmission(SUBMISSION_ID),
    );
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(terminalMessage(wire as WireSubmission));
      // The page re-fetches the record whenever the socket state changes, so
      // REST has to agree with the frame or the page falls back to processing.
      api.setResponse(wire as WireSubmission);
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    await expect(page.getByRole("list", { name: "Repair attempts" })).toBeVisible();

    // Both attempts, expanded, so every summary and test row is measured.
    for (const disclosure of await page.getByText("Code, tests and raw logs").all()) {
      await disclosure.click();
    }
    await expect(page.getByText(/AssertionError/).first()).toBeVisible();
    // The pathological test name is really on screen — otherwise the
    // measurement below would be about pristine attempts again.
    await expect(page.getByText(`test_two_sum_${UNBREAKABLE}`).first()).toBeVisible();

    expect(await overflowingElements(page)).toEqual([]);
  });

  test("the raw log scroller is allowed to be wide, the page is not", async ({ page }) => {
    await mockAuthenticatedSubmission(page, pathologicalSubmission(SUBMISSION_ID) as never);
    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await page.getByText(/Show raw output/).click();

    // CodeBlock already wraps its own content; the point of this case is that
    // a wide log does not leak that width back to the document.
    expect(await overflowingElements(page)).toEqual([]);
    const docWidth = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(docWidth + 1);
  });
});
