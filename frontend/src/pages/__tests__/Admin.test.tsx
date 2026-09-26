import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../components/Toast/ToastContext.tsx";
import AdminChallenges from "../Admin/AdminChallenges.tsx";
import AdminDashboard from "../Admin/AdminDashboard.tsx";
import AdminSubmissions from "../Admin/AdminSubmissions.tsx";
import AdminUsers from "../Admin/AdminUsers.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { adminApi } from "../../services/api.ts";
import type { AdminSubmission, Challenge, User } from "../../types.ts";

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  adminApi: {
    stats: vi.fn(),
    listUsers: vi.fn(),
    updateUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    deleteUser: vi.fn(),
    listChallenges: vi.fn(),
    removeChallenge: vi.fn(),
    listSubmissions: vi.fn(),
  },
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

const mockStats = vi.mocked(adminApi.stats);
const mockListUsers = vi.mocked(adminApi.listUsers);
const mockUpdateUser = vi.mocked(adminApi.updateUser);
const mockDeactivateUser = vi.mocked(adminApi.deactivateUser);
const mockReactivateUser = vi.mocked(adminApi.reactivateUser);
const mockDeleteUser = vi.mocked(adminApi.deleteUser);
const mockListChallenges = vi.mocked(adminApi.listChallenges);
const mockRemoveChallenge = vi.mocked(adminApi.removeChallenge);
const mockListSubmissions = vi.mocked(adminApi.listSubmissions);
const mockUseAuth = vi.mocked(useAuth);

const currentAdmin: User = {
  id: "admin1",
  email: "admin@example.com",
  username: "root",
  is_admin: true,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

const users: User[] = [
  {
    id: "u1",
    email: "alice@example.com",
    username: "alice",
    is_admin: true,
    is_active: true,
    created_at: "2026-01-15T00:00:00Z",
  },
  {
    id: "u2",
    email: "bob@example.com",
    username: "bob",
    is_admin: false,
    is_active: false,
    created_at: "2026-02-01T00:00:00Z",
  },
];

const challenges: Challenge[] = [
  {
    id: "c1",
    title: "Two Sum",
    description: "Find indices that sum to a target",
    prompt: "Write two_sum",
    test_code: "def test_two_sum(): pass",
    language: "python",
    difficulty: "easy",
    owner_id: "u1",
    created_at: "2026-09-10T10:00:00Z",
    updated_at: "2026-09-10T10:00:00Z",
  },
];

const submissions: AdminSubmission[] = [
  {
    id: "s1",
    user_id: "u1",
    challenge_id: "c1",
    status: "completed",
    provider: "demo",
    language: "python",
    code: "print(1)",
    score: 100,
    evaluation_result: null,
    created_at: "2026-09-10T00:00:00Z",
    updated_at: "2026-09-10T00:00:00Z",
    username: "alice",
    challenge_title: "Two Sum",
  },
];

const paginated = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  page_size: 20,
  pages: 1,
});

function renderPage(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <ToastProvider>{node}</ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * The platform stats the dashboard is rendered from.
 *
 * Hoisted out of `beforeEach` so a test can vary a single field — the accent
 * rules turn on exactly those fields — without restating the other twenty.
 */
const BASE_STATS = {
  total_users: 2,
  total_challenges: 1,
  total_submissions: 3,
  completed_submissions: 1,
  failed_submissions: 1,
  pending_submissions: 1,
  average_score: 100,
  submissions_by_status: [
    { status: "pending", count: 1 },
    { status: "processing", count: 0 },
    { status: "completed", count: 1 },
    { status: "failed", count: 1 },
  ],
  submissions_by_language: [
    { language: "python", count: 2, avg_score: 88 },
    { language: "javascript", count: 1, avg_score: 90 },
  ],
  submissions_by_provider: [
    { provider: "openai", count: 2, avg_score: 80, pass_rate: 1 },
    { provider: "ollama", count: 1, avg_score: 50, pass_rate: 0 },
  ],
  submissions_by_error_type: [
    { error_type: "timeout", count: 1 },
    { error_type: "auth failure", count: 1 },
  ],
  top_challenges: [
    { challenge_id: "c1", title: "Two Sum", runs: 3, avg_score: 86 },
  ],
  submissions_last_14_days: Array.from({ length: 14 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    count: i + 1,
  })),
  };

