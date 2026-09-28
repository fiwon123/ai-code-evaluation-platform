import { expect, test, type Page } from "@playwright/test";
import { API_BASE } from "./data";
import {
  completedSubmission,
  failedSubmission,
  mockAuthenticatedSubmission,
  mockSubmissionSocket,
  processingSubmission,
  recordlessTerminalMessage,
  repairedSubmission,
  repairingMessage,
  repairingSubmission,
  snapshotMessage,
  statusMessage,
  terminalMessage,
  type WireSubmission,
} from "./helpers/socket";

/**
 * Browser-level coverage for the evaluation WebSocket (#212).
 *
 * #190 made a terminal update carry the whole persisted record, so the report
 * renders on the message that ends the run instead of a second REST round-trip.
 * The component tests drive a hand-rolled fake socket, so they cannot reach what
 * only shows up in a real browser: the handshake, the URL the client builds, JSON
 * surviving the round trip, a reconnect, and the fallback when a record never
 * arrives.
 *
 * Only the frames are mocked — every `/api` request is still intercepted (see
 * `helpers/socket.ts`), so the suite needs no backend.
 *
 * Note on connection counts: React StrictMode double-invokes effects in dev, so
 * mounting the page opens two connections, the first of which the hook closes
 * again. These tests therefore compare connection counts before/after rather
 * than asserting absolute numbers.
 */

const SUBMISSION_ID = "e2e-submission-ws";
const processing = (): WireSubmission => processingSubmission(SUBMISSION_ID);
const completed = (): WireSubmission => completedSubmission(SUBMISSION_ID);
const repairing = (): WireSubmission => repairingSubmission(SUBMISSION_ID);
const repaired = (): WireSubmission => repairedSubmission(SUBMISSION_ID);

/**
 * The status badge in the page header. The word "completed" also shows up in the
 * report's stat block, so a bare `getByText` is ambiguous — pin it to the span.
 */
const completedBadge = (page: Page) =>
  page.locator("span").filter({ hasText: /^completed$/ });

