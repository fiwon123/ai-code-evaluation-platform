import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Home from "./Home/Home.tsx";

vi.mock("../context/AuthContext.tsx", () => ({
  useAuth: () => ({
    user: null,
    token: null,
    initializing: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    loginWithOAuth: vi.fn(),
  }),
}));

/**
 * Covers the Home page's ambient layer and the copy the rest of the landing
 * test suite deliberately skips.
 *
 * `landing.test.tsx` asserts the marketing pages do not over-promise, but
 * excludes Home: that file's copy is corrected here, alongside the hero
 * rewrite. Keeping these assertions in their own file also means the two
 * concerns can be reviewed — and reverted — independently.
 */
describe("Home ambient layer", () => {
  function renderHome() {
    return render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
  }

  it("keeps the drifting code fragments out of the accessibility tree", () => {
    renderHome();
    // The fragments are atmosphere. A screen reader announcing
    // "def two_sum(nums, target)" mid-hero would be noise, and the list is
    // decorative by construction — see the CODE_FRAGMENTS comment.
    const fragment = screen.getByText("def two_sum(nums, target):");
    expect(fragment.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("keeps the toolchain chips readable, and labels them as examples", () => {
    renderHome();
    // Unlike the fragments, the chips carry real information, so they stay in
    // the tree. The label says "example" because six chips stand in for
    // thirteen languages and six providers.
    const chips = screen.getByRole("list", {
      name: /example integrations and test runners/i,
    });
    expect(chips).toBeInTheDocument();
    expect(screen.getByText("pytest")).toBeInTheDocument();
  });

  it("does not label the chip row as an exhaustive list", () => {
    renderHome();
    // A "Supported providers and test runners" label on six chips reads as a
    // complete list, which would understate the platform by seven languages.
    expect(
      screen.queryByRole("list", { name: /^supported providers/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the hero's own content reachable", () => {
    renderHome();
    // The backdrop must not swallow the content it sits behind: the heading and
    // both calls to action are still exposed.
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /generate, execute, and evaluate ai-written code/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see the demo/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /get started free/i })).toBeInTheDocument();
  });

  it("still labels the sample figures as sample figures", () => {
    renderHome();
    // The stats strip counts real registry entries, but "avg. evaluation time"
    // is illustrative, so the caption has to stay.
    expect(screen.getByText("Sample figures for the prototype")).toBeInTheDocument();
    expect(screen.getByText("Languages supported")).toBeInTheDocument();
    expect(screen.getByText("LLM providers")).toBeInTheDocument();
  });
});

describe("Home copy stays true to the code", () => {
  function homeText() {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    return document.body.textContent ?? "";
  }

  it("does not describe a pytest-only platform", () => {
    // services/languages.py registers thirteen executable languages.
    const text = homeText();
    expect(text).not.toMatch(/a pytest test suite/i);
    expect(text).not.toMatch(/pytest in isolation/i);
  });

  it("does not name only two providers", () => {
    // services/llm.py ships six; Gemini, Groq and Ollama must all be named.
    const text = homeText();
    expect(text).toMatch(/Gemini/);
    expect(text).toMatch(/Groq/);
    expect(text).toMatch(/Ollama/);
  });

  it("makes no unconditional safety guarantee", () => {
    const text = homeText();
    expect(text).not.toMatch(/can never/i);
    expect(text).not.toMatch(/never harm/i);
  });
});
