import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChallengeDetail from "../ChallengeDetail.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, modelsApi, submissionsApi } from "../../services/api.ts";
import { ToastProvider } from "../../components/Toast/ToastContext.tsx";
import { COMPARE_POLL_MS, POLL_MAX_INTERVAL_MS } from "../../constants/polling.ts";
import { SEVERE_DELAY_AFTER_MS } from "../../utils/formatting.ts";

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
  modelsApi: { list: vi.fn() },
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
const mockModelsList = vi.mocked(modelsApi.list);

// Trimmed catalog mirroring backend/src/app/services/llm_models.py.
const modelCatalog = [
  { id: "mock-coder", provider: "demo", label: "Mock Coder", description: "Free sentinel", is_default: true },
  { id: "gpt-4o-mini", provider: "openai", label: "GPT-4o Mini", description: "Fast", is_default: true },
  { id: "gpt-4o", provider: "openai", label: "GPT-4o", description: "Strong", is_default: false },
  { id: "claude-3-5-haiku-latest", provider: "anthropic", label: "Claude 3.5 Haiku", description: "Fast", is_default: true },
];

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

// Frozen clock for the fake-timer tests. Pinned so elapsed-time comparisons
// ("how long has this run been in flight?") are exact instead of wall-clock.
const BASE_TIME = new Date("2026-01-01T00:00:00Z");

/**
 * A tick long enough to land the *next* poll no matter where the backoff is.
 *
 * The comparison poll grows its interval, so a COMPARE_POLL_MS tick reaches a
 * poll only while the loop is still at the base cadence. Anywhere else it
 * advances the clock without firing anything, and an assertion after it passes
 * for the wrong reason — the same vacuous check as no check at all.
 */
const PAST_CAP_TICK_MS = POLL_MAX_INTERVAL_MS + COMPARE_POLL_MS;

/**
 * Drains pending microtasks so mount effects resolve and their state updates
 * are flushed. The `findBy`/`waitFor` queries are unusable while timers are
 * mocked (they wait on real timers), so fake-timer tests flush explicitly.
 */
async function flush() {
  await act(async () => {});
}

