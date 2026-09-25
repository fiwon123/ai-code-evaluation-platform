import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditChallenge from "../EditChallenge.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, ApiError } from "../../services/api.ts";
import { ToastProvider } from "../../components/Toast/ToastContext.tsx";

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: vi.fn() };
});

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  challengesApi: { get: vi.fn(), update: vi.fn() },
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
const mockChallengesUpdate = vi.mocked(challengesApi.update);

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

function renderPage() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/challenges/c1/edit"]}>
        <Routes>
          <Route path="/challenges/:id/edit" element={<EditChallenge />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

function mockOwnerUser() {
  mockUseAuth.mockReturnValue({
    user: { id: "u1", email: "a@b.co", username: "alice", is_admin: false, is_active: true, created_at: "" },
    token: "t",
    initializing: false,
    login: vi.fn(),
    register: vi.fn(),
logout: vi.fn(),
      loginWithOAuth: vi.fn(),
  });
}

describe("EditChallenge", () => {
  beforeEach(() => {
    mockOwnerUser();
    mockChallengesGet.mockResolvedValue(challenge as never);
    mockNavigate.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pre-fills the form with the challenge data", async () => {
    renderPage();
    expect(
      await screen.findByRole("heading", { name: "Edit challenge" }),
    ).toBeInTheDocument();

    const title = screen.getByLabelText(/Title/) as HTMLInputElement;
    expect(title.value).toBe("Two Sum");

    const description = screen.getByLabelText(/Description/) as HTMLTextAreaElement;
    expect(description.value).toBe("Find indices summing to target");

    const prompt = screen.getByLabelText(/Prompt for the LLM/) as HTMLTextAreaElement;
    expect(prompt.value).toBe("Write a function two_sum(nums, target)");
  });

  it("saves changes and navigates back to the challenge", async () => {
    const navigate = vi.fn();
    mockNavigate.mockReturnValue(navigate);
    mockChallengesUpdate.mockResolvedValue(challenge as never);

    renderPage();
    await screen.findByRole("heading", { name: "Edit challenge" });

    fireEvent.change(screen.getByLabelText(/Title/) as HTMLInputElement, {
      target: { value: "Two Sum II" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockChallengesUpdate).toHaveBeenCalledWith("c1", {
        title: "Two Sum II",
        description: "Find indices summing to target",
        prompt: "Write a function two_sum(nums, target)",
        test_code: "from solution import two_sum",
        language: "python",
        difficulty: "medium",
      });
    });
    expect(navigate).toHaveBeenCalledWith("/challenges/c1");
  });

  it("blocks editing when the user is not the owner", async () => {
    mockUseAuth.mockReturnValue({
      user: { id: "u2", email: "b@c.co", username: "bob", is_admin: false, is_active: true, created_at: "" },
      token: "t",
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
logout: vi.fn(),
    loginWithOAuth: vi.fn(),
    });

    renderPage();
    expect(
      await screen.findByText(/You can only edit challenges you created/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  it("surfaces update errors", async () => {
    mockChallengesUpdate.mockRejectedValue(
      Object.assign(new Error("Title too short"), {
        name: "ApiError",
        status: 422,
      }),
    );

    renderPage();
    await screen.findByRole("heading", { name: "Edit challenge" });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Title too short",
    );
  });

  it("shows an error state when the challenge cannot be loaded", async () => {
    mockChallengesGet.mockRejectedValue(new ApiError(404, "Challenge not found"));

    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Challenge not found",
    );
  });
});