test.describe("Evaluation WebSocket", () => {
  test("renders the report from the terminal message, with no extra fetch", async ({
    page,
  }) => {
    const api = await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      // The connect-time snapshot, as the handler sends it today.
      ws.send(snapshotMessage(processing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);

    // The phase from the socket renders (the REST record says the same thing, so
    // this is the smoke check that the page is live and past its skeleton).
    await expect(page.getByText(/Running tests/)).toBeVisible();

    // The page re-runs its load whenever the socket state changes, so the count
    // is not a fixed number: only the delta across the terminal message means
    // anything.
    const fetchesBefore = api.calls();

    socket.send(terminalMessage(completed()));

    // Everything the record carried, rendered on the message that ended the run.
    await expect(page.getByLabel("Score 100 percent")).toBeVisible();
    await expect(completedBadge(page)).toBeVisible();
    await expect(page.getByText("Generated code")).toBeVisible();
    await expect(page.locator("pre").filter({ hasText: "def two_sum" })).toBeVisible();
    await expect(page.getByLabel("Execution log")).toContainText("test_add PASSED");
    await expect(page.getByLabel("Per-test breakdown")).toBeVisible();

    // The point of the whole feature: the record arrived over the socket, so
    // nothing was re-fetched to render it.
    expect(api.calls()).toBe(fetchesBefore);
  });

  test("dials the API host, not the page origin, and carries the token", async ({ page }) => {
    await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(processing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);

    // A real handshake, so a wrong path or query would never have matched the
    // route above and this would be empty. The socket deliberately points at the
    // API host rather than the page origin: the dev server serves the SPA and has
    // no `/ws` endpoint, so "just use the origin" would look fine locally and
    // break in every real deployment.
    const [url] = socket.urls();
    expect(url).toBe(
      `ws://localhost:8000/api/ws/submissions/${SUBMISSION_ID}` +
        `?token=${encodeURIComponent("e2e-test-jwt-token")}`,
    );
    expect(url.startsWith(API_BASE.replace(/^http/, "ws"))).toBe(true);
    expect(new URL(url).port).not.toBe(new URL(page.url()).port || "");
  });

  test("a record after a reconnect does not duplicate or reorder output", async ({
    page,
  }) => {
    const api = await mockAuthenticatedSubmission(page, processing());
    // What the server sends on connect. Moved to the finished record below, so
    // the reconnect re-snapshots a submission that is already done.
    let onConnectRecord = processing();
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(onConnectRecord));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    await expect(page.getByText(/Running tests/)).toBeVisible();

    socket.send(terminalMessage(completed()));
    await expect(page.getByLabel("Score 100 percent")).toBeVisible();
    const fetchesBefore = api.calls();

    // Drop the connection the way a proxy hiccup would. The hook backs off ~1s
    // and reconnects, and the new connection re-snapshots the same record. The
    // REST endpoint is switched to the finished record too, because that is what
    // a real server returns once the run is committed — leaving it on the
    // in-flight record would make the fallback reload fight the snapshot and
    // assert a disagreement the platform never has.
    api.setResponse(completed());
    onConnectRecord = completed();
    const connectionsBefore = socket.connections();
    await socket.closeFromServer();
    await expect
      .poll(() => socket.connections(), { message: "reconnect" })
      .toBeGreaterThan(connectionsBefore);

    // Output must be unchanged: not doubled, and not rolled back to the
    // in-flight state the snapshot originally described.
    await expect(page.getByLabel("Score 100 percent")).toHaveCount(1);
    await expect(page.locator("pre").filter({ hasText: "def two_sum" })).toHaveCount(1);
    await expect(completedBadge(page)).toBeVisible();
    await expect(page.getByText(/Running tests/)).toHaveCount(0);
    // A reconnect legitimately reloads over REST, so the meaningful check is
    // that the report is not assembled twice — asserted by the counts above.
    expect(api.calls()).toBeGreaterThanOrEqual(fetchesBefore);
  });

  test("a terminal record with no result falls back to REST by the id on the wire", async ({
    page,
  }) => {
    const api = await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(processing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    await expect(page.getByText(/Running tests/)).toBeVisible();

    // A failed run: the record arrives, but it has no `evaluation_result` to
    // render, so the page fetches the full row — using the id that came off the
    // wire, not one it re-derives.
    api.setResponse(completed());
    const pathsBefore = api.paths().length;
    socket.send(terminalMessage(failedSubmission(SUBMISSION_ID)));

    await expect(page.getByLabel("Score 100 percent")).toBeVisible();
    expect(api.paths().slice(pathsBefore)).toEqual([`/api/submissions/${SUBMISSION_ID}`]);
  });

  test("a terminal message with no record at all still falls back to REST", async ({
    page,
  }) => {
    const api = await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(processing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    await expect(page.getByText(/Running tests/)).toBeVisible();

    // The record never arrived: a partial sequence, an older server, or a
    // reconnect that missed the terminal event. The safety net has to carry the
    // page on its own.
    api.setResponse(completed());
    const fetchesBefore = api.calls();
    socket.send(recordlessTerminalMessage("completed"));

    await expect(page.getByLabel("Score 100 percent")).toBeVisible();
    await expect(page.getByLabel("Execution log")).toContainText("test_add PASSED");
    expect(api.calls()).toBe(fetchesBefore + 1);
  });

  test("a status-only update patches the snapshot in place", async ({ page }) => {
    await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(processing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    await expect(page.getByText(/Running tests/)).toBeVisible();

    // Mid-pipeline events still carry only a status/phase pair. Delivered on top
    // of the snapshot they patch it; the page must not try to render a report.
    socket.send(statusMessage("processing", "generating"));
    await expect(page.getByText("Generating code")).toBeVisible();
    await expect(page.getByLabel("Score 100 percent")).toHaveCount(0);
    await expect(page.getByText(/no result was produced/)).toHaveCount(0);
  });

  test("a status-only update with no base record is ignored", async ({ page }) => {
    await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      // Deliberately no snapshot: this connection only ever sees a bare status
      // pair, the way it would if the connect-time snapshot were missed.
      ws.send(statusMessage("processing", "generating"));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    // Wait for the REST record to settle *before* judging the patch, so the
    // assertion is about the hook's guard and not about which write happened to
    // land last.
    await expect(page.getByText(/Running tests/)).toBeVisible();
    socket.send(statusMessage("processing", "generating"));
    await page.waitForTimeout(300);

    // Nothing to patch, so the hook drops the update rather than inventing a
    // two-field Submission. Without the guard that object would replace the real
    // record and leave the page rendering a report with no id, no code and no
    // timestamps.
    await expect(page.getByText("Generating code")).toHaveCount(0);
    await expect(page.getByText(/Running tests/)).toBeVisible();
    await expect(page.getByText(/no result was produced/)).toHaveCount(0);
  });

  test("a repair update shows the failed attempt while the run continues", async ({
    page,
  }) => {
    // The complaint #217 was filed for: a failed run used to end at an
    // unreadable log dump. During a repair the page has to say what failed and
    // why, while still showing that the evaluation is running.
    await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(processing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    await expect(page.getByText(/Running tests/)).toBeVisible();

    socket.send(repairingMessage(repairing()));

    await expect(page.getByText(/Repairing the failed run/)).toBeVisible();
    // The failed attempt is legible without opening anything...
    await expect(page.getByText("Attempt 1 of 3")).toBeVisible();
    await expect(page.getByText(/1 of 2 tests passed/)).toBeVisible();
    // ...and still collapsed, so the timeline does not bury the phase banner.
    await expect(page.getByText(/code, tests and raw logs/i)).toHaveCount(1);
    // No report yet: the run has not finished.
    await expect(page.getByLabel("Score 100 percent")).toHaveCount(0);
  });

  test("a repaired run shows the full attempt history on the report", async ({ page }) => {
    await mockAuthenticatedSubmission(page, repairing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(repairing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    await expect(page.getByText("Attempt 1 of 3")).toBeVisible();

    socket.send(terminalMessage(repaired()));

    // Both attempts survive the terminal record, and the report is the one from
    // the attempt that passed.
    await expect(page.getByText("Attempt 1 of 3")).toBeVisible();
    await expect(page.getByText("Attempt 2 of 3")).toBeVisible();
    await expect(page.getByText("Final")).toBeVisible();
    await expect(page.getByLabel("Score 100 percent")).toBeVisible();
    // The summary leads the report; the raw dump is one click away. Scoped to
    // the Outcome card because the same text also appears on attempt 2's row.
    const outcome = page.getByRole("heading", { name: "Outcome" }).locator("..");
    await expect(outcome).toContainText("2 of 2 tests passed (score 100.0%)");
    await expect(page.getByText(/show raw output/i)).toBeVisible();
  });

  test("a run that passed first try shows no repair history", async ({ page }) => {
    // Repairs are opt-in by budget, but the default UI must look unchanged for
    // the common case: no empty timeline, no stray heading.
    await mockAuthenticatedSubmission(page, processing());
    const socket = await mockSubmissionSocket(page, (ws) => {
      ws.send(snapshotMessage(processing()));
    });

    await page.goto(`/submissions/${SUBMISSION_ID}`);
    await socket.waitForConnections(1);
    socket.send(terminalMessage(completed()));

    await expect(page.getByLabel("Score 100 percent")).toBeVisible();
    await expect(page.getByText(/attempt history/i)).toHaveCount(0);
    await expect(page.getByText(/^Attempt \d/)).toHaveCount(0);
  });
});
