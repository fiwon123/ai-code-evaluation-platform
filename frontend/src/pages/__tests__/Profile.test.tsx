import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Profile from "../Profile/Profile.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { ToastProvider } from "../../components/Toast/ToastContext.tsx";
import {
  ApiError,
  authApi,
  challengesApi,
  submissionsApi,
} from "../../services/api.ts";

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  authApi: { changePassword: vi.fn() },
  challengesApi: { list: vi.fn() },
  submissionsApi: { list: vi.fn(), stats: vi.fn(), share: vi.fn(), revokeShare: vi.fn() },
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
const mockChallengesList = vi.mocked(challengesApi.list);
const mockSubmissionsList = vi.mocked(submissionsApi.list);
const mockChangePassword = vi.mocked(authApi.changePassword);
const mockSubmissionsStats = vi.mocked(submissionsApi.stats);

const user = {
  id: "u1",
  email: "alice@example.com",
  username: "alice",
  is_admin: false,
  is_active: true,
  created_at: "2026-01-15T00:00:00Z",
};

const challenges = [
  {
    id: "c1",
    title: "My Challenge",
    description: "desc",
    prompt: "prompt",
    test_code: "test",
    language: "python",
    difficulty: "hard",
    owner_id: "u1",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  },
  {
    id: "c2",
    title: "Someone Else's",
    description: "desc",
    prompt: "prompt",
    test_code: "test",
    language: "go",
    owner_id: "u2",
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
  },
];

