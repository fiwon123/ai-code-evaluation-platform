import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Challenges from "../Challenges.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi } from "../../services/api.ts";
import type { Challenge, PaginatedResponse } from "../../types.ts";

vi.mock("../../context/AuthContext.tsx", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../services/api.ts", () => ({
  challengesApi: { list: vi.fn() },
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
const mockList = vi.mocked(challengesApi.list);

const challenges: Challenge[] = [
  {
    id: "c1",
    title: "Two Sum",
    description: "Find indices that sum to a target",
    prompt: "Write two_sum",
    test_code: "def test_two_sum(): pass",
    language: "python",
    owner_id: "u1",
    created_at: "2026-09-10T10:00:00Z",
    updated_at: "2026-09-10T10:00:00Z",
  },
  {
    id: "c2",
    title: "FizzBuzz",
    description: "Print numbers with fizz/buzz rules",
    prompt: "Write fizzbuzz",
    test_code: "def test_fizzbuzz(): pass",
    language: "javascript",
    owner_id: "u2",
    created_at: "2026-09-09T10:00:00Z",
    updated_at: "2026-09-09T10:00:00Z",
  },
];

function toPaginated(items: Challenge[]): PaginatedResponse<Challenge> {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 12,
    pages: Math.max(1, Math.ceil(items.length / 12)),
  };
}

function mockServerSideList() {
  mockList.mockImplementation((requested) => {
    let result = challenges;
    const query = (requested?.search ?? "").toLowerCase();
    if (query) {
      result = result.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query),
      );
    }
    if (requested?.language) {
      result = result.filter((c) => c.language === requested.language);
    }
    return Promise.resolve(toPaginated(result));
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Challenges />
    </MemoryRouter>,
  );
}

describe("Challenges", () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: "u1", email: "a@b.co", username: "alice", created_at: "" },
      token: "t",
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
    });
    mockServerSideList();
  });

  it("renders challenges as cards", async () => {
    renderPage();
    expect(await screen.findByText("Two Sum")).toBeInTheDocument();
    expect(screen.getByText("FizzBuzz")).toBeInTheDocument();
    expect(screen.getAllByText(/python|javascript/i).length).toBeGreaterThan(0);
    expect(screen.getByText("You own this")).toBeInTheDocument();
  });

  it("passes the search query to the API (server-side filtering)", async () => {
    renderPage();
    await screen.findByText("Two Sum");

    fireEvent.change(screen.getByLabelText(/Search challenges/i), {
      target: { value: "fizz" },
    });

    await waitFor(() => {
      const call = mockList.mock.calls.at(-1);
      expect(call?.[0]?.search).toBe("fizz");
    });
    await waitFor(() => {
      expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
      expect(screen.getByText("FizzBuzz")).toBeInTheDocument();
    });
  });

  it("filters by language via the API", async () => {
    renderPage();
    await screen.findByText("Two Sum");

    fireEvent.change(screen.getByLabelText(/Filter by language/i), {
      target: { value: "javascript" },
    });

    await waitFor(() => {
      const call = mockList.mock.calls.at(-1);
      expect(call?.[0]?.language).toBe("javascript");
    });
    expect(screen.queryByText("Two Sum")).not.toBeInTheDocument();
    expect(screen.getByText("FizzBuzz")).toBeInTheDocument();
  });

  it("shows an empty state when there are no challenges", async () => {
    mockList.mockResolvedValue(toPaginated([]) as never);
    renderPage();
    expect(
      await screen.findByText(/No challenges yet/i),
    ).toBeInTheDocument();
  });
});