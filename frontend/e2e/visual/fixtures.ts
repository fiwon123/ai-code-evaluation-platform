import { expect, type BrowserContext, type Page, type Route } from "@playwright/test";

import {
  ADMIN_USER,
  CHALLENGES,
  TEST_USER,
  mockApi,
} from "../data";
import { completedSubmission, type WireSubmission } from "../helpers/socket";
import { waitForTextSettled } from "./helpers/motion";
import type { SweepRoute, SweepTheme } from "./routes";

/**
 * The API surface the sweep needs on top of `e2e/data.ts`.
 *
 * `mockApi` covers the endpoints the *existing* specs touch. The sweep walks
 * more of the app, and the pages it reaches swallow a failed request into an
 * error state rather than into a missing heading — convenient for a test, fatal
 * for a sweep, because "the fixture 404'd" and "the page is broken" produce the
 * same image. So every endpoint a swept route calls is served here, and a missing
 * one fails that route's `heading` assertion loudly instead of yielding a
 * screenshot of an error banner.
 *
 * Fixtures are shaped from `src/types.ts` rather than invented: the admin
 * dashboard and the profile list both destructure nested fields, and a payload
 * that is nearly right renders as an empty card — which looks like a design
 * problem in a capture.
 *
 * Nothing here reaches a backend. The sweep runs with no server, like the rest
 * of the e2e suite.
 */

/** The origin the sweep may render. Everything else is aborted. */
export const APP_ORIGIN =
  process.env.VISUAL_SWEEP_ORIGIN ?? "http://localhost:4173";

/**
 * Abort every request that is not the app's own origin.
 *
 * The app talks to `http://localhost:8000/api/**`, and those requests are
 * fulfilled by `mockApi` rather than sent anywhere. Playwright matches the most
 * recently registered route first, so this guard is registered *before* the API
 * mocks and therefore only ever sees what they did not claim: document, script,
 * stylesheet, image and font requests. A request for anything the app did not
 * ask for — a webfont from a CDN, an analytics beacon, an absolute URL in copy —
 * lands here and dies, which is what makes "fully offline" true rather than
 * aspirational. Because the list is closed, a request reaching the guard *from*
 * the API origin is itself a finding, and the sweep reports the URLs it blocked.
 */
export async function guardOrigins(
  context: BrowserContext,
): Promise<{ blocked: () => string[] }> {
  const blocked: string[] = [];
  await context.route("**/*", async (route: Route) => {
    const url = route.request().url();
    if (url.startsWith(APP_ORIGIN)) {
      await route.fallback();
      return;
    }
    blocked.push(url);
    await route.abort("blockedbyclient");
  });
  return { blocked: () => [...blocked] };
}

/** A long pytest run: past `CodeBlock`'s `DEFAULT_LINE_LIMIT` (300), so it clamps. */
export function longLog(lines = 340): string {
  const out = [
    "============================= test session starts ==============================",
    "platform linux -- Python 3.12.3, pytest-8.3.2, pluggy-1.5.0",
    `rootdir: /tmp/evaluations/sweep-submission`,
  ];
  for (let i = 0; i < lines; i += 1) {
    const n = String(i + 1).padStart(3, "0");
    const name = `tests/test_math_${n}.py::test_case_${n}`;
    out.push(i % 23 === 0 ? `${name} FAILED` : `${name} PASSED`);
  }
  out.push(
    `======================== ${lines - 2} passed, 2 failed in 4.21s ========================`,
  );
  return out.join("\n");
}

const SOLUTION_SOURCE = [
  "from typing import List",
  "",
  "def two_sum(nums: List[int], target: int) -> List[int]:",
  '    """Return the indices of the two numbers that add up to `target`."""',
  "    seen: dict[int, int] = {}",
  "    for index, value in enumerate(nums):",
  "        complement = target - value",
  "        if complement in seen:",
  "            return [seen[complement], index]",
  "        seen[value] = index",
  "    return []",
].join("\n");

