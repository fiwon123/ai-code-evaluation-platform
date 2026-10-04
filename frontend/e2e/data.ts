import type { Page } from "@playwright/test";

/**
 * Shared fixtures + API mocking for the e2e suite.
 *
 * The frontend's `API_BASE` is `http://localhost:8000` (see
 * `src/services/api.ts`), so specs intercept every `/api` request and fulfill
 * with canned responses. The suite never needs a live backend.
 */

export const API_BASE = "http://localhost:8000";

export const TEST_USER = {
  id: "u-e2e-user",
  email: "tester@example.com",
  username: "tester",
  is_admin: false,
  is_active: true,
  created_at: "2026-01-15T10:00:00Z",
};

export const TEST_TOKEN = "e2e-test-jwt-token";

export const ADMIN_USER: typeof TEST_USER = {
  ...TEST_USER,
  id: "u-e2e-admin",
  email: "admin@example.com",
  username: "root",
  is_admin: true,
};

/** Admin user list. The muted email cell is the contrast-critical one. */
export const ADMIN_USERS: Array<typeof TEST_USER> = [
  { ...TEST_USER, id: "u-1", email: "ada@example.com", username: "ada" },
  { ...TEST_USER, id: "u-2", email: "grace@example.com", username: "grace" },
  {
    ...TEST_USER,
    id: "u-3",
    email: "alan@example.com",
    username: "alan",
    is_active: false,
  },
];

/** Password that makes the login mock return 401 (see `mockApi`). */
export const WRONG_PASSWORD = "wrong-password";

export function authResponse(user: typeof TEST_USER = TEST_USER): {
  access_token: string;
  token_type: string;
  user: typeof TEST_USER;
} {
  return { access_token: TEST_TOKEN, token_type: "bearer", user };
}

export const CHALLENGES: Array<{
  id: string;
  title: string;
  description: string;
  prompt: string;
  test_code: string;
  language: string;
  difficulty: "easy" | "medium" | "hard";
  owner_id: string;
  created_at: string;
  updated_at: string;
}> = [
  {
    id: "c-easy-1",
    title: "Two Sum",
    description: "Return indices of the two numbers that add up to the target.",
    prompt: "Write a function two_sum(nums, target).",
    test_code: "def test_two_sum(): ...",
    language: "python",
    difficulty: "easy",
    owner_id: "u-owner-1",
    created_at: "2026-01-10T09:00:00Z",
    updated_at: "2026-01-10T09:00:00Z",
  },
  {
    id: "c-med-1",
    title: "LRU Cache",
    description:
      "Design a data structure that follows the LRU eviction policy.",
    prompt: "Implement an LRU cache with get and put.",
    test_code: "def test_lru(): ...",
    language: "typescript",
    difficulty: "medium",
    owner_id: "u-owner-2",
    created_at: "2026-01-11T14:30:00Z",
    updated_at: "2026-01-11T14:30:00Z",
  },
  {
    id: "c-hard-1",
    title: "Edit Distance",
    description: "Compute the minimum number of edits between two strings.",
    prompt: "Write a function min_edit_distance(a, b).",
    test_code: "def test_edit_distance(): ...",
    language: "go",
    difficulty: "hard",
    owner_id: "u-owner-3",
    created_at: "2026-01-12T11:00:00Z",
    updated_at: "2026-01-12T11:00:00Z",
  },
];

/**
 * Per-challenge stats for the profile card grid (#347).
 *
 * Deliberately not uniform. A fixture where every field holds the same value
 * cannot tell a correct rendering from a hard-coded one. Between them these two
 * cover: two languages, so the card accent is visibly per-card rather than one
 * global colour; a `null` average and a `null` duration, so the "not measured"
 * branch is on screen rather than merely present in the code; a long description,
 * so the clamp and its tooltip have something real to truncate; and a failed run.
 */
export const CHALLENGE_STATS = [
  {
    // The real `CHALLENGES` id, not a UUID of its own. #348 joins this rollup onto
    // the "my challenges" cards by `challenge_id`, and while these were unrelated
    // strings every one of those cards rendered "not evaluated yet" — a fixture
    // that quietly cannot exercise the join it exists to feed.
    challenge_id: "c-easy-1",
    challenge_title: "Two Sum",
    description:
      "Given an array of integers and a target, return the indices of the two numbers that add up to the target. Each input has exactly one solution, and the same element may not be used twice.",
    language: "python",
    total_runs: 4,
    completed_runs: 3,
    failed_runs: 1,
    avg_score: 75,
    best_score: 100,
    last_run_at: "2026-09-28T14:00:00Z",
    last_duration_ms: 1200,
  },
  {
    challenge_id: "c-hard-1",
    // Not the title `CHALLENGES` gives this id, and deliberately so: the grid
    // card renders the rollup's `challenge_title`, and the two-line title clamp
    // needs something that actually clamps. `c-hard-1`'s own title is short and
    // `challenges.spec.ts` asserts it, so renaming it to a long one there to fix
    // this would trade one spec's coverage for another's. Two fixtures, two jobs.
    challenge_title: "Concurrent Web Scraper With Retries",
    description: "Short one.",
    language: "go",
    total_runs: 1,
    completed_runs: 0,
    failed_runs: 1,
    avg_score: null,
    best_score: null,
    last_run_at: "2026-09-29T09:00:00Z",
    // A run that never produced a result has no duration, so the card has to
    // render something other than a number here.
    last_duration_ms: null,
  },
];

