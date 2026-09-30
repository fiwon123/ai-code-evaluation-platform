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
    code: "print(1)",
    score: 100,
    evaluation_result: {
      id: "r1",
      passed_tests: 2,
      total_tests: 2,
      score: 100,
      logs: "2 passed",
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

  it("shows the recorded duration next to a completed score", async () => {
    renderPage();
    await screen.findByText("alice");
    expect(screen.getByText(/· 4\.2s/)).toBeInTheDocument();
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