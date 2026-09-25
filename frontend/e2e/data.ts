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
 * Intercepts every `/api/**` request and fulfills it with canned data.
 *
 * Handles the endpoints the surfaced pages actually call:
 * - POST /api/auth/login   → 200 (or 401 for `WRONG_PASSWORD`)
 * - POST /api/auth/register → 201 AuthResponse
 * - GET  /api/auth/me      → 401 (no token is seeded by these tests)
 * - GET  /api/challenges   → paginated list, honoring `difficulty`/`search`
 * - GET  /api/admin/users  → paginated list (only with `{ admin: true }`)
 */
export async function mockApi(
  page: Page,
  challenges: typeof CHALLENGES = CHALLENGES,
  options: { admin?: boolean } = {},
): Promise<void> {
  if (options.admin) {
    // `AdminRoute` needs an authenticated admin before it renders anything, and
    // the API client reads the token straight out of localStorage.
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

    if (method === "GET" && url.pathname === "/api/auth/me" && options.admin) {
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

    if (method === "GET" && url.pathname === "/api/auth/me") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Not authenticated" }),
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
