import { expect, type Page, type WebSocketRoute } from "@playwright/test";
import { TEST_TOKEN, TEST_USER } from "../data";

/**
 * Fixtures for driving the submission WebSocket in a real browser.
 *
 * The point of these is to exercise the parts a hand-rolled fake socket in a
 * component test cannot reach: the client actually performing a WebSocket
 * handshake, the URL it derives from `window.location.origin`, and the JSON it
 * parses off the wire. Only the *frames* are ours — every `/api` request is
 * still intercepted, so the suite needs no backend.
 *
 * The wire types below are declared locally rather than imported from
 * `src/types.ts`: the e2e project is a separate composite project and cannot
 * reference app sources. They also serve as an independent statement of the
 * wire shape, which is the whole point — a field the client cannot read would
 * break the render assertions below.
 */

export interface WireResult {
  id: string;
  passed_tests: number;
  total_tests: number;
  score: number;
  logs: string;
  logs_summary?: string | null;
  metrics: Record<string, unknown>;
  test_results: Array<{ name: string; passed: boolean; message?: string | null }> | null;
  created_at: string;
}

/** One row of a submission's repair history. */
export interface WireAttempt {
  id: string;
  attempt_number: number;
  code: string;
  passed_tests: number;
  total_tests: number;
  score: number;
  logs: string;
  logs_summary: string;
  metrics: Record<string, unknown>;
  test_results: Array<{ name: string; passed: boolean; message?: string | null }> | null;
  created_at: string;
}

// `WireSubmission` is a hand-written mirror of the API's `Submission`, not an
// extension of it — `e2e/` may not import from `src/`, so the two can drift
// silently. #361 added `challenge_title` and this file was left unchanged,
// which the visual sweep reported as a submission card with a blank heading:
// the fixture rendered, just without the new field. The render contract is
// locked by `e2e/profile.spec.ts` ("a submission row is named by its
// challenge"), so a new field needs adding here too, not just to `src/types.ts`.
export interface WireSubmission {
  id: string;
  user_id: string;
  challenge_id: string;
  /** The API resolves the parent challenge's title onto every submission
   *  (#361), and the profile card renders it as the row's heading. */
  challenge_title: string;
  status: "pending" | "processing" | "completed" | "failed";
  phase: "generating" | "testing" | "repairing" | null;
  started_at: string | null;
  provider: string | null;
  model?: string | null;
  language: string | null;
  code: string | null;
  score: number | null;
  evaluation_result: WireResult | null;
  attempts?: WireAttempt[];
  max_attempts?: number;
  created_at: string;
  updated_at: string;
}

const CHALLENGE_ID = "c-e2e-ws";
const CHALLENGE_TITLE = "Two Sum";

/** Recent timestamps: the page renders elapsed time and a "taking longer than
 *  usual" banner from them, and stale dates make both read as nonsense. */
function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}
const SOLUTION_CODE = "def two_sum(nums, target):\n    return []\n";
const LOGS = "tests/test_math.py::test_add PASSED\ntests/test_math.py::test_sub PASSED";

/** A run in flight: status and phase only, nothing to render yet. */
export function processingSubmission(id: string): WireSubmission {
  return {
    id,
    user_id: TEST_USER.id,
    challenge_id: CHALLENGE_ID,
    challenge_title: CHALLENGE_TITLE,
    status: "processing",
    phase: "testing",
    started_at: isoAgo(6),
    provider: "demo",
    model: null,
    language: "python",
    code: null,
    score: null,
    evaluation_result: null,
    created_at: isoAgo(9),
    updated_at: isoAgo(6),
  };
}

/** A finished run, as the terminal message carries it (persisted record). */
export function completedSubmission(id: string): WireSubmission {
  return {
    ...processingSubmission(id),
    status: "completed",
    phase: null,
    code: SOLUTION_CODE,
    score: 100,
    evaluation_result: {
      id: "r-e2e-1",
      passed_tests: 2,
      total_tests: 2,
      score: 100,
      logs: LOGS,
      logs_summary: "2 of 2 tests passed (score 100.0%)",
      metrics: { duration_ms: 412 },
      test_results: [
        { name: "test_add", passed: true },
        { name: "test_sub", passed: true },
      ],
      created_at: isoAgo(1),
    },
    updated_at: isoAgo(1),
  };
}

/** The first attempt: generated, tested, and one test short. */
export function failedAttempt(): WireAttempt {
  return {
    id: "a-e2e-1",
    attempt_number: 1,
    code: "def two_sum(nums, target):\n    return []\n",
    passed_tests: 1,
    total_tests: 2,
    score: 50,
    logs: "tests/test_math.py::test_add PASSED\ntests/test_math.py::test_sub FAILED",
    logs_summary: "1 of 2 tests passed (score 50.0%)\nFailed tests (1):\n- test_sub: assert [] == [0, 1]",
    metrics: { returncode: 1 },
    test_results: [
      { name: "test_add", passed: true },
      { name: "test_sub", passed: false, message: "assert [] == [0, 1]" },
    ],
    created_at: isoAgo(5),
  };
}

/**
 * A repair in flight: attempt 1 failed and has been handed back to the
 * provider. The worker publishes this with the record attached, so the page can
 * show the failed attempt while attempt 2 is still generating.
 */
export function repairingSubmission(id: string): WireSubmission {
  return {
    ...processingSubmission(id),
    phase: "repairing",
    code: null,
    score: null,
    attempts: [failedAttempt()],
    max_attempts: 3,
  };
}