/**
 * Advances the mocked clock inside act, so every state update the advance
 * triggers — and every effect it re-schedules — is flushed before the call
 * returns. Asserting straight after a bare `advanceTimersByTimeAsync` instead
 * races React's scheduler: the update is queued but not yet rendered, and the
 * assertion observes the pre-update DOM whenever the machine is busy.
 */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
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
    mockModelsList.mockResolvedValue(modelCatalog as never);
    mockSubmissionsComparison.mockResolvedValue({
      challenge_id: "c1",
      entries: [],
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Restored here, not at the tail of the fake-timer test: a failure or
    // timeout partway through would otherwise leave the mocked clock armed for
    // every test that follows in this file.
    vi.useRealTimers();
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

  it("lists the selected provider's models in the dropdown", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    // Demo is the default provider → its single model, flagged as default.
    const demoSelect = await screen.findByLabelText("Model");
    expect(demoSelect).toHaveValue("");
    expect(screen.getByRole("option", { name: "Provider default — mock-coder" })).toBeInTheDocument();

    // Switching providers swaps the option set.
    fireEvent.click(screen.getByRole("radio", { name: /OpenAI/ }));
    const openaiSelect = await screen.findByLabelText("Model");
    expect(screen.getByRole("option", { name: "Provider default — gpt-4o-mini" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "GPT-4o — gpt-4o" })).toBeInTheDocument();
    // Demo models are gone once the provider changes.
    expect(screen.queryByRole("option", { name: "Provider default — mock-coder" })).not.toBeInTheDocument();
    expect(openaiSelect).toHaveValue("");
  });

  it("sends the selected model with the submission", async () => {
    const navigate = vi.fn();
    mockNavigate.mockReturnValue(navigate);
    mockSubmissionsCreate.mockResolvedValue(submission as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    fireEvent.click(screen.getByRole("radio", { name: /OpenAI/ }));
    fireEvent.change(await screen.findByLabelText("API key"), {
      target: { value: "sk-test-123" },
    });
    fireEvent.change(await screen.findByLabelText("Model"), {
      target: { value: "gpt-4o" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    await waitFor(() => {
      expect(mockSubmissionsCreate).toHaveBeenCalledWith({
        challenge_id: "c1",
        provider: "openai",
        api_key: "sk-test-123",
        model: "gpt-4o",
      });
    });
    expect(navigate).toHaveBeenCalledWith("/submissions/s1");
  });

  it("resets the model selection when the provider changes", async () => {
    mockSubmissionsCreate.mockResolvedValue(submission as never);

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });

    fireEvent.click(screen.getByRole("radio", { name: /OpenAI/ }));
    fireEvent.change(await screen.findByLabelText("Model"), {
      target: { value: "gpt-4o" },
    });
    expect(screen.getByLabelText("Model")).toHaveValue("gpt-4o");

    // Back to demo — the openai-only pick must reset to the default.
    fireEvent.click(screen.getByRole("radio", { name: /Demo/ }));
    expect(await screen.findByLabelText("Model")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));
    await waitFor(() => {
      expect(mockSubmissionsCreate).toHaveBeenCalledWith({
        challenge_id: "c1",
        provider: "demo",
      });
    });
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
    // Anthropic + gemini + groq + ollama have no runs → placeholder cards.
    expect(screen.getAllByText("No runs yet.")).toHaveLength(4);
  });

  it("shows placeholder cards when nothing has run", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });
    await screen.findByText("Compare providers");
    // All six providers are listed with a run affordance.
    expect(screen.getAllByText("No runs yet.")).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: "Run" })).toHaveLength(6);
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
    vi.setSystemTime(BASE_TIME);
    mockSubmissionsCreate.mockResolvedValue(submission as never);
    // The leaderboard never advances for demo → the run is effectively lost.
    mockSubmissionsComparison.mockResolvedValue({
      challenge_id: "c1",
      entries: [],
    } as never);

    renderPage();
    // Mount effects resolve on microtasks — flush them (see `flush`).
    await flush();
    await flush();
    expect(screen.getByRole("heading", { name: "Two Sum" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    await flush();
    expect(mockSubmissionsCreate).toHaveBeenCalledWith({
      challenge_id: "c1",
      provider: "demo",
    });
    // Enter the running state — an in-flight counter + Running badge render.
    await flush();
    expect(screen.getByText("Running…")).toBeInTheDocument();

    // The poll loop is live, so it — not the clock alone — is what notices the
    // elapsed window below. Without this the give-up could pass for a reason
    // that has nothing to do with the poll loop being alive.
    const callsBeforeTick = mockSubmissionsComparison.mock.calls.length;
    await tick(PAST_CAP_TICK_MS);
    expect(mockSubmissionsComparison.mock.calls.length).toBeGreaterThan(
      callsBeforeTick,
    );

    // Ten minutes elapse with no result. Jump the clock instead of advancing
    // 400 poll cycles one timer at a time: the loop compares elapsed wall time,
    // not tick counts, so the same stimulus costs a single poll — and each
    // yielded timer burns a real event-loop turn, which is what made this test
    // time out (rather than fail) once the suite loaded the machine.
    vi.setSystemTime(
      new Date(BASE_TIME.getTime() + SEVERE_DELAY_AFTER_MS + 1_000),
    );
    // One further poll is all the loop needs to see the window has passed — but
    // the interval has backed off past the base cadence by now, so the tick has
    // to outlast the cap to reach the next poll. A COMPARE_POLL_MS tick would
    // silently prove nothing.
    await tick(PAST_CAP_TICK_MS);

    // The provider is dropped and shows a "no result" state.
    expect(screen.getByText("No result")).toBeInTheDocument();
    expect(screen.getByText(/Took too long/)).toBeInTheDocument();

    // …and polling has stopped, so the leaderboard can't poll forever on a
    // silently lost evaluation. The span has to exceed the backoff cap: a
    // window shorter than the longest interval would see zero calls even if
    // the loop were alive, which is the same vacuous assertion as no assertion.
    const callsAtGiveUp = mockSubmissionsComparison.mock.calls.length;
    await tick(3 * POLL_MAX_INTERVAL_MS);
    expect(mockSubmissionsComparison.mock.calls.length).toBe(callsAtGiveUp);
  });

  it("backs the comparison poll off instead of hammering it flat for the whole window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    mockSubmissionsCreate.mockResolvedValue(submission as never);
    // The leaderboard never advances → nothing ever completes, which is
    // exactly the case that used to cost ~400 requests.
    const polledAt: number[] = [];
    mockSubmissionsComparison.mockImplementation(async () => {
      polledAt.push(Date.now());
      return { challenge_id: "c1", entries: [] };
    });

    renderPage();
    await flush();
    await flush();
    expect(screen.getByRole("heading", { name: "Two Sum" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    await flush();
    expect(mockSubmissionsCreate).toHaveBeenCalled();

    await tick(60_000);

    // The gaps between polls are the real invariant — the total count is a
    // consequence. Assert both, and derive the gaps from the clock the poll
    // actually observed rather than from the call count.
    const gaps = polledAt.slice(1).map((at, i) => at - polledAt[i]);
    expect(gaps.length).toBeGreaterThan(2);
    // Grows: strictly increasing while no run completes.
    expect(gaps[1]).toBeGreaterThan(gaps[0]);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0]);
    // Capped: no gap exceeds the ceiling, so a broken "cap" cannot pass as
    // "grows nicely".
    expect(Math.max(...gaps)).toBeLessThanOrEqual(POLL_MAX_INTERVAL_MS);
    // Budget: a flat COMPARE_POLL_MS would be 40 requests in this window.
    const flat = 60_000 / COMPARE_POLL_MS;
    expect(polledAt.length).toBeLessThan(flat / 2);
    // …and the audit guard: a loop that stopped entirely would also satisfy the
    // budget above, so require that polling is demonstrably still alive.
    expect(polledAt.length).toBeGreaterThan(2);
  });

  it("keeps polling a doomed run after one failed request, and clears the error on recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    mockSubmissionsCreate.mockResolvedValue(submission as never);
    // Call 1 is the mount load (nothing in flight yet); call 2 is the first
    // poll after the run is submitted, and that one fails. The leaderboard
    // never advances either way, so the run is doomed and the loop is the only
    // thing under test.
    let calls = 0;
    mockSubmissionsComparison.mockImplementation(async () => {
      calls += 1;
      if (calls === 2) {
        throw new Error("network unreachable");
      }
      return { challenge_id: "c1", entries: [] };
    });

    renderPage();
    await flush();
    await flush();
    expect(screen.getByRole("heading", { name: "Two Sum" })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    // The failing poll lands here, while the run is in flight: the error is
    // shown…
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(/network unreachable/);

    // …and the loop keeps going instead of being retired by the first error.
    // Before the fix the count was frozen here for the rest of the run, the
    // card stayed on "Running…" and the give-up state was unreachable.
    const callsAfterFailure = mockSubmissionsComparison.mock.calls.length;
    await tick(60_000);
    expect(mockSubmissionsComparison.mock.calls.length).toBeGreaterThan(
      callsAfterFailure,
    );
    // A successful poll clears the error, so a blip does not leave a stale
    // message pinned above a healthy leaderboard.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps tracking a provider launched while the poll is already running (#258)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    mockSubmissionsCreate.mockResolvedValue(submission as never);
    const polledAt: number[] = [];
    // ollama already has a run, so its card shows the "Running…" badge once
    // re-run (a first-ever run records runsBefore = 0, and Boolean(0) hides the
    // badge — a separate quirk this test must not lean on). demo starts with
    // none. Nothing completes until poll 4, when demo lands.
    let polls = 0;
    const COMPLETES_AT = 4;
    const ollamaEntry = {
      provider: "ollama",
      runs: 1,
      score: 50,
      passed_tests: 1,
      total_tests: 2,
      duration_ms: 900,
      last_run_at: BASE_TIME.toISOString(),
    };
    mockSubmissionsComparison.mockImplementation(async () => {
      polledAt.push(Date.now());
      polls += 1;
      const entries =
        polls < COMPLETES_AT
          ? [ollamaEntry]
          : [
              ollamaEntry,
              {
                provider: "demo",
                runs: 1,
                score: 100,
                passed_tests: 3,
                total_tests: 3,
                duration_ms: 1200,
                last_run_at: BASE_TIME.toISOString(),
              },
            ];
      return { challenge_id: "c1", entries };
    });

    renderPage();
    await flush();
    await flush();
    expect(screen.getByRole("heading", { name: "Two Sum" })).toBeInTheDocument();

    // ollama already has a run, so its affordance reads "Re-run" (and its card
    // will show the "Running…" badge once re-run, because runsBefore is then
    // non-zero). demo has none, so its button reads "Run" and is the first of
    // the five keyless-free providers.
    fireEvent.click(screen.getAllByRole("button", { name: "Run" })[0]);
    await flush();
    // The second provider joins a loop that is already running — the case a
    // closure snapshot of the in-flight map cannot see.
    fireEvent.click(screen.getByRole("button", { name: "Re-run" }));
    await flush();

    // Two "Running…" texts while both are in flight: ollama's card badge plus
    // the "Run all providers" button in its loading state.
    expect(screen.getAllByText("Running…")).toHaveLength(2);

    await tick(60_000);

    // demo finished, ollama has not, so the count is unchanged. With a stale
    // snapshot the loop dropped *both*, reported nothing in flight and stopped
    // polling — the live state for a genuinely running evaluation.
    expect(screen.getAllByText("Running…")).toHaveLength(2);
    // …and the loop is still alive for the remaining provider.
    const callsAtCompletion = polledAt.length;
    await tick(30_000);
    expect(polledAt.length).toBeGreaterThan(callsAtCompletion);
  });

  it("restores the fast cadence when a run completes while another is still in flight", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
    mockSubmissionsCreate.mockResolvedValue(submission as never);
    const polledAt: number[] = [];
    // Two keyless providers are launched (demo + ollama), so one can complete
    // while the other keeps the loop alive — that is the only way to observe the
    // cadence *reset*. When the last provider finishes the loop simply stops,
    // which proves nothing about a reset.
    let polls = 0;
    const COMPLETES_AT = 6;
    mockSubmissionsComparison.mockImplementation(async () => {
      polledAt.push(Date.now());
      polls += 1;
      if (polls < COMPLETES_AT) {
        return { challenge_id: "c1", entries: [] };
      }
      return {
        challenge_id: "c1",
        entries: [
          {
            provider: "demo",
            runs: 1,
            score: 100,
            passed_tests: 3,
            total_tests: 3,
            duration_ms: 1200,
            last_run_at: BASE_TIME.toISOString(),
          },
        ],
      };
    });

    renderPage();
    await flush();
    await flush();
    expect(screen.getByRole("heading", { name: "Two Sum" })).toBeInTheDocument();

    // Both "Run" buttons that need no API key: demo (first) and ollama (last).
    const runButtons = screen.getAllByRole("button", { name: "Run" });
    fireEvent.click(runButtons[0]);
    await flush();
    fireEvent.click(runButtons[5]);
    await flush();
    expect(mockSubmissionsCreate.mock.calls.map((c) => c[0].provider)).toEqual([
      "demo",
      "ollama",
    ]);

    await tick(60_000);

    // The interval had backed off to the cap by the time demo landed…
    const beforeCompletion = polledAt[COMPLETES_AT - 1] - polledAt[COMPLETES_AT - 2];
    expect(beforeCompletion).toBe(POLL_MAX_INTERVAL_MS);
    // …so the next poll being back at the base cadence is a genuine reset.
    // Without it, a run that completes while another is still going waits out
    // the backoff it no longer needs, and its row appears up to 10s late.
    expect(polledAt[COMPLETES_AT] - polledAt[COMPLETES_AT - 1]).toBe(
      COMPARE_POLL_MS,
    );
    // The loop is genuinely still alive afterwards — the audit guard that stops
    // a dead loop from passing the two assertions above.
    expect(polledAt.length).toBeGreaterThan(COMPLETES_AT + 1);
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