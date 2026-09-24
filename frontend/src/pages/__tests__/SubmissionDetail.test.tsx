import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SubmissionDetail from "../SubmissionDetail.tsx";
import { clearToken } from "../../services/api.ts";

const fetchMock = vi.fn();

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
});