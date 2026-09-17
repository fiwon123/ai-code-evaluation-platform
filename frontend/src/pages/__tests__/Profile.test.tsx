import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Profile from "../Profile/Profile.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, submissionsApi } from "../../services/api.ts";

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  challengesApi: { list: vi.fn() },
  submissionsApi: { list: vi.fn() },
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

const user = {
  id: "u1",
  email: "alice@example.com",
  username: "alice",
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
    evaluation_result: null,
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
      <Profile />
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
});