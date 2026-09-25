import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChallengeDetail from "../ChallengeDetail.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, submissionsApi } from "../../services/api.ts";
import { ToastProvider } from "../../components/Toast/ToastContext.tsx";

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: vi.fn() };
});

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  challengesApi: { get: vi.fn(), remove: vi.fn() },
  submissionsApi: { create: vi.fn(), comparison: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  },
}));

const mockUseAuth = vi.mocked(useAuth);
const mockNavigate = vi.mocked(useNavigate);
const mockChallengesGet = vi.mocked(challengesApi.get);
const mockChallengesRemove = vi.mocked(challengesApi.remove);
const mockSubmissionsCreate = vi.mocked(submissionsApi.create);
const mockSubmissionsComparison = vi.mocked(submissionsApi.comparison);

const challenge = {
  id: "c1",
  title: "Two Sum",
  description: "Find indices summing to target",
  prompt: "Write a function two_sum(nums, target)",
  test_code: "from solution import two_sum",
  language: "python",
  owner_id: "u1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const submission = {
  id: "s1",
  challenge_id: "c1",
  status: "pending",
  provider: "demo",
  code: null,
  score: null,
  evaluation_result: null,
  created_at: "2026-01-01T00:00:00Z",
};

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/challenges/c1"]}>
        <Routes>
          <Route path="/challenges/:id" element={<ChallengeDetail />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe("ChallengeDetail", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.co", username: "alice", is_admin: false, is_active: true, created_at: "" },
      token: "t",
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      loginWithOAuth: vi.fn(),
    });
    mockChallengesGet.mockResolvedValue(challenge as never);
    mockNavigate.mockReturnValue(vi.fn());
    mockSubmissionsComparison.mockResolvedValue({
      challenge_id: "c1",
      entries: [],
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the challenge details", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Two Sum" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Find indices summing to target/)).toBeInTheDocument();
  });

  it("links to the edit page for owners", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });
    expect(
      screen.getByRole("link", { name: "Edit challenge" }),
    ).toHaveAttribute("href", "/challenges/c1/edit");
  });

  it("submits an evaluation and navigates to the result", async () => {
    const navigate = vi.fn();
    mockNavigate.mockReturnValue(navigate);
    mockSubmissionsCreate.mockResolvedValue(submission as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    fireEvent.click(screen.getByRole("radio", { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "sk-test-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    await waitFor(() => {
      expect(mockSubmissionsCreate).toHaveBeenCalledWith({
        challenge_id: "c1",
        provider: "openai",
        api_key: "sk-test-123",
      });
    });
    expect(navigate).toHaveBeenCalledWith("/submissions/s1");
  });

  it("requires an API key before submitting to key-required providers", async () => {
    mockSubmissionsCreate.mockResolvedValue(submission as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    fireEvent.click(screen.getByRole("radio", { name: /Anthropic/ }));
    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Enter your Anthropic API key/,
    );
    expect(mockSubmissionsCreate).not.toHaveBeenCalled();
  });

  it("does not send an api_key for the demo provider", async () => {
    mockSubmissionsCreate.mockResolvedValue(submission as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    await waitFor(() => {
      expect(mockSubmissionsCreate).toHaveBeenCalledWith({
        challenge_id: "c1",
        provider: "demo",
      });
    });
  });

  it("shows the login link when unauthenticated", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      loginWithOAuth: vi.fn(),
    });

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });
    expect(screen.getByRole("link", { name: /Log in/ })).toBeInTheDocument();
    // Comparison panel is auth-only.
    expect(screen.queryByText("Compare providers")).not.toBeInTheDocument();
  });

  it("renders the provider leaderboard with a best badge", async () => {
    mockSubmissionsComparison.mockResolvedValue({
      challenge_id: "c1",
      entries: [
        {
          provider: "demo",
          runs: 2,
          score: 90,
          passed_tests: 4,
          total_tests: 4,
          duration_ms: 1200,
          last_run_at: "2026-01-01T00:00:00Z",
        },
        {
          provider: "openai",
          runs: 1,
          score: 100,
          passed_tests: 2,
          total_tests: 2,
          duration_ms: 800,
          last_run_at: "2026-01-01T00:00:00Z",
        },
      ],
    } as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    expect(await screen.findByText("Compare providers")).toBeInTheDocument();
    expect(await screen.findByText("100%")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getAllByText("Best")).toHaveLength(1);
    expect(screen.getByText("avg over 2 runs")).toBeInTheDocument();
    // Anthropic + gemini + ollama have no runs → placeholder cards.
    expect(screen.getAllByText("No runs yet.")).toHaveLength(3);
  });

  it("shows placeholder cards when nothing has run", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });
    await screen.findByText("Compare providers");
    // All five providers are listed with a run affordance.
    expect(screen.getAllByText("No runs yet.")).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: "Run" })).toHaveLength(5);
  });

  it("runs the demo provider from the comparison panel", async () => {
    mockSubmissionsCreate.mockResolvedValue(submission as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });
    await screen.findByText("Compare providers");

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);

    await waitFor(() => {
      expect(mockSubmissionsCreate).toHaveBeenCalledWith({
        challenge_id: "c1",
        provider: "demo",
      });
    });
  });

  it("gives up a provider that never produces a result past the severe-delay window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mockSubmissionsCreate.mockResolvedValue(submission as never);
    // The leaderboard never advances for demo → the run is effectively lost.
    mockSubmissionsComparison.mockResolvedValue({
      challenge_id: "c1",
      entries: [],
    } as never);

    renderPage();
    // Mount effects resolve on microtasks — flush them; findBy*/waitFor must
    // be avoided here because they wait on real timers, which are mocked.
    await act(async () => {});
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "Two Sum" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    await act(async () => {});
    expect(mockSubmissionsCreate).toHaveBeenCalledWith({
      challenge_id: "c1",
      provider: "demo",
    });
    // Enter the running state — an in-flight counter + Running badge render.
    await act(async () => {});
    expect(screen.getByText("Running…")).toBeInTheDocument();

    // Advance past the severe-delay window; the poll loop drops the provider
    // and terminates instead of polling forever.
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 2_000);
    expect(screen.getByText("No result")).toBeInTheDocument();
    expect(screen.getByText(/Took too long/)).toBeInTheDocument();

    const callsAtGiveUp = mockSubmissionsComparison.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    // Polling has stopped — no further comparison fetches despite big advance.
    expect(screen.getByText("No result")).toBeInTheDocument();
    expect(mockSubmissionsComparison.mock.calls.length).toBe(callsAtGiveUp);
    vi.useRealTimers();
  });

  it("requires an API key when running a keyed provider from the panel", async () => {
    mockSubmissionsCreate.mockResolvedValue(submission as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });
    await screen.findByText("Compare providers");

    // Third card is Anthropic (requires a key; none entered).
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[2]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Enter your Anthropic API key/,
    );
    expect(mockSubmissionsCreate).not.toHaveBeenCalled();
  });

  it("surfaces submission errors", async () => {
    mockSubmissionsCreate.mockRejectedValue(
      Object.assign(new Error("LLM provider unavailable"), {
        name: "ApiError",
        status: 500,
      }),
    );

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "LLM provider unavailable",
    );
  });

  it("deletes the challenge through the confirm dialog", async () => {
    const navigate = vi.fn();
    mockNavigate.mockReturnValue(navigate);
    mockChallengesGet.mockResolvedValue(challenge as never);
    mockChallengesRemove.mockResolvedValue(undefined);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    fireEvent.click(screen.getByRole("button", { name: /Delete challenge/ }));
    expect(
      screen.getByRole("dialog", { name: "Delete challenge?" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockChallengesRemove).toHaveBeenCalledWith("c1");
    });
    expect(navigate).toHaveBeenCalledWith("/challenges");
  });
});