/**
 * The recent submissions the profile lists alongside the card grid.
 */
export const SUBMISSIONS = [
  {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    challenge_id: "c-easy-1",
    challenge_title: "Two Sum",
    language: "python",
    provider: "demo",
    model: "demo",
    code: "def two_sum():\n    pass",
    status: "completed",
    score: 100,
    // A result, so the row carries a test count, a duration, a tooltip *and* the
    // share controls — the tallest card in the column.
    evaluation_result: {
      id: "er-1",
      passed_tests: 118,
      total_tests: 120,
      score: 100,
      logs: "118 passed, 2 failed",
      logs_summary: "FAILED test_duplicate_indices: expected [0, 1] got [1, 0]",
      metrics: { duration_ms: 4210 },
      created_at: "2026-09-28T14:00:00Z",
    },
    created_at: "2026-09-28T14:00:00Z",
  },
  {
    // Second language, second provider, and a *model* id — the row below the
    // badges is `provider · model`, and a fixture with one of each value cannot
    // tell a correct join from a hard-coded one.
    id: "bbbbbbbb-1111-4111-8111-111111111111",
    challenge_id: "c-med-1",
    challenge_title: "LRU Cache",
    language: "typescript",
    provider: "anthropic",
    model: "claude-sonnet-4",
    code: null,
    status: "failed",
    score: 41.2,
    evaluation_result: {
      id: "er-2",
      passed_tests: 3,
      total_tests: 15,
      score: 41.2,
      logs: "3 passed, 12 failed",
      logs_summary: "FAILED test_evicts_least_recent: expected 2 got 1",
      metrics: { duration_ms: 890 },
      created_at: "2026-09-27T10:00:00Z",
    },
    created_at: "2026-09-27T10:00:00Z",
  },
  {
    // In flight: no result, no score, no duration, no share controls, and a
    // delayed-but-not-stuck age. This is the card that used to be one row tall
    // next to a three-row neighbour, which is the misalignment the issue is
    // about — so it has to be in the fixture.
    id: "cccccccc-1111-4111-8111-111111111111",
    challenge_id: "c-hard-1",
    challenge_title: "Edit Distance",
    language: "go",
    provider: "demo",
    model: null,
    code: null,
    status: "processing",
    phase: "testing",
    started_at: "2026-09-29T09:59:00Z",
    score: null,
    evaluation_result: null,
    created_at: "2026-09-29T09:59:00Z",
  },
];

/**
 * Intercepts every `/api/**` request and fulfills it with canned data.
 *
 * Handles the endpoints the surfaced pages actually call:
 * - POST /api/auth/login   → 200 (or 401 for `WRONG_PASSWORD`)
 * - POST /api/auth/register → 201 AuthResponse
 * - GET  /api/auth/me      → 401 unless `{ auth: true }` / `{ admin: true }`
 * - GET  /api/challenges   → paginated list, honoring `difficulty`/`search`
 * - POST /api/challenges   → 201, echoing the submitted body (signed in only)
 * - GET  /api/challenges/:id → the submitted challenge (signed in only)
 * - GET  /api/admin/users  → paginated list (only with `{ admin: true }`)
 * - GET  /api/submissions  → the profile's recent-submissions list
 * - GET  /api/submissions/stats → per-challenge aggregates behind the cards
 *
 * `auth` is deliberately separate from `admin`: the challenge forms sit behind
 * `ProtectedRoute`, not `AdminRoute`, so exercising them as a plain signed-in
 * user keeps the spec honest about who can actually create a challenge.
 */
