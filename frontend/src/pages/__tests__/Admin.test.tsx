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
import type { Challenge, Submission, User } from "../../types.ts";

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  adminApi: {
    stats: vi.fn(),
    listUsers: vi.fn(),
    updateUser: vi.fn(),
    deactivateUser: vi.fn(),
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

const submissions: Submission[] = [
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

describe("AdminDashboard", () => {
  beforeEach(() => {
    mockStats.mockResolvedValue({
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
      top_challenges: [
        { challenge_id: "c1", title: "Two Sum", runs: 3, avg_score: 86 },
      ],
      submissions_last_14_days: Array.from({ length: 14 }, (_, i) => ({
        date: `2026-09-${String(i + 1).padStart(2, "0")}`,
        count: i + 1,
      })),
    } as never);
  });

  it("renders platform statistics", async () => {
    renderPage(<AdminDashboard />);
    expect(await screen.findByText("Admin dashboard")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Challenges")).toBeInTheDocument();
    expect(screen.getByText("Submissions")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows an error message when stats fail to load", async () => {
    mockStats.mockRejectedValue(new Error("Server unreachable"));
    renderPage(<AdminDashboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server unreachable",
    );
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
    });
    mockListUsers.mockResolvedValue(paginated(users) as never);
    mockUpdateUser.mockReset();
    mockDeactivateUser.mockReset();
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

    // alice's row (has the "admin" badge) contains the enabled Deactivate
    // button; bob's row also has one but it is disabled.
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
});

describe("AdminChallenges", () => {
  beforeEach(() => {
    mockListChallenges.mockResolvedValue(paginated(challenges) as never);
    mockRemoveChallenge.mockReset();
  });

  it("lists challenges", async () => {
    renderPage(<AdminChallenges />);
    expect(await screen.findByText("Two Sum")).toBeInTheDocument();
    expect(screen.getByText("python")).toBeInTheDocument();
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

  it("lists submissions with status and score", async () => {
    renderPage(<AdminSubmissions />);
    expect(await screen.findAllByText("completed")).not.toHaveLength(0);
    expect(screen.getByText("100%")).toBeInTheDocument();
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