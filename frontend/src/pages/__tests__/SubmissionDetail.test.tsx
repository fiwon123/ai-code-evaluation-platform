import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubmissionDetail from "../SubmissionDetail.tsx";
import { clearToken, setToken } from "../../services/api.ts";
import { POLL_MAX_INTERVAL_MS } from "../../constants/polling.ts";

const fetchMock = vi.fn();

/** Minimal WebSocket double: the page only needs open/message/close. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }
  open() {
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  close() {
    this.onclose?.();
  }
  static latest(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
  static reset() {
    FakeWebSocket.instances = [];
  }
}

const processingSubmission = {
  id: "s1",
  challenge_id: "c1",
  status: "processing",
  provider: "demo",
  phase: "testing",
  code: null,
  score: null,
  evaluation_result: null,
  created_at: "2026-01-01T00:00:00Z",
};

const finishedSubmission = {
  id: "s1",
  challenge_id: "c1",
  status: "completed",
  provider: "demo",
  phase: null,
  code: "def two_sum(nums, target):\n    return [0, 1]\n",
  score: 100,
  evaluation_result: {
    id: "r1",
    passed_tests: 2,
    total_tests: 2,
    score: 100,
    logs: "2 passed in 0.01s",
    metrics: { language: "python", duration_ms: 12 },
    created_at: "2026-01-01T00:00:00Z",
  },
  created_at: "2026-01-01T00:00:00Z",
};

function renderPage(pollIntervalMs = 1) {
  return render(
    <MemoryRouter initialEntries={["/submissions/s1"]}>
      <Routes>
        <Route
          path="/submissions/:id"
          element={<SubmissionDetail pollIntervalMs={pollIntervalMs} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SubmissionDetail", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    clearToken();
    FakeWebSocket.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    clearToken();
  });

  /** Drains microtasks so mount effects and their state updates settle. */
  async function flush() {
    await act(async () => {});
  }

  /**
   * Advances the mocked clock inside act, so re-armed timers are flushed.
   *
   * The only way to assert "no further request" in this file. A `setTimeout`
   * sleep observes a quiet window, which is a statement about the machine's
   * load as much as about the code: 50ms is not a reliable window under a
   * parallel suite, and a slow machine makes the sleep *more* likely to catch a
   * spurious re-fetch, so the flake is biased towards false failures. Advancing
   * a clock nobody controls has no such failure direction (#330).
   */
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  // The fallback REST poll is the *only* live path when no WebSocket is
  // available (proxied deploys, the shared-result view), which is why the locks
  // below leave the token cleared: `useSubmissionSocket` then returns early and
  // the REST loop carries the page.
  describe("fallback poll cadence", () => {
    const BASE = new Date("2026-01-01T00:00:00Z");
    const BASE_POLL_MS = 1_000;

    function pendingFixture(overrides: Record<string, unknown> = {}) {
      return {
        id: "s1",
        challenge_id: "c1",
        status: "pending",
        phase: null,
        provider: "demo",
        code: null,
        score: null,
        evaluation_result: null,
        created_at: "2026-01-01T00:00:00Z",
        ...overrides,
      };
    }

    /** Wall-clock gaps between successive polls, measured inside the mock. */
    function trackPollTimes() {
      const at: number[] = [];
      fetchMock.mockImplementation(() => {
        at.push(Date.now());
        return Promise.resolve(
          new Response(JSON.stringify(pendingFixture()), { status: 200 }),
        );
      });
      return at;
    }

    function gapsOf(at: number[]): number[] {
      return at.slice(1).map((value, i) => value - at[i]);
    }

    it("backs off instead of polling flat while a submission is stuck", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(BASE);
      const at = trackPollTimes();

      renderPage(BASE_POLL_MS);
      await flush();
      expect(at.length).toBe(1);

      await tick(30_000);

      const gaps = gapsOf(at);
      // Grows while nothing changes…
      expect(gaps.length).toBeGreaterThan(2);
      expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0]);
      // …but never past the ceiling, so a missing cap cannot pass as growth.
      expect(Math.max(...gaps)).toBeLessThanOrEqual(POLL_MAX_INTERVAL_MS);
      // Budget: a flat base cadence is 30 requests in this window.
      expect(at.length).toBeLessThan(30 / 2);
      // Audit guard: a loop that simply died would also satisfy the budget.
      expect(at.length).toBeGreaterThan(2);
    });

    it("restores the base cadence when the status finally changes", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(BASE);
      // "pending" for the first CHANGE_AT polls, so the interval backs off all
      // the way to the cap; then it advances to "processing", which is the news
      // that must buy a fast re-check. Indexed by call number, not by clock
      // position — reasoning about "after 30s" broke the moment the schedule
      // changed, and silently measured the wrong pair of polls.
      const CHANGE_AT = 6;
      const calls: { t: number; status: string }[] = [];
      fetchMock.mockImplementation(() => {
        const status = calls.length + 1 >= CHANGE_AT ? "processing" : "pending";
        calls.push({ t: Date.now(), status });
        return Promise.resolve(
          new Response(
            JSON.stringify(pendingFixture({ status, phase: "testing" })),
            { status: 200 },
          ),
        );
      });

      renderPage(BASE_POLL_MS);
      await flush();
      await tick(30_000);

      // The pre-change gaps really did back off, so the reset below is a real
      // transition and not a schedule that never moved.
      const preGaps: number[] = [];
      for (let i = 1; i < CHANGE_AT; i += 1) {
        preGaps.push(calls[i].t - calls[i - 1].t);
      }
      expect(preGaps.length).toBeGreaterThan(1);
      expect(Math.max(...preGaps)).toBeGreaterThan(BASE_POLL_MS);
      expect(Math.max(...preGaps)).toBe(POLL_MAX_INTERVAL_MS);

      // The poll right after the status change is back at the base cadence.
      // Without the reset a progressing run waits out the backoff it no longer
      // needs, and a fast evaluation can look stalled.
      const changeIndex = CHANGE_AT - 1;
      expect(calls[changeIndex].status).toBe("processing");
      expect(calls[changeIndex + 1].t - calls[changeIndex].t).toBe(BASE_POLL_MS);
    });

    it("keeps polling after a failed request instead of freezing on stale state", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(BASE);
      let calls = 0;
      fetchMock.mockImplementation(() => {
        calls += 1;
        // The first *poll* fails (the mount load is the call before it), the
        // rest succeed and stay "pending" — a doomed run.
        if (calls === 2) {
          return Promise.resolve(new Response("nope", { status: 500 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify(pendingFixture()), { status: 200 }),
        );
      });

      renderPage(BASE_POLL_MS);
      await flush();
      // The mount load succeeded, so nothing is on screen yet; the failure is
      // the *next* poll, one interval in.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await tick(BASE_POLL_MS);
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // The loop is still going. Before the fix the count froze here: with no
      // socket to take over, the page sat on a stale "pending" until the user
      // reloaded.
      const afterFailure = fetchMock.mock.calls.length;
      await tick(30_000);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFailure);
      // Recovery clears the error rather than leaving it pinned.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not retry a failed initial load forever", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(BASE);
      fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

      renderPage(BASE_POLL_MS);
      await flush();
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // Nothing is known yet, so the error state is the honest answer — there
      // is no "in flight" submission to keep watching.
      const atFailure = fetchMock.mock.calls.length;
      await tick(3 * POLL_MAX_INTERVAL_MS);
      expect(fetchMock.mock.calls.length).toBe(atFailure);
    });
  });

  it("polls while processing, then shows the final report", async () => {
    const processing = {
      id: "s1",
      challenge_id: "c1",
      status: "processing",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    const completed = {
      id: "s1",
      challenge_id: "c1",
      status: "completed",
      provider: "demo",
      code: "def two_sum(nums, target):\n    return [0, 1]\n",
      score: 100,
      evaluation_result: {
        id: "r1",
        passed_tests: 2,
        total_tests: 2,
        score: 100,
        logs: "2 passed in 0.01s",
        metrics: { language: "python", duration_ms: 12 },
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(processing), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }));

    renderPage();

    // First fetch resolves to processing → auto re-fetch resolves to completed.
    expect(await screen.findByText("100%")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText(/def two_sum/)).toBeInTheDocument();
    // The recorded execution duration is promoted to a first-class stat.
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("12ms")).toBeInTheDocument();
    // Completed reports keep the secondary "Back to challenge" (no "Try again").
    expect(
      screen.getByRole("link", { name: "Back to challenge" }),
    ).toHaveAttribute("href", "/challenges/c1");
    expect(screen.queryByRole("link", { name: "Try again" })).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("renders the per-test breakdown with pass/fail rows and messages", async () => {
    const completed = {
      id: "s1",
      challenge_id: "c1",
      status: "completed",
      provider: "demo",
      code: "def two_sum(nums, target):\n    return [0, 1]\n",
      score: 50,
      language: "python",
      evaluation_result: {
        id: "r1",
        passed_tests: 1,
        total_tests: 2,
        score: 50,
        logs: "1 passed, 1 failed in 0.01s",
        metrics: { language: "python", duration_ms: 12 },
        test_results: [
          { name: "test_two_sum", passed: true, message: null },
          {
            name: "test_edge_case",
            passed: false,
            message: "assert [3, 3] == [1, 2]",
          },
        ],
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(completed), { status: 200 }),
    );

    renderPage(60000); // no re-poll — single completed response

    expect(await screen.findByText("Test results")).toBeInTheDocument();
    expect(screen.getByText("test_two_sum")).toBeInTheDocument();
    expect(screen.getByText("test_edge_case")).toBeInTheDocument();
    expect(screen.getByText("assert [3, 3] == [1, 2]")).toBeInTheDocument();
    // Score ring reflects the 50% score (danger bucket).
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Score 50 percent" })).toBeInTheDocument();
  });

  it("falls back to counts when no per-test breakdown exists", async () => {
    const completed = {
      id: "s1",
      challenge_id: "c1",
      status: "completed",
      provider: "demo",
      code: null,
      score: 100,
      evaluation_result: {
        id: "r1",
        passed_tests: 2,
        total_tests: 2,
        score: 100,
        logs: "2 passed in 0.01s",
        metrics: { language: "python" },
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(completed), { status: 200 }),
    );

    renderPage(60000);

    expect(await screen.findByText("Test results")).toBeInTheDocument();
    expect(
      screen.getByText(/No per-test breakdown was recorded/),
    ).toBeInTheDocument();
  });

  it("shows a live elapsed counter and an estimate while processing", async () => {
    const processing = {
      id: "s1",
      challenge_id: "c1",
      status: "processing",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: new Date(Date.now() - 12_000).toISOString(),
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(processing), { status: 200 }),
    );

    renderPage(60_000);

    expect(await screen.findByText(/Running your evaluation/i)).toBeInTheDocument();
    expect(screen.getByText(/Elapsed:/)).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
    expect(screen.getByText(/under a minute/)).toBeInTheDocument();
    expect(screen.getByText(/refreshes automatically/)).toBeInTheDocument();
    expect(screen.queryByText(/taking longer than usual/i)).not.toBeInTheDocument();
  });

  it("shows the generating phase while the LLM call is in flight", async () => {
    const generating = {
      id: "s1",
      challenge_id: "c1",
      status: "processing",
      phase: "generating",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
      started_at: new Date(Date.now() - 30_000).toISOString(),
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(generating), { status: 200 }),
    );

    renderPage(60_000);

    expect(await screen.findByText(/Generating code/i)).toBeInTheDocument();
    // The elapsed counter is measured from the run start, not the queue time.
    expect(screen.getByText(/30s/)).toBeInTheDocument();
    expect(screen.getByText(/started at/i)).toBeInTheDocument();
  });

  it("switches to the testing phase once code has been generated", async () => {
    const testing = {
      id: "s1",
      challenge_id: "c1",
      status: "processing",
      phase: "testing",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: new Date(Date.now() - 60_000).toISOString(),
      started_at: new Date(Date.now() - 20_000).toISOString(),
    };

    fetchMock.mockResolvedValue(new Response(JSON.stringify(testing), { status: 200 }));

    renderPage(60_000);

    expect(await screen.findByText(/Running tests/i)).toBeInTheDocument();
    // Processing phases never render the false-failure card.
    expect(screen.queryByText(/Evaluation failed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("mentions compilation for java evaluations", async () => {
    const processing = {
      id: "s1",
      challenge_id: "c1",
      status: "pending",
      language: "java",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: new Date().toISOString(),
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(processing), { status: 200 }),
    );

    renderPage(60_000);

    expect(await screen.findByText(/Waiting in the evaluation queue/i)).toBeInTheDocument();
    expect(screen.getByText(/up to ~2 minutes \(includes compilation\)/)).toBeInTheDocument();
  });

  it("warns when an in-progress submission has been running too long", async () => {
    const stale = {
      id: "s1",
      challenge_id: "c1",
      status: "processing",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    };

    fetchMock.mockResolvedValue(new Response(JSON.stringify(stale), { status: 200 }));

    renderPage(60_000);

    expect(await screen.findByText(/taking longer than usual/i)).toBeInTheDocument();
    expect(screen.getByText(/3m 0\d+s/)).toBeInTheDocument();
    // Warnings use user-friendly wording — no ops jargon.
    expect(screen.queryByText(/worker/i)).not.toBeInTheDocument();
  });

  it("escalates the warning for a pending submission stuck over 10 minutes", async () => {
    const severelyStuck = {
      id: "s1",
      challenge_id: "c1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: new Date(Date.now() - 11 * 60_000).toISOString(),
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(severelyStuck), { status: 200 }),
    );

    renderPage(60_000);

    expect(
      await screen.findByText(/waiting over 10 minutes/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/worker is likely offline/i)).toBeInTheDocument();
    expect(screen.getByText(/marked as failed automatically/i)).toBeInTheDocument();
    // The escalated message replaces the milder "taking longer than usual" one.
    expect(screen.queryByText(/taking longer than usual/i)).not.toBeInTheDocument();
  });

  it("keeps the milder warning for a pending submission under the severe threshold", async () => {
    const mildlyStuck = {
      id: "s1",
      challenge_id: "c1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    };

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(mildlyStuck), { status: 200 }),
    );

    renderPage(60_000);

    expect(
      await screen.findByText(/taking longer than usual/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/worker is likely offline/i)).not.toBeInTheDocument();
  });

  it("does not poll again once complete", async () => {
    const completed = {
      id: "s1",
      challenge_id: "c1",
      status: "completed",
      provider: "demo",
      code: "x = 1",
      score: 100,
      evaluation_result: {
        id: "r1",
        passed_tests: 1,
        total_tests: 1,
        score: 100,
        logs: "1 passed",
        metrics: {},
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };

    // A terminal submission, so the poll loop has nothing left to re-check.
    // Driven on a mocked clock rather than a 50ms sleep (#330): the sleep only
    // ever observed a quiet window, so the assertion could not tell "no poll is
    // scheduled" from "no poll fired within 50ms of this machine", and the
    // failure mode was biased towards false failures on a loaded machine.
    const POLL_MS = 1_000;
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(completed), { status: 200 }));

    renderPage(POLL_MS);
    await flush();
    expect(screen.getByText("100%")).toBeInTheDocument();

    // Five poll intervals with no movement in the count. A poll that had been
    // re-armed would fire on the first of them, so this says the loop retired
    // rather than merely going quiet.
    await tick(POLL_MS * 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders a failed submission", async () => {
    const failed = {
      id: "s1",
      challenge_id: "c1",
      status: "failed",
      provider: "demo",
      code: null,
      score: 0,
      evaluation_result: {
        id: "r1",
        passed_tests: 0,
        total_tests: 0,
        score: 0,
        logs: "Evaluation error: LLM down",
        metrics: { error: "LLM down" },
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };

    fetchMock.mockResolvedValue(new Response(JSON.stringify(failed), { status: 200 }));

    renderPage();

    expect((await screen.findAllByText("failed")).length).toBeGreaterThan(0);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect((await screen.findAllByText(/LLM down/)).length).toBeGreaterThan(0);
    // Failed reports offer a retry CTA back to the challenge.
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/challenges/c1",
    );
  });

  it("offers try again when a failed submission has no result", async () => {
    const failed = {
      id: "s1",
      challenge_id: "c1",
      status: "failed",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
    };

    fetchMock.mockResolvedValue(new Response(JSON.stringify(failed), { status: 200 }));

    renderPage(60_000);

    expect(
      await screen.findByText(/no result was produced/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/challenges/c1",
    );
  });

  it("shows an error when the submission cannot be loaded", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Submission not found" }), { status: 404 }),
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Submission not found");
  });

  it("shares a completed report and shows the public link", async () => {
    const completed = {
      id: "s1",
      challenge_id: "c1",
      status: "completed",
      provider: "demo",
      code: "x = 1",
      score: 100,
      evaluation_result: {
        id: "r1",
        passed_tests: 1,
        total_tests: 1,
        score: 100,
        logs: "1 passed",
        metrics: {},
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ share_token: "share-token-123" }), { status: 200 }),
      );

    renderPage(60_000);

    expect(await screen.findByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share result" }));

    const input = await screen.findByLabelText("Shareable result URL");
    expect(input).toHaveValue("http://localhost:3000/results/share-token-123");
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();

    // The share Copy button is the input's sibling (CodeBlock has its own).
    fireEvent.click(input.nextElementSibling as HTMLElement);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "http://localhost:3000/results/share-token-123",
    );
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();

    const shareCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(shareCall?.[0]).toBe("http://localhost:8000/api/submissions/s1/share");
  });

  it("revokes a shared link", async () => {
    const completed = {
      id: "s1",
      challenge_id: "c1",
      status: "completed",
      provider: "demo",
      code: "x = 1",
      score: 100,
      evaluation_result: {
        id: "r1",
        passed_tests: 1,
        total_tests: 1,
        score: 100,
        logs: "1 passed",
        metrics: {},
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(completed), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ share_token: "share-token-123" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    renderPage(60_000);

    expect(await screen.findByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share result" }));
    await screen.findByLabelText("Shareable result URL");

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Shareable result URL")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Share result" })).toBeInTheDocument();
    const revokeCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "DELETE",
    );
    expect(revokeCall?.[0]).toBe("http://localhost:8000/api/submissions/s1/share");
  });

  it("surfaces sharing errors", async () => {
    const completed = {
      id: "s1",
      challenge_id: "c1",
      status: "completed",
      provider: "demo",
      code: "x = 1",
      score: 100,
      evaluation_result: {
        id: "r1",
        passed_tests: 1,
        total_tests: 1,
        score: 100,
        logs: "1 passed",
        metrics: {},
        created_at: "2026-01-01T00:00:00Z",
      },
      created_at: "2026-01-01T00:00:00Z",
    };
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(completed), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Sharing is unavailable" }), {
          status: 500,
        }),
      );

    renderPage(60_000);

    expect(await screen.findByText("100%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share result" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sharing is unavailable",
    );
  });
  it("renders output delivered by the socket without a second fetch (#190)", async () => {
    // The socket carries the finished record, so the report appears on the same
    // round-trip that ended the run — no "fetch the final record once" follow-up.
    setToken("jwt-token");
    vi.stubGlobal("WebSocket", FakeWebSocket);
    // A fresh Response per call: a Response body can only be read once, and the
    // fallback poll may fire more than once before the socket reports open.
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(processingSubmission), { status: 200 })),
    );

    // Fake timers for the whole test, not just its last act. Installing them at
    // the end would not adopt the real timer the poll loop had already armed,
    // so "no further request" would have passed without ever running anything.
    const POLL_MS = 1_000;
    vi.useFakeTimers();
    renderPage(POLL_MS);

    // The socket is constructed in a mount effect, so it exists once the
    // effects have been flushed — no waiting on a clock to find out.
    await flush();
    expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    const socket = FakeWebSocket.latest();
    await act(async () => {
      socket.open();
    });
    expect(screen.getByText(/Running tests/i)).toBeInTheDocument();

    // `socketState` is a dependency of the poll effect, so opening the socket
    // re-runs it: exactly one more request, and then the loop retires. Draining
    // it settles the baseline, which is what the 30ms stability window was
    // reaching for by waiting and hoping (#330).
    await flush();
    await tick(POLL_MS * 5);
    const beforeRecord = fetchMock.mock.calls.length;

    // `findBy*` would wait on the very clock these tests now mock, so the
    // assertions are synchronous over a flushed render instead.
    await act(async () => {
      socket.message({
        type: "update",
        status: "completed",
        phase: null,
        submission: finishedSubmission,
      });
    });

    // Output that used to require a re-fetch is on screen.
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText(/def two_sum/)).toBeInTheDocument();

    // The socket supplied the record, so no further request was made. Asserted
    // after another five intervals, which is stronger than the 30ms it replaces:
    // a poll still armed would have fired, rather than merely not yet.
    await tick(POLL_MS * 5);
    expect(fetchMock.mock.calls.length).toBe(beforeRecord);
  });

  it("still re-fetches when a terminal update arrives without the record", async () => {
    // The fallback path: an older server, a reconnect that missed the terminal
    // event, or a partial sequence. The page must not be left showing a
    // terminal status with no output.
    setToken("jwt-token");
    vi.stubGlobal("WebSocket", FakeWebSocket);
    // Polls (which stop once the socket is open) keep returning "processing";
    // the flag flips only when the terminal update lands, so the request the
    // fallback makes is the one that returns the record.
    let deliverFinished = false;
    fetchMock.mockImplementation(() => {
      const body = deliverFinished ? finishedSubmission : processingSubmission;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });

    renderPage();

    const socket = await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
      return FakeWebSocket.latest();
    });
    socket.open();
    expect(await screen.findByText(/Running tests/i)).toBeInTheDocument();
    const beforeRecord = fetchMock.mock.calls.length;

    // Terminal status, but no record attached.
    deliverFinished = true;
    socket.message({ type: "update", status: "completed", phase: null });

    expect(await screen.findByText("100%")).toBeInTheDocument();
    expect(screen.getByText(/def two_sum/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(beforeRecord);
  });
});