/** The submission the sweep renders: complete, scored, with a repair history. */
export function sweepSubmission(id: string): WireSubmission {
  const base = completedSubmission(id);
  const logs = longLog();
  return {
    ...base,
    id,
    code: SOLUTION_SOURCE,
    language: "python",
    score: 96.7,
    attempts: [
      {
        id: "a-sweep-1",
        attempt_number: 1,
        code: SOLUTION_SOURCE.replace("seen[value] = index", "seen[value] = index  # bug"),
        passed_tests: 118,
        total_tests: 120,
        score: 96.7,
        logs: logs.slice(0, 4000),
        logs_summary:
          "118 of 120 tests passed (score 96.7%)\nFailed tests (2):\n- test_duplicate_values: assert [0, 1] == [0, 2]",
        metrics: { returncode: 1, duration_ms: 1840 },
        test_results: [
          { name: "test_add", passed: true },
          { name: "test_sub", passed: false, message: "assert 0 == 3" },
        ],
        created_at: base.created_at,
      },
    ],
    max_attempts: 3,
    evaluation_result: {
      id: "r-sweep-1",
      passed_tests: 118,
      total_tests: 120,
      score: 96.7,
      logs,
      logs_summary: "118 of 120 tests passed (score 96.7%)",
      metrics: { duration_ms: 4210, returncode: 0, repair_attempts: 1 },
      test_results: [
        { name: "test_add", passed: true },
        { name: "test_sub", passed: true },
        { name: "test_duplicate_values", passed: false, message: "assert [0, 1] == [0, 2]" },
      ],
      created_at: base.updated_at,
    },
    updated_at: base.updated_at,
  };
}

/** `GET /api/models` — a bare array, per `modelsApi.list()`. */
const MODELS = [
  {
    id: "gpt-4o-mini",
    provider: "openai",
    label: "GPT-4o mini",
    description: "Fast, cheap, and good enough for most challenge sets.",
    is_default: true,
  },
  {
    id: "claude-3-5-haiku",
    provider: "anthropic",
    label: "Claude 3.5 Haiku",
    description: "Anthropic's fast tier, strong at multi-step problems.",
    is_default: false,
  },
  {
    id: "demo",
    provider: "demo",
    label: "Demo (deterministic)",
    description: "A seeded fake provider, so the pipeline is testable offline.",
    is_default: false,
  },
];