const submissions = [
  {
    id: "s1",
    challenge_id: "c1",
    status: "completed",
    provider: "demo",
    // #348 reads these three off the row: the language badge, the provider and
    // model line, and the digest behind the test count.
    model: "llama-3.3-70b",
    language: "python",
    code: "print(1)",
    score: 100,
    evaluation_result: {
      id: "r1",
      passed_tests: 2,
      total_tests: 2,
      score: 100,
      logs: "2 passed",
      logs_summary: "2 passed, 0 failed",
      metrics: { duration_ms: 4200 },
      created_at: "2026-09-10T00:00:00Z",
    },
    created_at: "2026-09-10T00:00:00Z",
  },
  {
    id: "s2",
    challenge_id: "c1",
    status: "failed",
    provider: "demo",
    code: null,
    score: 0,
    evaluation_result: null,
    created_at: "2026-09-09T00:00:00Z",
  },
  {
    id: "s3",
    challenge_id: "c1",
    status: "pending",
    provider: "demo",
    code: null,
    score: null,
    evaluation_result: null,
    created_at: "2026-09-08T00:00:00Z",
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Profile />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("Profile", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user,
      token: "t",
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      loginWithOAuth: vi.fn(),
    });
    mockChallengesList.mockImplementation((params) => {
      const items = params?.owner_id
        ? challenges.filter((c) => c.owner_id === params.owner_id)
        : challenges;
      return Promise.resolve({
        items,
        total: items.length,
        page: 1,
        page_size: 10,
        pages: 1,
      } as never);
    });
    mockSubmissionsList.mockResolvedValue({
      items: submissions,
      total: submissions.length,
      page: 1,
      page_size: 10,
      pages: 1,
    } as never);
    mockChangePassword.mockReset();
    mockSubmissionsStats.mockResolvedValue({ items: [] } as never);
  });

  it("shows user identity and member since date", async () => {
    renderPage();
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Member since January 2026/i)).toBeInTheDocument();
  });

  it("gives a challenge card its difficulty, run count and best score (#348)", async () => {
    // The three fields #348 added to the box. `stats()` is mocked empty by
    // default, so they are driven from a real rollup here rather than from
    // defaults that happen to render an em dash.
    mockSubmissionsStats.mockResolvedValue({
      items: [
        {
          challenge_id: "c1",
          challenge_title: "My Challenge",
          description: "desc",
          language: "python",
          total_runs: 4,
          completed_runs: 3,
          failed_runs: 1,
          avg_score: 91.5,
          best_score: 100,
          last_run_at: "2026-09-20T00:00:00Z",
          last_duration_ms: 4200,
        },
      ],
    } as never);
    renderPage();
    await screen.findByText("alice");
    // Difficulty comes from `DIFFICULTY_VARIANT`, so the pill colour is the one
    // #346 held to contrast rather than a local guess.
    expect(screen.getByText("Hard")).toBeInTheDocument();
    // Completed of total, not the bare total. `getAllByText` because "3/4" is
    // also on the #347 "evaluations by challenge" card for this same challenge —
    // two cards, two independent renderings of one rollup, so a singular
    // matcher here would be asserting about a DOM that has genuinely two of.
    expect(screen.getAllByText("3/4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
    // Last *evaluated*, which is a different date from the created date the old
    // card showed — and the one the issue asked for.
    expect(screen.getByText(/Last evaluated/)).toBeInTheDocument();
    expect(screen.queryByText(/^Created /)).not.toBeInTheDocument();
  });

  it("says a never-evaluated challenge has never been evaluated (#348)", async () => {
    // `stats()` is empty by default, which is also what it is when the fetch
    // failed — the effect above is deliberately non-fatal. The card has to say
    // "not evaluated" rather than render a zero, because a zero best score is a
    // claim about quality and this is an absence of data.
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText("Not evaluated yet")).toBeInTheDocument();
    expect(screen.getByText(/^Created /)).toBeInTheDocument();
    // The em dash is there — several times, in fact, because every absent field
    // on both cards renders one.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("falls back to a neutral pill for a difficulty this build does not know (#348)", async () => {
    // A challenge whose difficulty is a value this build has never heard of. The
    // vocabulary lives in `utils/difficulty.ts`, so `DIFFICULTY_VARIANT["quantum"]`
    // is `undefined` and an unguarded lookup paints *no pill at all* — while
    // `difficultyLabel` has its own capitalising fallback. The two must agree that
    // the value is unknown: no pill is not the same as a neutral one, and the
    // label has to stay legible either way.
    mockChallengesList.mockResolvedValue({
      items: [{ ...challenges[0], difficulty: "quantum" }],
      total: 1,
      page: 1,
      pages: 1,
    } as never);
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText("Quantum")).toBeInTheDocument();
  });

  it("renders a difficulty of missing as Unknown rather than throwing (#348)", async () => {
    // The same guard for a field that is *absent* rather than unrecognised, which
    // is what a row written before the column existed looks like.
    mockChallengesList.mockResolvedValue({
      items: [{ ...challenges[0], difficulty: undefined }],
      total: 1,
      page: 1,
      pages: 1,
    } as never);
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("shows only the user's own challenges", async () => {
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText("My Challenge")).toBeInTheDocument();
    expect(screen.queryByText("Someone Else's")).not.toBeInTheDocument();
  });

  it("computes stats: 1 challenge, 3 submissions, avg 100%, 33% completion", async () => {
    renderPage();
    await screen.findByText("alice");
    expect(screen.getAllByText("1")[0]).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  it("shows recent submissions with status badges", async () => {
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
  });

  it("shows the recorded duration as a named stat rather than beside the score", async () => {
    // #348 moved the duration out of the score's inline text and into the card's
    // stats row, next to the test count. It was previously asserted as a substring
    // of one text node ("96.7% · 4.2s"), which is exactly the kind of assertion
    // that goes quiet when the layout changes rather than failing: the duration
    // had to survive *somehow*, and this is where it lives now. The label matters
    // as much as the value — a bare "4.2s" in a card is a number nobody can place.
    renderPage();
    await screen.findByText("alice");
    // Every completed row carries the label, so `getAllByText` — a single
    // `getByText("Duration")` is ambiguous across ten rows, which is a fact
    // about the DOM and not a test bug.
    expect(screen.getAllByText("Duration").length).toBeGreaterThan(0);
    expect(screen.getByText("4.2s")).toBeInTheDocument();
  });

  it("shows the pass/fail test count for a run that produced results", async () => {
    // #348: the submission card's second stat. `118/120` on its own says nothing
    // about *which* two failed, which is what the tooltip carries.
    renderPage();
    await screen.findByText("alice");
    expect(screen.getAllByText("Tests").length).toBeGreaterThan(0);
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("puts the full test breakdown in a keyboard-reachable tooltip", async () => {
    renderPage();
    await screen.findByText("alice");
    // `Tooltip` renders its bubble in the DOM and points the trigger at it with
    // `aria-describedby`, so the description resolves whether or not it is open.
    const trigger = screen.getByText("2/2");
    const id = trigger.closest("[aria-describedby]")?.getAttribute("aria-describedby");
    expect(id, "the test count must be described by the tooltip").toBeTruthy();
    const bubble = document.getElementById(id!);
    expect(bubble?.getAttribute("role")).toBe("tooltip");
    expect(bubble?.textContent).toContain("2 of 2 tests passed");
    // And the runner's own digest, which is the half the count cannot express.
    expect(bubble?.textContent).toContain("2 passed, 0 failed");
    // Reachable by keyboard: `Tooltip` puts the tab stop on its own wrapper when
    // the trigger cannot hold focus, which is what makes a `<dd>` a valid target.
    const tabbable = trigger.closest("[tabindex]");
    expect(tabbable, "the test count must be in the tab order").toBeTruthy();
  });

  it("gives a submission row its language, provider and model", async () => {
    renderPage();
    await screen.findByText("alice");
    // `LanguageBadge` renders the display name from `languageMeta`, not the raw
    // catalog value, so this asserts the badge rather than the raw string.
    expect(screen.getAllByText(/^Python$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/demo · llama-3\.3-70b/)).toBeInTheDocument();
  });

  it("shows a live waiting time on in-progress submissions", async () => {
    renderPage();
    await screen.findByText("alice");
    // s3 has been pending since 2026-09-08, so it reads as hours — and, being
    // far past the 10-minute severe tier, it escalates to the "stuck" tag.
    expect(screen.getByText(/waiting \d+h/)).toBeInTheDocument();
    expect(screen.getByText("stuck")).toBeInTheDocument();
  });

  it("escalates a pending submission stuck over 10 minutes to 'stuck'", async () => {
    // s3 has been pending since 2026-09-08 — far past the 10-minute severe
    // delay tier, so the list shows the dangerous "stuck" tag (mirroring the
    // detail page's "may never start" warning) instead of the mild "delayed".
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText("stuck")).toBeInTheDocument();
    expect(screen.queryByText("delayed")).not.toBeInTheDocument();
  });

  it("keeps the mild 'delayed' tag for a pending submission under the severe tier", async () => {
    mockSubmissionsList.mockResolvedValue({
      items: [
        ...submissions.filter((s) => s.id !== "s3"),
        {
          id: "s3",
          challenge_id: "c1",
          status: "pending",
          provider: "demo",
          code: null,
          score: null,
          evaluation_result: null,
          // Pending since ~3 minutes ago: past the 2-min mild threshold, well
          // under the 10-min severe threshold.
          created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
        },
      ],
      total: 3,
      page: 1,
      page_size: 10,
      pages: 1,
    } as never);
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText(/waiting \d+m/)).toBeInTheDocument();
    expect(screen.getByText("delayed")).toBeInTheDocument();
    expect(screen.queryByText("stuck")).not.toBeInTheDocument();
  });

  it("polls the submissions list while a submission is still in progress", async () => {
    vi.useFakeTimers();
    try {
      const pending = {
        id: "s4",
        challenge_id: "c1",
        status: "pending",
        provider: "demo",
        code: null,
        score: null,
        evaluation_result: null,
        created_at: new Date().toISOString(),
      };
      mockSubmissionsList.mockResolvedValue({
        items: [pending],
        total: 1,
        page: 1,
        page_size: 10,
        pages: 1,
      } as never);
      renderPage();

      // The mount effects (challenges/submissions load + first poll) resolve
      // on microtasks. Flush them with act — findBy*/waitFor must be avoided
      // here because they wait on real timers, which are mocked.
      await act(async () => {});
      await act(async () => {});
      expect(screen.getByText("alice")).toBeInTheDocument();
      const callsBefore = mockSubmissionsList.mock.calls.length;

      // Advance past the 5s poll interval; the in-progress row keeps polling.
      await vi.advanceTimersByTimeAsync(5_100);
      expect(mockSubmissionsList.mock.calls.length).toBeGreaterThan(callsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("changes the password and clears the form on success", async () => {
    mockChangePassword.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("alice");

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "currentpass123" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newpass123456" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "newpass123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        current_password: "currentpass123",
        new_password: "newpass123456",
      });
    });
    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.getByText(/Password updated successfully/i)).toBeInTheDocument();
  });

  it("shows a validation error when the new passwords do not match", async () => {
    renderPage();
    await screen.findByText("alice");

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "currentpass123" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newpass123456" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "different12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "New passwords do not match.",
    );
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it("surfaces the API error when the current password is wrong", async () => {
    mockChangePassword.mockRejectedValue(
      new ApiError(400, "Current password is incorrect"),
    );
    renderPage();
    await screen.findByText("alice");

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "wrongpassword" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newpass123456" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "newpass123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current password is incorrect",
    );
  });

  describe("evaluations dashboard", () => {
    it("renders per-challenge evaluation stats from the server", async () => {
      mockSubmissionsStats.mockResolvedValue({
        items: [
          {
            challenge_id: "c1",
            challenge_title: "Two Sum",
            language: "python",
            total_runs: 3,
            completed_runs: 2,
            failed_runs: 1,
            avg_score: 80,
            best_score: 90,
            last_run_at: "2026-09-20T10:00:00Z",
          },
          {
            challenge_id: "c2",
            challenge_title: "Reverse String",
            language: "go",
            total_runs: 1,
            completed_runs: 0,
            failed_runs: 0,
            avg_score: null,
            best_score: null,
            last_run_at: "2026-09-21T10:00:00Z",
          },
        ],
      } as never);

      renderPage();

      expect(
        await screen.findByRole("heading", {
          name: /Evaluations by challenge/,
        }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Two Sum" })).toHaveAttribute(
        "href",
        "/challenges/c1",
      );
      // The card is a `<dl>` now (#347), so the stats are named values rather
      // than a run of digits. Best is a stat of its own and Runs counts
      // completed of total: the old card printed "best 90% · 3 runs · 1 failed"
      // as a line of text, and nothing there may go missing in the redesign.
      const card = screen.getByRole("link", { name: "Two Sum" }).closest("div[class*='card']")! as HTMLElement;
      const list = card.querySelector<HTMLElement>("dl")!;
      expect(within(list).getAllByRole("term").map((t) => t.textContent)).toEqual([
        "Score",
        "Best",
        "Runs",
        "Last run",
      ]);
      expect(within(list).getAllByRole("definition").map((d) => d.textContent)).toEqual([
        "80%",
        "90%",
        "2/3",
        "—",
      ]);
      // The failed run is still counted and still visible.
      expect(within(card).getByText("1 failed")).toBeInTheDocument();

      // A challenge with no completed runs still appears, and says why its
      // score is an em dash instead of leaving a bare "—" to be guessed at.
      const empty = screen.getByRole("link", { name: "Reverse String" }).closest("div[class*='card']")! as HTMLElement;
      expect(within(empty).getAllByRole("definition")[0]).toHaveTextContent("—");
      expect(within(empty).getByLabelText("no completed runs yet")).toBeTruthy();

      // Headline average is computed across all challenges, not just the page.
      // Scoped to the summary card: the evaluation card's own 80% is the same
      // string, so a page-wide `getByText` here would be ambiguous by design.
      expect(
        within(screen.getByText("Average score").closest("div[class*='card']")! as HTMLElement).getByText("80%"),
      ).toBeInTheDocument();
    });

    it("shows an empty state when no challenge has been evaluated", async () => {
      renderPage();
      expect(
        await screen.findByText(/You haven't evaluated any challenges yet/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Browse challenges" }),
      ).toHaveAttribute("href", "/challenges");
    });

    it("lets a user share a completed submission from the list", async () => {
      mockSubmissionsStats.mockResolvedValue({ items: [] } as never);
      vi.mocked(submissionsApi.share).mockResolvedValue({
        share_token: "tok-321",
      } as never);

      renderPage();

      expect(
        await screen.findByRole("heading", { name: /Recent submissions/ }),
      ).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "Share" }));

      await waitFor(() => {
        expect(submissionsApi.share).toHaveBeenCalledWith("s1");
      });
      expect(await screen.findByText("Shared")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy link" }),
      ).toBeInTheDocument();
    });

    it("shows shared state for already-shared submissions", async () => {
      mockSubmissionsStats.mockResolvedValue({ items: [] } as never);
      mockSubmissionsList.mockResolvedValue({
        items: [
          {
            id: "s1",
            challenge_id: "c1",
            status: "completed",
            provider: "demo",
            code: "print(1)",
            score: 100,
            evaluation_result: {
              id: "r1",
              passed_tests: 2,
              total_tests: 2,
              score: 100,
              logs: "2 passed",
              metrics: {},
              share_token: "already-shared",
              created_at: "2026-09-10T00:00:00Z",
            },
            created_at: "2026-09-10T00:00:00Z",
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
        pages: 1,
      } as never);

      renderPage();

      expect(await screen.findByText("Shared")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy link" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Share" }),
      ).not.toBeInTheDocument();
    });
  });
});