export async function mockApi(
  page: Page,
  challenges: typeof CHALLENGES = CHALLENGES,
  options: { admin?: boolean; auth?: boolean } = {},
): Promise<void> {
  const signedIn = Boolean(options.admin || options.auth);
  // Challenges created during the test, so the create → detail round trip
  // resolves without a live backend.
  const created: Array<Record<string, unknown>> = [];

  if (signedIn) {
    // `AdminRoute`/`ProtectedRoute` need an authenticated user before they
    // render anything, and the API client reads the token straight out of
    // localStorage.
    await page.addInitScript((token) => {
      window.localStorage.setItem("access_token", token);
    }, TEST_TOKEN);
  }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "POST" && url.pathname === "/api/auth/login") {
      const payload = route.request().postDataJSON() as {
        password?: string;
      } | null;
      if (payload?.password === WRONG_PASSWORD) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Incorrect identifier or password" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authResponse()),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/auth/register") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(authResponse()),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/auth/me" && signedIn) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(options.admin ? ADMIN_USER : TEST_USER),
      });
      return;
    }

    if (
      method === "GET" &&
      url.pathname === "/api/admin/users" &&
      options.admin
    ) {
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("page_size") ?? "20");
      const start = (pageNumber - 1) * pageSize;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: ADMIN_USERS.slice(start, start + pageSize),
          total: ADMIN_USERS.length,
          page: pageNumber,
          page_size: pageSize,
          pages: 1,
        }),
      });
      return;
    }

    // The admin dashboard and the two remaining admin tables (#402). They were
    // the only admin endpoints `mockApi` did not answer, which is why
    // `/admin/challenges` and `/admin/submissions` had no e2e coverage at all:
    // the route returned the error boundary, and a test that only asserted "a
    // heading exists" passed on it. Added as an empty paginated result for the
    // same reason the rest of this fixture is empty — the claims under test are
    // about layout and decoration, not about rows.
    if (
      method === "GET" &&
      url.pathname === "/api/admin/stats" &&
      options.admin
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total_users: ADMIN_USERS.length,
          total_challenges: CHALLENGES.length,
          total_submissions: SUBMISSIONS.length,
          completed_submissions: 0,
          failed_submissions: 0,
          pending_submissions: 0,
          average_score: null,
          // Every breakdown group is required, not optional: the dashboard calls
          // `.map()` on all six, so a partial payload throws inside the chart
          // section and React replaces the whole page with its error boundary —
          // which is exactly what this fixture did on the first attempt, and why
          // the route looked like it simply had no backdrop.
          submissions_by_status: [],
          submissions_by_language: [],
          submissions_by_provider: [],
          submissions_by_error_type: [],
          top_challenges: [],
          submissions_last_14_days: [],
        }),
      });
      return;
    }

    if (
      method === "GET" &&
      (url.pathname === "/api/admin/challenges" ||
        url.pathname === "/api/admin/submissions") &&
      options.admin
    ) {
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("page_size") ?? "20");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          total: 0,
          page: pageNumber,
          page_size: pageSize,
          pages: 1,
        }),
      });
      return;
    }

    if (method === "POST" && url.pathname === "/api/challenges" && signedIn) {
      const body = (route.request().postDataJSON() ?? {}) as Record<
        string,
        unknown
      >;
      const challenge = {
        ...body,
        id: "c-created-1",
        owner_id: (options.admin ? ADMIN_USER : TEST_USER).id,
        created_at: "2026-02-01T09:00:00Z",
        updated_at: "2026-02-01T09:00:00Z",
      };
      created.push(challenge);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(challenge),
      });
      return;
    }

    // The single-challenge read that follows a create. Registered after the list
    // route, and keyed on a path segment, so `/api/challenges` itself is
    // unaffected.
    if (method === "GET" && url.pathname.startsWith("/api/challenges/")) {
      const id = url.pathname.slice("/api/challenges/".length);
      const found =
        created.find((c) => c.id === id) ??
        challenges.find((c) => c.id === id) ?? null;
      if (!found) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Challenge not found (e2e mock)" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(found),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/auth/me") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Not authenticated" }),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/submissions/stats" && signedIn) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: CHALLENGE_STATS }),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/submissions" && signedIn) {
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("page_size") ?? "10");
      const start = (pageNumber - 1) * pageSize;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: SUBMISSIONS.slice(start, start + pageSize),
          total: SUBMISSIONS.length,
          page: pageNumber,
          page_size: pageSize,
          pages: 1,
        }),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/challenges") {
      const difficulty = url.searchParams.get("difficulty");
      const search = url.searchParams.get("search") ?? "";
      let items = challenges;
      if (difficulty) {
        items = items.filter((c) => c.difficulty === difficulty);
      }
      if (search) {
        items = items.filter((c) =>
          c.title.toLowerCase().includes(search.toLowerCase()),
        );
      }
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("page_size") ?? "12");
      const start = (pageNumber - 1) * pageSize;
      const slice = items.slice(start, start + pageSize);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: slice,
          total: items.length,
          page: pageNumber,
          page_size: pageSize,
          pages: Math.max(1, Math.ceil(items.length / pageSize)),
        }),
      });
      return;
    }

    // Anything else fails loudly instead of reaching the (absent) backend.
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not found (e2e mock)" }),
    });
  });
}
