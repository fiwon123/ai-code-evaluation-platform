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
  metrics: Record<string, unknown>;
  test_results: Array<{ name: string; passed: boolean; message?: string | null }> | null;
  created_at: string;
}

export interface WireSubmission {
  id: string;
  user_id: string;
  challenge_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  phase: "generating" | "testing" | null;
  started_at: string | null;
  provider: string | null;
  model?: string | null;
  language: string | null;
  code: string | null;
  score: number | null;
  evaluation_result: WireResult | null;
  created_at: string;
  updated_at: string;
}

const CHALLENGE_ID = "c-e2e-ws";

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