/** `GET /api/admin/stats` — every breakdown the dashboard charts. */
const PLATFORM_STATS = {
  total_users: 1284,
  total_challenges: 342,
  total_submissions: 9841,
  completed_submissions: 9102,
  failed_submissions: 411,
  pending_submissions: 328,
  average_score: 78.4,
  submissions_by_status: [
    { status: "completed", count: 9102 },
    { status: "failed", count: 411 },
    { status: "processing", count: 12 },
    { status: "pending", count: 316 },
  ],
  submissions_by_language: [
    { language: "python", count: 4102, avg_score: 81.2 },
    { language: "typescript", count: 2388, avg_score: 77.9 },
    { language: "go", count: 1720, avg_score: 74.1 },
    { language: "java", count: 1044, avg_score: 76.5 },
    { language: "javascript", count: 587, avg_score: 72.8 },
  ],
  submissions_by_provider: [
    { provider: "openai", count: 4201, avg_score: 82.1, pass_rate: 0.71 },
    { provider: "anthropic", count: 3105, avg_score: 79.6, pass_rate: 0.68 },
    { provider: "demo", count: 1980, avg_score: 71.2, pass_rate: 0.52 },
    { provider: "ollama", count: 555, avg_score: 63.8, pass_rate: 0.34 },
  ],
  submissions_by_error_type: [
    { error_type: "provider_error", count: 214 },
    { error_type: "timeout", count: 98 },
    { error_type: "sandbox_error", count: 41 },
  ],
  top_challenges: [
    { challenge_id: "c-easy-1", title: "Two Sum", runs: 812, avg_score: 88.4 },
    { challenge_id: "c-med-1", title: "LRU Cache", runs: 604, avg_score: 74.1 },
    { challenge_id: "c-hard-1", title: "Edit Distance", runs: 388, avg_score: 61.9 },
  ],
  submissions_last_14_days: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-01-${String(i + 2).padStart(2, "0")}`,
    count: 540 + ((i * 97) % 310),
  })),
};

/** `GET /api/submissions/stats` — a per-challenge rollup, not a total. */
const SUBMISSION_STATS = {
  items: CHALLENGES.map((challenge, i) => ({
    challenge_id: challenge.id,
    challenge_title: challenge.title,
    // The API sends this for every challenge (#347), and the profile card
    // clamps it to two lines — so a fixture without it leaves the sweep
    // photographing a card with no description at all, which is not a card any
    // user sees. The first challenge's is deliberately long enough to clamp.
    description:
      i === 0
        ? "Given an array of integers and a target, return the indices of the two numbers that add up to the target. Each input has exactly one solution, and the same element may not be used twice."
        : challenge.description,
    language: challenge.language,
    total_runs: [48, 31, 12][i],
    completed_runs: [45, 27, 9][i],
    failed_runs: [3, 4, 3][i],
    avg_score: [88.4, 74.1, 61.9][i],
    best_score: [100, 92.5, 78.2][i],
    last_run_at: "2026-02-01T09:00:00Z",
    // Also part of the payload since #347. The last challenge gets `null`, so
    // the "not measured" state is rendered rather than assumed.
    last_duration_ms: [4210, 1180, null][i] as number | null,
  })),
};

/** `GET /api/results/:token` — the public share payload, flat per `SharedResult`. */
const SHARED_RESULT = {
  challenge_id: "c-easy-1",
  challenge_title: "Two Sum",
  challenge_prompt: "Write a function two_sum(nums, target) returning the indices of the two numbers that add up to the target.",
  language: "python",
  provider: "openai",
  status: "completed" as const,
  created_at: "2026-02-01T10:00:00Z",
  code: SOLUTION_SOURCE,
  score: 96.7,
  passed_tests: 118,
  total_tests: 120,
  logs: longLog(40),
  logs_summary: "118 of 120 tests passed (score 96.7%)",
  metrics: { duration_ms: 4210, returncode: 0 },
  test_results: [
    { name: "test_add", passed: true },
    { name: "test_sub", passed: true },
  ],
};

/** `GET /api/submissions/comparison` — the provider table on a challenge. */
const COMPARISON = {
  challenge_id: "c-easy-1",
  submissions: [
    { provider: "openai", model: "gpt-4o-mini", score: 96.7, runs: 3, language: "python" },
    { provider: "anthropic", model: "claude-3-5-haiku", score: 100, runs: 2, language: "python" },
  ],
};

const paginated = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 20,
  pages: 1,
});

/**
 * Wire up a page for the sweep.
 *
 * Registration order is load-bearing and not incidental. Playwright checks route
 * handlers newest-first, so `mockApi` (oldest here) is the *fallback* and these
 * handlers are consulted first for the paths they own. `guardOrigins` is
 * registered by the fixture in the caller, before this, so it has first refusal
 * on everything and only passes through what a mock then claims.
 */
export async function sweepApi(
  page: Page,
  options: { auth: "guest" | "user" | "admin" },
): Promise<void> {
  // Ownership: `EditChallenge` renders "You can only edit challenges you
  // created." — a `role="alert"` with no `h1` — unless the fetched challenge's
  // owner is the signed-in user. The stock fixtures belong to `u-owner-*`, which
  // no mock user is, so the edit page could never be photographed at all.
  const challenges = CHALLENGES.map((c) => ({
    ...c,
    owner_id: options.auth === "admin" ? ADMIN_USER.id : TEST_USER.id,
  }));

  await mockApi(
    page,
    challenges,
    options.auth === "admin"
      ? { admin: true }
      : options.auth === "user"
        ? { auth: true }
        : {},
  );

  const submission = sweepSubmission("sweep-submission");

  // `/api/submissions*` is one handler, branching on the path, because the glob
  // `**/api/submissions**` also matches `/api/submissions/stats` and
  // `/api/submissions/:id` — three different shapes behind one prefix. Splitting
  // it into three globs would leave their precedence to registration order.
  await page.route("**/api/submissions**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/submissions/stats") {
      return route.fulfill({ json: SUBMISSION_STATS });
    }
    if (pathname === "/api/submissions/comparison") {
      return route.fulfill({ json: COMPARISON });
    }
    if (pathname === "/api/submissions") {
      return route.fulfill({ json: paginated([submission]) });
    }
    if (/\/api\/submissions\/[^/]+$/.test(pathname)) {
      return route.fulfill({ json: submission });
    }
    return route.fulfill({ status: 404, json: { detail: "Not found (visual sweep)" } });
  });

  await page.route("**/api/results/*", (route) => route.fulfill({ json: SHARED_RESULT }));
  await page.route("**/api/models", (route) => route.fulfill({ json: MODELS }));
  await page.route("**/api/admin/stats", (route) => route.fulfill({ json: PLATFORM_STATS }));
  await page.route("**/api/admin/challenges**", (route) =>
    route.fulfill({ json: paginated(challenges) }),
  );
  await page.route("**/api/admin/submissions**", (route) =>
    route.fulfill({
      json: paginated([{ ...submission, username: "tester", challenge_title: "Two Sum" }]),
    }),
  );
  // The change-password form's own success path, for the toast state.
  await page.route("**/api/auth/change-password", (route) =>
    route.fulfill({ json: { detail: "Password updated" } }),
  );

  // The submission page opens a WebSocket at the app's own origin. Against a
  // preview server with no backend it would fail and retry, and the reconnect
  // state would become part of the capture. Holding it open silently keeps the
  // page in the state a reader with a backend sees.
  await page.routeWebSocket(/\/api\/ws\//, () => {
    /* held open, no frames: the REST snapshot is already on screen */
  });
}

/**
 * Hold every request matching `pattern` until `release()`, then behave normally.
 *
 * This is how a transient state is held open for a capture. The alternative —
 * click, then hope the spinner is still there — is the wall-clock trap in its
 * purest form: the state has a real expiry, the capture has a real cost, and
 * under load the two cross. A held request has no expiry, so the frame is the
 * same on an idle machine and a busy one.
 *
 * `release()` is permanent, and both halves of that matter:
 *
 * - **It works before the request arrives.** Releasing a gate that nothing is
 *   waiting on yet used to be a silent no-op, because the resolver was only
 *   assigned once a request was already in flight. The skeleton-to-content state
 *   released the moment after the driver, which is *before* the page had even
 *   asked — so nothing was waiting, the release evaporated, and the frame was a
 *   skeleton that never resolved. Hence `open`, a flag rather than a promise:
 *   releasing marks the gate open, and the request that shows up afterwards is
 *   served without being held.
 * - **It serves everything, not the last one.** A page can make several matching
 *   requests. The old version kept a single resolver, so a second request
 *   overwrote the first and the earlier request was never answered — the same
 *   permanent skeleton, reached a second way.
 *
 * `release()` answers with whatever `reply` says, which is what the "then the
 * content arrives" half of a skeleton-to-content pair needs, and `parked()`
 * reports how many requests are being held right now.
 */
export function park(
  page: Page,
  pattern: string | RegExp,
  reply: { json: unknown; status?: number } = { json: {}, status: 200 },
): { release: () => void; parked: () => number } {
  let open = false;
  const waiters: Array<() => void> = [];

  void page.route(pattern, async (route) => {
    if (!open) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    await route.fulfill(reply);
  });

  return {
    release: () => {
      open = true;
      for (const resolve of waiters.splice(0)) resolve();
    },
    parked: () => waiters.length,
  };
}

/** A 422 with per-field messages, in Pydantic's shape (`api.ts` parses `loc`). */
export function validationFailure(
  fields: Record<string, string>,
): { status: number; json: unknown } {
  return {
    status: 422,
    json: {
      detail: Object.entries(fields).map(([field, msg]) => ({
        loc: ["body", field],
        msg,
        type: "value_error",
      })),
    },
  };
}

/**
 * Load a route in a theme and prove the page is the page.
 *
 * Shared rather than private to the sweep spec because the determinism lock has
 * to open pages the same way, and importing it from the spec would register that
 * spec's entire test set in the lock's worker.
 *
 * Three assertions, each guarding a way a capture can be of the wrong thing:
 *
 * - `data-theme` must match. Setting the attribute by hand does not stick: the
 *   app re-applies the stored theme on mount and silently reverts it, so a "dark"
 *   run photographs the light theme and every dark finding is really a light one.
 * - the h1 must be the route's heading, so the frame cannot be the Suspense
 *   fallback, an auth redirect or the catch-all page.
 * - the page's numbers must have stopped moving. `useCountUp` is a rAF loop, not
 *   a Web Animation, so it cannot be seeked; waiting for the text to settle is
 *   load-independent, waiting out a duration is not.
 */
export async function openRoute(page: Page, route: SweepRoute, theme: SweepTheme): Promise<void> {
  await page.addInitScript((t) => window.localStorage.setItem("theme", t), theme);
  await page.goto(`${APP_ORIGIN}${route.url}`, { waitUntil: "load" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.getByRole("heading", { name: route.heading, level: 1 })).toBeVisible();
  await waitForTextSettled(page);
  // Pages whose resting state is reached by a JS timeline rather than by their
  // content being present. `waitForTextSettled` and the settle helper both look
  // at text and CSS animations; neither can see a `setTimeout` chain, so `/`
  // would otherwise be photographed mid-story and filed under "at rest".
  if (route.atRest) {
    await expect(page.locator(route.atRest)).toBeVisible({
      timeout: 30_000,
    });
  }
}
