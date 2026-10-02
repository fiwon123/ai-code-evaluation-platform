import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreMatchMedia, stubMatchMedia } from "../test/matchMedia.ts";
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

  /**
   * Home at rest, with the terminal story already finished.
   *
   * jsdom has no `matchMedia`, so the reduced-motion preference reads `false`
   * and the story is stuck on its first frame — the rows the assertions below
   * look for would never appear. Stubbed as reduced-motion, the hook renders the
   * final state immediately. The sequence itself is `useTerminalStory`'s job and
   * has its own suite.
   */
  function renderHomeAtRest() {
    stubMatchMedia(true);
    return renderHome();
  }

  afterEach(() => {
    restoreMatchMedia();
  });

  it("keeps the drifting code fragments out of the accessibility tree", () => {
    renderHome();
    // The fragments are atmosphere. A screen reader announcing
    // "def two_sum(nums, target)" mid-hero would be noise, and the list is
    // decorative by construction — see the CODE_FRAGMENTS comment.
    const fragment = screen.getByText("def two_sum(nums, target):");
    expect(fragment.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("names the runner where the work happened, not in a static list", () => {
    renderHomeAtRest();
    // The chip row is gone (#352). It was a row of pills above the hero that
    // asserted nothing about the work below it, and a list of six tools invites
    // the reading "these are all of them" — understating the platform by seven
    // languages and five providers. The report's tally names the runner instead,
    // so the name is attached to a result rather than floating above the fold.
    expect(screen.getByText(/·\s*pytest$/)).toBeInTheDocument();
  });

  it("renders no integrations list, so nothing can over-claim a provider set", () => {
    renderHomeAtRest();
    // Provider names belong to the feature copy that explains the choice, and
    // the old chips needed a "does not say *supported*" test to stay honest. With
    // no integrations list on the page, the question is gone. Asserting over
    // `queryAllByRole("list")` rather than one `queryByRole` is the part worth
    // having: a list can reappear under a different label, and this still fails.
    for (const list of screen.queryAllByRole("list")) {
      const label = list.getAttribute("aria-label") ?? "";
      expect(
        label,
        `a labelled list reappeared on Home: ${list.textContent?.slice(0, 60)}`,
      ).not.toMatch(/supported providers|integrations and test runners/i);
    }
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