/** A run that failed, was repaired, and then passed on attempt 2. */
export function repairedSubmission(id: string): WireSubmission {
  return {
    ...completedSubmission(id),
    attempts: [
      failedAttempt(),
      {
        id: "a-e2e-2",
        attempt_number: 2,
        code: SOLUTION_CODE,
        passed_tests: 2,
        total_tests: 2,
        score: 100,
        logs: LOGS,
        logs_summary: "2 of 2 tests passed (score 100.0%)",
        metrics: { returncode: 0 },
        test_results: [
          { name: "test_add", passed: true },
          { name: "test_sub", passed: true },
        ],
        created_at: isoAgo(2),
      },
    ],
    max_attempts: 3,
  };
}

/**
 * A failed run: code was generated, no result was produced. This is the case the
 * page's REST safety net exists for — a terminal record that arrives, but without
 * an `evaluation_result` to render.
 */
export function failedSubmission(id: string): WireSubmission {
  return {
    ...processingSubmission(id),
    status: "failed",
    phase: null,
    code: SOLUTION_CODE,
    score: null,
    evaluation_result: null,
    updated_at: isoAgo(2),
  };
}

export const snapshotMessage = (submission: WireSubmission): string =>
  JSON.stringify({ type: "snapshot", submission });

/** Mid-pipeline update: status and phase, no record (what the server still sends). */
export const statusMessage = (
  status: WireSubmission["status"],
  phase: WireSubmission["phase"],
): string => JSON.stringify({ type: "update", status, phase });

/** Terminal update carrying the whole persisted record — the #190 wire shape. */
export const terminalMessage = (submission: WireSubmission): string =>
  JSON.stringify({ type: "update", status: submission.status, phase: null, submission });

/** A repair update carrying the record — the v0.14 wire shape.
 *
 *  Not terminal: the run is still processing, so the phase must survive
 *  alongside the record rather than be forced to null the way a terminal
 *  message does. */
export const repairingMessage = (submission: WireSubmission): string =>
  JSON.stringify({ type: "update", status: submission.status, phase: "repairing", submission });

/** A terminal update with the record *dropped* — the partial-sequence fallback. */
export const recordlessTerminalMessage = (
  status: WireSubmission["status"],
): string => JSON.stringify({ type: "update", status, phase: null });

export interface SubmissionApi {
  /** How many `GET /api/submissions/:id` calls have been made so far. */
  calls(): number;
  /** The path of every submission read so far — which id the client asked for. */
  paths(): string[];
  /** What that endpoint returns from now on (the fallback refetch reads this). */
  setResponse(submission: WireSubmission): void;
}

/**
 * Seed a token, satisfy the auth guard, and serve one submission — counting the
 * reads so a test can assert that a socket message did *not* cause a fetch.
 */
export async function mockAuthenticatedSubmission(
  page: Page,
  initial: WireSubmission,
): Promise<SubmissionApi> {
  // The socket hook returns early without a token, and `/submissions/:id` sits
  // behind the auth guard, so this is required before anything else.
  await page.addInitScript((token) => {
    window.localStorage.setItem("access_token", token);
  }, TEST_TOKEN);

  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: TEST_USER }),
  );

  let current = initial;
  let calls = 0;
  const paths: string[] = [];
  await page.route("**/api/submissions/*", (route) => {
    calls += 1;
    paths.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: current });
  });

  return {
    calls: () => calls,
    paths: () => [...paths],
    setResponse: (submission) => {
      current = submission;
    },
  };
}

export interface MockSocket {
  /** Every URL the page connected to, in order. */
  urls(): string[];
  /** Number of connections the page has opened (a reconnect increments it). */
  connections(): number;
  /** Push a frame to the page on the most recent connection. */
  send(payload: string): void;
  /** Hang up from the server side, as a dropped connection would. */
  closeFromServer(): Promise<void>;
  /** Wait until the page has connected at least `count` times. */
  waitForConnections(count: number): Promise<void>;
}

/**
 * Mock the submission socket. `onConnect` runs per connection, so a test can
 * send a different opening frame on a reconnect than on the first connect.
 */
export async function mockSubmissionSocket(
  page: Page,
  onConnect: (ws: WebSocketRoute, connectionNumber: number) => void,
): Promise<MockSocket> {
  const urls: string[] = [];
  const open: WebSocketRoute[] = [];

  await page.routeWebSocket(/\/api\/ws\/submissions\//, (ws) => {
    urls.push(ws.url());
    open.push(ws);
    onConnect(ws, open.length);
  });

  return {
    urls: () => [...urls],
    connections: () => open.length,
    send: (payload) => {
      const latest = open.at(-1);
      if (!latest) {
        throw new Error("no socket connection to send on");
      }
      latest.send(payload);
    },
    closeFromServer: async () => {
      const latest = open.at(-1);
      if (!latest) {
        throw new Error("no socket connection to close");
      }
      await latest.close({ code: 1006, reason: "dropped" });
    },
    waitForConnections: async (count) => {
      await expect
        .poll(() => open.length, { message: `waiting for ${count} connection(s)` })
        .toBeGreaterThanOrEqual(count);
    },
  };
}

/**
 * Lets frames the mock has already written reach the page's `onmessage`.
 *
 * A frame sent from the test is handed to the browser, but the page dispatches it
 * on its own task queue, so it may not have been handled by the time the next
 * line runs. Sleeping a fixed number of milliseconds only guesses at that: too
 * short and the test judges a message that has not arrived yet, too long and every
 * run pays the delay for nothing. Two animation frames is a boundary the page
 * actually observes rather than a duration we hope is enough.
 *
 * This is still a settling step, not a proof — nothing here can make an assertion
 * about an *absence* deterministic. Claims of the form "this update changed
 * nothing" are proved where the state is readable, in
 * `src/hooks/useSubmissionSocket.test.ts`; this only lets the browser test check
 * that the page survives the frame.
 */
export const settleSocketFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