describe("AdminDashboard", () => {
  beforeEach(() => {
    mockStats.mockResolvedValue(BASE_STATS as never);
  });

  it("renders platform statistics", async () => {
    renderPage(<AdminDashboard />);
    expect(await screen.findByText("Admin dashboard")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Challenges")).toBeInTheDocument();
    expect(screen.getByText("Submissions")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  /**
   * The stat card carrying `label`, found among the stat cards specifically.
   *
   * "Users", "Submissions" and "Average score" each appear more than once on
   * this page — the status list, the language breakdown and the top-challenges
   * table all repeat them — so an unscoped query is ambiguous. Restricting to
   * the stat label is what makes this assert about the stat grid.
   */
  const statCard = async (label: string): Promise<HTMLElement> => {
    const found = await screen.findAllByText(label, {
      selector: '[class*="statLabel"]',
    });
    expect(found, `expected exactly one stat card labelled "${label}"`).toHaveLength(1);
    const card = found[0].closest('[class*="statCard"]');
    expect(card, `"${label}" is not inside a stat card`).not.toBeNull();
    return card as HTMLElement;
  };

  // The CSS module hashes its class names (`accentPrimary_dc56c0`), and `_` is
  // a word character, so the name has to stop at the letter before the hash.
  const accentOf = async (label: string): Promise<string> =>
    (await statCard(label)).className.match(/accent([A-Za-z]+)/)?.[1] ?? "";

  it("gives every stat card an accent, and a count never gets a verdict", async () => {
    renderPage(<AdminDashboard />);
    await screen.findByText("Admin dashboard");

    // The three totals are identities: a number has no opinion about being
    // good, so its hue only distinguishes it. The three statuses are
    // judgements and do get one. This is the distinction the whole stat
    // system rests on, so it is pinned here rather than left to review.
    expect(await accentOf("Users")).toBe("Primary");
    expect(await accentOf("Challenges")).toBe("Teal");
    expect(await accentOf("Submissions")).toBe("Violet");

    expect(await accentOf("Completed")).toBe("Success");
    expect(await accentOf("Failed")).toBe("Danger");
    // A queue with work in it is worth flagging.
    expect(await accentOf("Pending / processing")).toBe("Warning");
  });

  it("does not cry wolf over an empty queue", async () => {
    // `pending_submissions: 1` above wears the warning accent. At zero there is
    // nothing pending, and a warning-coloured zero would greet every operator
    // every morning with an alarm that means nothing.
    mockStats.mockResolvedValue({ ...BASE_STATS, pending_submissions: 0 } as never);
    renderPage(<AdminDashboard />);
    expect(await accentOf("Pending / processing")).toBe("Primary");
  });

  it("falls back to a neutral accent when there is no average score yet", async () => {
    // A brand-new platform has nothing to average. Showing an em dash in the
    // colour of a verdict would imply a judgement that was never made.
    mockStats.mockResolvedValue({ ...BASE_STATS, average_score: null } as never);
    renderPage(<AdminDashboard />);
    expect((await statCard("Average score")).textContent).toContain("\u2014");
    expect(await accentOf("Average score")).toBe("Primary");
  });

  it("lets the average score take the app-wide scale", async () => {
    // The same score means the same colour here as it does on a challenge chip
    // and on the profile dashboard, so a reader learns the scale once.
    for (const [score, accent] of [
      [95, "Success"],
      [65, "Warning"],
      [12, "Danger"],
    ] as const) {
      mockStats.mockResolvedValue({ ...BASE_STATS, average_score: score } as never);
      const { unmount } = renderPage(<AdminDashboard />);
      expect(await accentOf("Average score"), `score ${score}`).toBe(accent);
      unmount();
    }
  });

  it("shows an error message when stats fail to load", async () => {
    mockStats.mockRejectedValue(new Error("Server unreachable"));
    renderPage(<AdminDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server unreachable",
    );
  });

  it("renders provider and error-type breakdowns", async () => {
    renderPage(<AdminDashboard />);
    expect(
      await screen.findByLabelText("Submissions by provider"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Failed submissions by error type"),
    ).toBeInTheDocument();
    expect(screen.getByText("openai")).toBeInTheDocument();
    expect(screen.getByText("ollama")).toBeInTheDocument();
    expect(screen.getByText("auth failure")).toBeInTheDocument();
  });
});

describe("AdminUsers", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: currentAdmin,
      token: "t",
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      loginWithOAuth: vi.fn(),
    });
    mockListUsers.mockResolvedValue(paginated(users) as never);
    mockUpdateUser.mockReset();
    mockDeactivateUser.mockReset();
    mockReactivateUser.mockReset();
    mockDeleteUser.mockReset();
  });

  it("lists users with role and status badges", async () => {
    renderPage(<AdminUsers />);
    expect(await screen.findByText("alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
    expect(screen.getAllByText("deactivated").length).toBeGreaterThan(0);
  });

  it("promotes a user to admin", async () => {
    mockUpdateUser.mockResolvedValue({
      ...users[1],
      is_admin: true,
    } as never);
    renderPage(<AdminUsers />);
    await screen.findByText("bob");

    fireEvent.click(screen.getByRole("button", { name: "Make admin" }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith("u2", { is_admin: true });
    });
    expect(screen.getByText(/bob is now an admin/i)).toBeInTheDocument();
  });

  it("deactivates a user", async () => {
    mockDeactivateUser.mockResolvedValue({
      ...users[0],
      is_active: false,
    } as never);
    renderPage(<AdminUsers />);
    await screen.findByText("alice");

    const aliceRow = screen
      .getByText("alice")
      .closest("tr") as HTMLElement;
    fireEvent.click(
      within(aliceRow).getByRole("button", { name: "Deactivate" }),
    );

    await waitFor(() => {
      expect(mockDeactivateUser).toHaveBeenCalledWith("u1");
    });
    expect(screen.getByText(/alice deactivated/i)).toBeInTheDocument();
  });

  it("restores a deactivated user", async () => {
    mockReactivateUser.mockResolvedValue({
      ...users[1],
      is_active: true,
    } as never);
    renderPage(<AdminUsers />);
    await screen.findByText("bob");

    // bob is inactive, so his row offers Restore (not Deactivate).
    const bobRow = screen.getByText("bob").closest("tr") as HTMLElement;
    fireEvent.click(
      within(bobRow).getByRole("button", { name: "Restore" }),
    );

    await waitFor(() => {
      expect(mockReactivateUser).toHaveBeenCalledWith("u2");
    });
    expect(screen.getByText(/bob restored/i)).toBeInTheDocument();
  });

  it("deletes a user after confirmation", async () => {
    mockDeleteUser.mockResolvedValue(undefined);
    renderPage(<AdminUsers />);
    await screen.findByText("alice");

    const aliceRow = screen.getByText("alice").closest("tr") as HTMLElement;
    fireEvent.click(
      within(aliceRow).getByRole("button", { name: "Delete" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete user?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteUser).toHaveBeenCalledWith("u1");
    });
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(screen.getByText(/alice deleted/i)).toBeInTheDocument();
  });

  it("disables destructive actions for the own account", async () => {
    mockListUsers.mockResolvedValueOnce(
      paginated([currentAdmin, ...users]) as never,
    );
    renderPage(<AdminUsers />);
    await screen.findByText("root");

    const ownRow = screen.getByText("root").closest("tr") as HTMLElement;
    // root is the current admin: revoke/restore/delete are all disabled.
    expect(
      within(ownRow).getByRole("button", { name: "Revoke admin" }),
    ).toBeDisabled();
    expect(
      within(ownRow).getByRole("button", { name: "Delete" }),
    ).toBeDisabled();
  });
});

describe("AdminChallenges", () => {
  beforeEach(() => {
    mockListChallenges.mockResolvedValue(paginated(challenges) as never);
    mockRemoveChallenge.mockReset();
  });

  it("lists challenges", async () => {
    renderPage(<AdminChallenges />);
    expect(await screen.findByText("Two Sum")).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
  });

  it("deletes a challenge after confirmation", async () => {
    mockRemoveChallenge.mockResolvedValue(undefined);
    renderPage(<AdminChallenges />);
    await screen.findByText("Two Sum");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete challenge?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(mockRemoveChallenge).toHaveBeenCalledWith("c1");
    });
    expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
  });
});

describe("AdminSubmissions", () => {
  beforeEach(() => {
    mockListSubmissions.mockResolvedValue(paginated(submissions) as never);
  });

  it("lists submissions with status, owner, and challenge", async () => {
    renderPage(<AdminSubmissions />);
    expect(await screen.findAllByText("completed")).not.toHaveLength(0);
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
  });

  it("passes the status filter when one is selected", async () => {
    renderPage(<AdminSubmissions />);
    await screen.findAllByText("completed");

    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "failed" },
    });

    await waitFor(() => {
      expect(mockListSubmissions).toHaveBeenCalledWith(
        { page: 1, page_size: 20, status: "failed" },
        expect.anything(),
      );
    });
  });
});