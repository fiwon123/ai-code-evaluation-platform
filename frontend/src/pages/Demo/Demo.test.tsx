import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Demo from "./Demo.tsx";
import { useSubmissionSocket } from "../../hooks/useSubmissionSocket.ts";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, submissionsApi } from "../../services/api.ts";

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  challengesApi: { list: vi.fn() },
  submissionsApi: { create: vi.fn(), get: vi.fn() },
  getToken: vi.fn(() => null),
  ApiError: class ApiError extends Error {
    status: number;
    detail: string;
    validationErrors?: Record<string, string>;
    constructor(status: number, detail: string) {
      super(detail);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  },
}));
vi.mock("../../hooks/useSubmissionSocket.ts", () => ({
  useSubmissionSocket: vi.fn(() => ({
    liveSubmission: null,
    state: "closed",
  })),
}));


const mockUseSubmissionSocket = vi.mocked(useSubmissionSocket);
const mockUseAuth = vi.mocked(useAuth);
const mockList = vi.mocked(challengesApi.list);
const mockCreate = vi.mocked(submissionsApi.create);
const mockGet = vi.mocked(submissionsApi.get);

const loggedInAuth = () => ({
  user: {
    id: "u1",
    email: "alice@example.com",
    username: "alice",
    is_admin: false,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  token: "t",
  initializing: false,
  login: vi.fn(),
  register: vi.fn(),
logout: vi.fn(),
  loginWithOAuth: vi.fn(),
});

const pythonChallenge = {
  id: "py1",
  title: "Two Sum",
  description: "Find two numbers that add up to the target.",
  prompt: "Write a function two_sum(nums, target).",
  test_code:
    "from solution import two_sum\n\n" +
    "def test_basic():\n" +
    "    assert two_sum([2, 7, 11, 15], 9) == [0, 1]",
  language: "python",
  difficulty: "easy",
  owner_id: "owner",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const goChallenge = {
  id: "go1",
  title: "Longest Common Prefix",
  description: "Return the longest common prefix of a list of strings.",
  prompt: "Write a Go function LongestCommonPrefix(strs []string) string.",
  test_code:
    "package main\n\nimport \"testing\"\n\n" +
    'func TestLongestCommonPrefix(t *testing.T) {\n\tgot := LongestCommonPrefix([]string{"flower", "flow", "flight"})\n\tif got != "fl" {\n\t\tt.Errorf("expected fl, got %q", got)\n\t}\n}',
  language: "go",
  difficulty: "medium",
  owner_id: "owner",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const jsChallenge = {
  id: "js1",
  title: "Valid Parentheses",
  description: "Check that brackets in a string are balanced.",
  prompt: "Write a JS function validParentheses(s).",
  test_code:
    "const { validParentheses } = require('./solution.js');\n" +
    "test('balanced', () => {\n" +
    "  assert.equal(validParentheses('()[]{}'), true);\n" +
    "});",
  language: "javascript",
  difficulty: "medium",
  owner_id: "owner",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Demo />} />
        <Route path="/register" element={<p>Register page</p>} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Demo page preview", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      loginWithOAuth: vi.fn(),
    });
    mockUseSubmissionSocket.mockReturnValue({
      liveSubmission: null,
      state: "closed",
    });
    mockList.mockResolvedValue({
      items: [pythonChallenge, goChallenge, jsChallenge],
      total: 3,
      page: 1,
      page_size: 50,
      pages: 1,
    } as never);
  });

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

  it("shows what will run for the selected challenge without an account", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "What will run" }),
    ).toBeInTheDocument();

    // Description + prompt of the default (first) challenge.
    expect(
      screen.getByText(/Find two numbers that add up to the target/),
    ).toBeInTheDocument();
    expect(screen.getByText("Write a function two_sum(nums, target).")).toBeInTheDocument();

    // The actual test suite, with its inputs and expected outputs.
    expect(
      screen.getByText(/assert two_sum\(\[2, 7, 11, 15\], 9\) == \[0, 1\]/),
    ).toBeInTheDocument();

    // Runner metadata mirrors the backend sandbox configuration. The meta
    // line is split across <code> children, so match each leaf separately.
    expect(screen.getByText("pytest")).toBeInTheDocument();
    expect(screen.getAllByText("test_solution.py").length).toBeGreaterThan(0);
    expect(screen.getByText("solution.py")).toBeInTheDocument();

    // Guests get the sign-in wall instead of the runner controls — the
    // honest replacement for the old silent bounce to /register.
    expect(
      screen.getByRole("heading", { name: "Sign in to run the live demo" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Generate & evaluate/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/login");
  });

  it("does not flash the sign-in wall while the session is initializing", async () => {
    mockUseAuth.mockReturnValue({
      ...loggedInAuth(),
      user: null,
      initializing: true,
    });
    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    // Auth is unresolved, so the runner controls are shown (button disabled)
    // rather than a wall that would vanish a moment later.
    expect(
      screen.queryByRole("heading", { name: "Sign in to run the live demo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Generate & evaluate/ }),
    ).toBeDisabled();
  });

  it("updates the preview when a different language is selected", async () => {
    mockUseAuth.mockReturnValue(loggedInAuth());
    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    fireEvent.change(screen.getByLabelText(/Demo challenge/i), {
      target: { value: "go1" },
    });

    expect(
      await screen.findByText(/Return the longest common prefix of a list of strings/),
    ).toBeInTheDocument();
    expect(screen.getByText("go test")).toBeInTheDocument();
    expect(screen.getAllByText("solution_test.go").length).toBeGreaterThan(0);
    expect(screen.getByText("solution.go")).toBeInTheDocument();
    expect(screen.queryByText("pytest")).not.toBeInTheDocument();
  });

  it("moves the preview when a keyword chip is clicked", async () => {
    mockUseAuth.mockReturnValue(loggedInAuth());
    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    fireEvent.click(screen.getByRole("button", { name: /valid parentheses/i }));

    expect(
      await screen.findByText(/Check that brackets in a string are balanced/),
    ).toBeInTheDocument();
    expect(screen.getByText("node --test")).toBeInTheDocument();
    expect(screen.getAllByText("test_solution.js").length).toBeGreaterThan(0);
    expect(screen.queryByText("pytest")).not.toBeInTheDocument();
  });

  it("sends guests to the demo page after they sign in from the wall", async () => {
    renderPage();
    const heading = await screen.findByRole("heading", {
      name: "Sign in to run the live demo",
    });
    expect(heading).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Sign in" }));

    expect(await screen.findByText("Login page")).toBeInTheDocument();
  });

  it("tells a logged-in user how long the run takes while generating", async () => {
    mockUseAuth.mockReturnValue(loggedInAuth());
    mockCreate.mockResolvedValue({
      id: "s1",
      challenge_id: "py1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
    } as never);

    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    expect(
      await screen.findByText(/usually takes 10–30 seconds/),
    ).toBeInTheDocument();
    expect(screen.getByText(/updates automatically/)).toBeInTheDocument();
  });

  it("shows run feedback directly under the controls, above the preview", async () => {
    mockUseAuth.mockReturnValue(loggedInAuth());
    mockCreate.mockResolvedValue({
      id: "s1",
      challenge_id: "py1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
    } as never);

    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    const pending = await screen.findByText(/usually takes 10–30 seconds/);
    const preview = screen.getByRole("heading", { name: "What will run" });
    // The pending message must sit ABOVE the preview panel (and therefore
    // directly below the dropdown + Generate button row).
    expect(
      pending.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the busy-server message after the run times out", async () => {
    mockUseAuth.mockReturnValue(loggedInAuth());
    mockCreate.mockResolvedValue({
      id: "s1",
      challenge_id: "py1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
    } as never);
    mockGet.mockResolvedValue({
      id: "s1",
      challenge_id: "py1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
    } as never);

    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    // Switch to a fake clock only after the initial (microtask) load, so the
    // 60s timeout fires on demand instead of waiting in real time.
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    // create() resolves on a microtask — flush it; no timers are involved.
    await act(async () => {});
    expect(screen.getByText(/usually takes 10–30 seconds/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(60_000));

    expect(
      screen.getByText(/didn't finish in time — the server may be busy/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Celery|worker/i, { exact: false }),
    ).not.toBeInTheDocument();
    // The error renders above the preview (directly under the run controls).
    const preview = screen.getByRole("heading", { name: "What will run" });
    const error = screen.getByRole("alert");
    expect(
      error.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the live pipeline phase and elapsed time while generating", async () => {
    mockUseAuth.mockReturnValue(loggedInAuth());
    mockUseSubmissionSocket.mockReturnValue({
      liveSubmission: {
        id: "s1",
        challenge_id: "py1",
        status: "processing",
        phase: "testing",
        provider: "demo",
        code: null,
        score: null,
        evaluation_result: null,
        started_at: "2026-01-01T00:00:05Z",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:10Z",
      },
      state: "open",
    } as never);
    mockCreate.mockResolvedValue({
      id: "s1",
      challenge_id: "py1",
      status: "processing",
      phase: "testing",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      started_at: "2026-01-01T00:00:05Z",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:10Z",
    } as never);

    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    expect(
      await screen.findByText(/Running tests….*elapsed/, { selector: "[role=status]" }),
    ).toBeInTheDocument();
  });

  it("shows per-test breakdown rows and the language runner chip after completion", async () => {
    mockUseAuth.mockReturnValue(loggedInAuth());
    mockCreate.mockResolvedValue({
      id: "s1",
      challenge_id: "py1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    } as never);
    mockGet.mockResolvedValue({
      id: "s1",
      challenge_id: "py1",
      status: "completed",
      provider: "demo",
      code: "def two_sum(nums, target):\n  pass",
      score: 88,
      evaluation_result: {
        score: 88,
        passed_tests: 2,
        total_tests: 3,
        test_results: [
          { name: "test_two_sum_basic", passed: true },
          { name: "test_two_sum_duplicates", passed: true },
          { name: "test_two_sum_unsorted", passed: false, message: "expected [0,1]" },
        ],
      },
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:10Z",
    } as never);

    renderPage();
    await screen.findByRole("heading", { name: "What will run" });

    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    expect(
      await screen.findByRole("img", { name: "Score 88 / 100" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Per-test breakdown" }),
    ).toBeInTheDocument();
    expect(screen.getByText("test_two_sum_basic")).toBeInTheDocument();
    expect(screen.getByText("test_two_sum_unsorted")).toBeInTheDocument();
    expect(screen.getByText(/runs with/)).toBeInTheDocument();
  });
});
