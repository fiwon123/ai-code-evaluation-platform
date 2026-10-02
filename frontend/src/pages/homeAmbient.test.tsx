import { render, screen, within } from "@testing-library/react";
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

  /**
   * The caption this replaces existed because two of the four figures were
   * illustrative. Deleting it is only honest if that is no longer true, so this
   * asserts the *reason* rather than the absence of the caption: every number on
   * the page is now read off the backend, and each sits in the step it describes.
   */
  it("puts a code-derived figure in every How-it-works step", () => {
    // Reduced motion, so each value is already settled. `useCountUp` starts at 0
    // and needs timers; asserting the figures against a moving number would be
    // a test of the animation rather than of the copy.
    renderHomeAtRest();
    for (const [value, label] of [
      ["13", "languages supported"],
      ["6", "LLM providers"],
      ["3", "attempts per submission"],
      ["64", "of logs captured"],
    ] as const) {
      const card = screen.getByText(label).closest("[class*=stepCard], div");
      expect(card, `no card holds "${label}"`).not.toBeNull();
      expect(card!.textContent).toContain(value);
    }
    // The caption is gone because there is nothing left for it to disclaim.
    expect(
      screen.queryByText("Sample figures for the prototype"),
    ).not.toBeInTheDocument();
  });

  it("states the attempt budget as attempts, not repairs", () => {
    renderHome();
    // `evaluation_max_attempts = 3` is the *total* generate-and-test budget:
    // attempt 1 is the initial generation, leaving two repairs. The old strip
    // said "repair attempts: 3", which overstated the repair loop by one and
    // was only defensible because a caption sat underneath it.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/repair attempts/i);
    expect(text).not.toMatch(/3 repairs/i);
  });

  /**
   * Each step card is told apart by hue (#353).
   *
   * Asserted on the rendered inline custom property rather than on a class name,
   * because the colour is handed to `Card` as `--card-accent` (#347) and the CSS
   * never names the four hues in one place — the whole point is that the accent
   * travels from `STEPS` rather than being listed twice.
   */
  it("gives every step card the accent of the figure it explains", () => {
    renderHomeAtRest();
    // The card class, not the `stepStat` prefix: that prefix also matches
    // `.stepStatValue` and `.stepStatLabel`, which would find twelve elements.
    const cards = document.querySelectorAll("[class*=stepCard]");
    expect(cards.length, "the four step cards were not found").toBe(4);

    const accents = [...cards].map((card) => {
      const accent = (card as HTMLElement).style.getPropertyValue("--card-accent").trim();
      // The figure's own accent, read from the attribute its CSS keys off, so
      // this checks the two agree rather than merely that four cards exist.
      const statAccent = card.querySelector("[data-accent]")?.getAttribute("data-accent");
      return { accent, statAccent };
    });

    // The four token references, written out rather than derived from
    // `statAccent`: deriving them would make this assertion agree with whatever
    // the component happened to emit. Note that `primary` is `--color-primary`
    // and not an `--color-accent-` token, which is why the mapping cannot be
    // built by string-building the accent name — the first version of this test
    // did exactly that and asked for `--color-accent-primary`.
    const expected = [
      "var(--color-primary)",
      "var(--color-accent-teal)",
      "var(--color-accent-violet)",
      "var(--color-accent-rose)",
    ];
    expect(accents.map((a) => a.accent)).toEqual(expected);

    // ...and each card agrees with *its own* figure, which the list above cannot
    // see: a mapping keyed by array position instead of `stat.accent` would
    // still emit those four tokens in order, just on the wrong cards.
    for (const { accent, statAccent } of accents) {
      expect(
        statAccent,
        "a step card has no accent declared on its figure",
      ).not.toBeNull();
      // Every hue's token contains its own name, so this resolves the figure's
      // accent to the token it is supposed to be painted with. (Deriving the
      // token by string-building `--color-accent-${statAccent}` instead asks
      // for `--color-accent-primary`, which is not a token that exists.)
      expect(accent).toBe(
        expected.find((token) => token.includes(statAccent as string)) ?? "no such accent",
      );
    }
    // Four distinct hues: two cards sharing one would make the grid read as two
    // pairs rather than four steps.
    expect(new Set(accents.map((a) => a.accent)).size).toBe(4);
  });

  it("phrases the pipeline steps in one cadence", () => {
    renderHome();
    // The labels used to range from 9 to 17 characters ("Get score" /
    // "AI generates code"), which wrapped to different line counts and made the
    // fifth card 27px taller than the first four for no reason but wording.
    const labels = ["Write a challenge", "Pick a provider", "Generate code", "Run your tests", "Get a score"];
    // Scoped to the pipeline track: "Pick a provider" is also a step-card title,
    // so a page-wide `getByText` finds two and throws.
    const track = document.querySelector("[class*=pipelineTrack]");
    expect(track, "the pipeline track was not found").not.toBeNull();
    for (const label of labels) {
      expect(
        within(track as HTMLElement).getByText(label),
        `"${label}" is missing from the pipeline strip`,
      ).toBeInTheDocument();
    }
    const cards = track!.querySelectorAll("[class*=pipelineStep]");
    expect(cards.length, "the five pipeline cards were not found").toBe(5);
    for (const label of labels) {
      const owner = [...cards].find((c) => c.textContent?.includes(label));
      expect(owner, `no pipeline card holds "${label}"`).toBeDefined();
    }
    const lengths = labels.map((l) => l.length);
    expect(Math.max(...lengths), "pipeline labels have drifted apart in length").toBeLessThanOrEqual(
      18,
    );
    // Each label is a verb and its object, so the strip scans left to right as
    // five actions rather than as three actions and two descriptions.
    expect(labels.map((l) => l.split(" ").length)).toEqual([3, 3, 2, 3, 3]);
  });

  it("reads terminal → how it works → pipeline", () => {
    renderHome();
    // Section order is the point of #354: the section that narrates the flow
    // used to sit two screens below the animation that performs it. Asserted
    // against the rendered DOM order rather than the source, because a
    // reordered `<section>` and a reordered stylesheet are different mistakes.
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent ?? "");
    const terminalPanel = document.querySelector('[class*="animPanel"]');
    expect(terminalPanel, "the terminal is gone").not.toBeNull();

    const howItWorks = headings.findIndex((h) => /from challenge to score/i.test(h));
    const pipeline = headings.findIndex((h) => /everything you need to evaluate/i.test(h));
    expect(howItWorks, "the How-it-works heading is missing").toBeGreaterThan(-1);
    expect(pipeline, "the pipeline heading is missing").toBeGreaterThan(-1);
    expect(
      howItWorks,
      `How-it-works (${howItWorks}) must come before the pipeline (${pipeline})`,
    ).toBeLessThan(pipeline);

    // And the terminal must still be the last thing in the hero, above both.
    const sections = [...document.querySelectorAll("section")];
    const heroIndex = sections.findIndex((s) => s.contains(terminalPanel));
    const howSection = sections.findIndex((s) =>
      s.querySelector('[class*="stepsGrid"]'),
    );
    const pipelineSection = sections.findIndex((s) =>
      s.querySelector('[class*="pipelineTrack"]'),
    );
    expect(heroIndex).toBe(0);
    expect(howSection).toBeGreaterThan(heroIndex);
    expect(pipelineSection).toBeGreaterThan(howSection);
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
