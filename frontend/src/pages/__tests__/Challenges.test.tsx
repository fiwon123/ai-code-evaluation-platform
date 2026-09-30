import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    difficulty: "easy",
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
    difficulty: "medium",
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
    if (requested?.difficulty) {
      result = result.filter((c) => c.difficulty === requested.difficulty);
    }
    if (requested?.sort === "title") {
      result = [...result].sort((a, b) => a.title.localeCompare(b.title));
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
      user: { id: "u1", email: "a@b.co", username: "alice", is_admin: false, is_active: true, created_at: "" },
      token: "t",
      initializing: false,
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      loginWithOAuth: vi.fn(),
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

  it("always lists every supported language in the filter dropdown", async () => {
    renderPage();
    await screen.findByText("Two Sum");

    // The option text carries the language's symbol, because that is the only
    // identity a native `<select>` can show: an `<option>`'s own `color` is
    // ignored by the closed control and the popup is OS-rendered. Spelled out
    // rather than built from `languageMeta` so this pins the catalog instead of
    // asserting the page agrees with the helper it calls.
    const languageOptions = [
      "Py Python",
      "JS JavaScript",
      "TS TypeScript",
      "Jv Java",
      "Go Go",
      "C C",
      "C++ C++",
      "Rs Rust",
      "PHP PHP",
      "Rb Ruby",
      "Pl Perl",
      "Kt Kotlin",
      "Lua Lua",
      "C# C#",
      "Sw Swift",
      "Da Dart",
      "Sc Scala",
      "R R",
      "Hs Haskell",
      "ObjC Objective-C",
    ];
    const options = screen
      .getAllByRole("option")
      .map((option) => option.textContent)
      .filter((label) => languageOptions.includes(label ?? ""));

    // Same ordering/labeling as the challenge forms (LANGUAGES constant).
    expect(options).toEqual(languageOptions);

    // The dropdown must not shrink after filtering to a single language —
    // previously it was derived from the current page's results, so picking
    // "Go" collapsed the options to just "Go".
    fireEvent.change(screen.getByLabelText(/Filter by language/i), {
      target: { value: "go" },
    });
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const afterFilter = screen
      .getAllByRole("option")
      .map((option) => option.textContent)
      .filter((label) => languageOptions.includes(label ?? ""));

    expect(afterFilter).toEqual(languageOptions);
  });

  it("filters by difficulty via the API", async () => {
    renderPage();
    await screen.findByText("Two Sum");

    // A radio group, not a `<select>`: the difficulty options are coloured
    // badges, and a closed `<select>` paints its own text over the option's
    // colour, so a dropdown could not carry the colour the issue asks for.
    fireEvent.click(screen.getByRole("radio", { name: "Easy" }));

    await waitFor(() => {
      const call = mockList.mock.calls.at(-1);
      expect(call?.[0]?.difficulty).toBe("easy");
    });
    expect(screen.getByText("Two Sum")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("FizzBuzz")).not.toBeInTheDocument();
    });
  });

  it("offers every supported difficulty in the filter group, plus the no-filter case", async () => {
    renderPage();
    await screen.findByText("Two Sum");

    // Reached by role *and* name on purpose. The `<legend>` is the group's only
    // accessible name and it is visually hidden (`sr-only.css`) so the bar stays
    // one line, which means this assertion is what fails if that hiding ever
    // becomes `display: none` and takes the name with it.
    const group = screen.getByRole("group", { name: /Filter by difficulty/i });
    const values = within(group)
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("value"));

    // The values sent to the API, so "All" is asserted as the `all` the
    // backend already accepts rather than as a display string.
    expect(values).toEqual(["all", "easy", "medium", "hard"]);
  });

  it("sorts by title via the API", async () => {
    renderPage();
    await screen.findByText("Two Sum");

    fireEvent.change(screen.getByLabelText(/Sort challenges/i), {
      target: { value: "title" },
    });

    await waitFor(() => {
      const call = mockList.mock.calls.at(-1);
      expect(call?.[0]?.sort).toBe("title");
    });
    await waitFor(() => {
      expect(screen.getByText("FizzBuzz")).toBeInTheDocument();
    });
  });

  it("shows difficulty badges on challenge cards", async () => {
    renderPage();
    await screen.findByText("Two Sum");

    // Scoped to the card, because "Easy" is no longer unique to the card: the
    // filter group renders the same three words as pills. A bare
    // `getByText("Easy")` here was matching the *filter* and asserting nothing
    // about the card — before this branch it matched the `<option>` in the old
    // dropdown and was equally vacuous. The card badge also used to render the
    // raw lowercase value, which this is what pins.
    const cards = document.querySelectorAll('[class*="cardBadges"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Easy");
    expect(cards[1]).toHaveTextContent("Medium");
  });

  it("shows an empty state when there are no challenges", async () => {
    mockList.mockResolvedValue(toPaginated([]) as never);
    renderPage();
    expect(
      await screen.findByText(/No challenges yet/i),
    ).toBeInTheDocument();
  });
});