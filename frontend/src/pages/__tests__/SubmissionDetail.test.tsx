import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubmissionDetail from "../SubmissionDetail.tsx";
import { clearToken, setToken } from "../../services/api.ts";

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
    clearToken();
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

    fetchMock.mockResolvedValue(new Response(JSON.stringify(completed), { status: 200 }));

    renderPage();

    expect(await screen.findByText("100%")).toBeInTheDocument();
    // Give a small window for any spurious re-fetches.
    await new Promise((resolve) => setTimeout(resolve, 50));
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

    renderPage();

    const socket = await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
      return FakeWebSocket.latest();
    });
    socket.open();
    expect(await screen.findByText(/Running tests/i)).toBeInTheDocument();

    // Baseline after the socket is open and polling has stopped.
    await waitFor(() => {
      const calls = fetchMock.mock.calls.length;
      return new Promise((resolve) =>
        setTimeout(() => resolve(calls === fetchMock.mock.calls.length), 30),
      ).then((stable) => expect(stable).toBe(true));
    });
    const beforeRecord = fetchMock.mock.calls.length;

    socket.message({
      type: "update",
      status: "completed",
      phase: null,
      submission: finishedSubmission,
    });

    // Output that used to require a re-fetch is on screen.
    expect(await screen.findByText("100%")).toBeInTheDocument();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(screen.getByText(/def two_sum/)).toBeInTheDocument();

    // The socket supplied the record, so no further request was made.
    await waitFor(() =>
      expect(fetchMock.mock.calls.length).toBe(beforeRecord),
    );
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
