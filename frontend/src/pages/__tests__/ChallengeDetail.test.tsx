import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChallengeDetail from "../ChallengeDetail.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, submissionsApi } from "../../services/api.ts";

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: vi.fn() };
});

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  challengesApi: { get: vi.fn(), remove: vi.fn() },
  submissionsApi: { create: vi.fn() },
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
const mockSubmissionsCreate = vi.mocked(submissionsApi.create);

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
    <MemoryRouter initialEntries={["/challenges/c1"]}>
      <Routes>
        <Route path="/challenges/:id" element={<ChallengeDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ChallengeDetail", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.co", username: "alice", created_at: "" },
      token: "t",
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
    mockChallengesGet.mockResolvedValue(challenge as never);
    mockNavigate.mockReturnValue(vi.fn());
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

    fireEvent.click(screen.getByLabelText(/OpenAI/));
    fireEvent.click(screen.getByRole("button", { name: /Generate & evaluate/ }));

    await waitFor(() => {
      expect(mockSubmissionsCreate).toHaveBeenCalledWith({
        challenge_id: "c1",
        provider: "openai",
      });
    });
    expect(navigate).toHaveBeenCalledWith("/submissions/s1");
  });

  it("shows the login link when unauthenticated", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      token: null,
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });

    renderPage();
    await screen.findByRole("heading", { name: "Two Sum" });
    expect(screen.getByRole("link", { name: /Log in/ })).toBeInTheDocument();
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
});