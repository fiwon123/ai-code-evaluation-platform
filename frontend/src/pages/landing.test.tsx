import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_TIMING } from "../hooks/useTerminalStory.ts";
import { restoreMatchMedia, stubMatchMedia } from "../test/matchMedia.ts";
import About from "./About/About.tsx";
import Demo from "./Demo/Demo.tsx";
import Features from "./Features/Features.tsx";
import Home from "./Home/Home.tsx";
import { TERMINAL_ENTRANCE_MS } from "./Home/AnimatedTerminal.tsx";
import Pricing from "./Pricing/Pricing.tsx";

vi.mock("../services/api.ts", () => ({
  challengesApi: { list: vi.fn().mockResolvedValue([]) },
  submissionsApi: { create: vi.fn(), get: vi.fn() },
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

describe("landing pages", () => {
  /**
   * Home at the end of its terminal story.
   *
   * Stubbed as reduced-motion so the panel is already at its resting state
   * instead of its first frame. The assertions in this block are about the
   * landing *copy* — the score, the report label, the rows — and the sequence
   * that reveals them is covered by the `useTerminalStory` suite and by
   * `e2e/terminal-story.spec.ts`. Asserting the end state here is what keeps
   * these plain reads rather than timer dances that break on every timing tweak.
   */
  function renderHomeAtRest() {
    stubMatchMedia(true);
    return render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
  }

  afterEach(() => {
    restoreMatchMedia();
  });

  it("renders the Features page", () => {
    render(
      <MemoryRouter>
        <Features />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /Features/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/production-shaped evaluation pipeline/i)).toBeInTheDocument();
    expect(
      screen.getByText(/test suites defined per challenge/i),
    ).toBeInTheDocument();
  });

  it("renders the Pricing page with three tiers", () => {
    render(
      <MemoryRouter>
        <Pricing />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /Simple, transparent pricing/i }),
    ).toBeInTheDocument();
    // Each tier name appears on its pricing card and in the comparison table.
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pro").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Enterprise").length).toBeGreaterThan(0);
    expect(screen.getByText(/Most popular/i)).toBeInTheDocument();
  });

  it("renders the Demo page with walkthrough and live section", () => {
    render(
      <MemoryRouter>
        <Demo />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /See how it works/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Create a challenge/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Try it live/i)).toBeInTheDocument();
    expect(screen.getAllByText(/demo provider/i).length).toBeGreaterThan(0);
  });

  it("renders the About page", () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /About this project/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/open-source platform/i)).toBeInTheDocument();
    expect(screen.getByText("FastAPI")).toBeInTheDocument();
  });


  it("renders the Home hero with the animated sample report", () => {
    renderHomeAtRest();
    // 67, not 88. `services/evaluation.py` scores this exact report — two of
    // three tests passing — at 66.7, and the panel used to print 88 beside a
    // visible ✗. The landing page's whole job is showing what a real report
    // looks like, so a number its own backend would never produce is the worst
    // thing on it. `ScoreRing` rounds for display, so the accessible name is 67.
    expect(
      screen.getByRole("img", { name: "Sample score 67 / 100" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sample evaluation report"),
    ).toBeInTheDocument();
  });

  it("holds the digits at 0% through the shake, then counts to the score", () => {
    // On fake timers, because the claim is a sub-second window in the story and
    // the browser version of this assertion could miss it entirely on a loaded
    // machine. See the note in `e2e/terminal-story.spec.ts`, which is the
    // complement: it proves the trigger wiring, this proves the timing.
    vi.useFakeTimers();
    try {
      // Motion allowed, so the story actually plays: under reduced motion the
      // whole report renders at once and there is no shake to observe.
      stubMatchMedia(false);
      render(
        <MemoryRouter>
          <Home />
        </MemoryRouter>,
      );

      // The rendered digits, not the accessible name. The `<svg role="img">` is
      // labelled with the *target* — "Sample score 67 / 100" — from the first
      // frame, which is right for a screen reader and useless for this: the count
      // being asserted lives in the `<text>`.
      const digits = () => {
        const value = document.querySelector(".ringValue");
        return Number(value?.textContent?.replace("%", "").trim() ?? "0");
      };

      // The story waits for the panel's own fade before its first frame, so
      // every offset below is measured from *after* that. The lead-in is read
      // from the component rather than repeated here, because if the two ever
      // disagree this test would be asserting against a timeline the page no
      // longer runs — and it would still pass, one beat out of step.
      const timeline = TERMINAL_TIMING;
      const story =
        TERMINAL_ENTRANCE_MS + 800 + 99 * timeline.typeMs + timeline.runStartMs;
      const lastTest = story + 2 * timeline.testGapMs;

      // Throughout the run the score has not started.
      act(() => void vi.advanceTimersByTime(lastTest + timeline.testResolveMs));
      expect(digits()).toBe(0);
      expect(screen.getByText("2 passed · 1 failed · 142 ms · pytest")).toBeInTheDocument();

      // The score stage begins, and the shake runs before the count-up.
      act(() => void vi.advanceTimersByTime(timeline.resultsHoldMs + 1));
      expect(digits(), "the count-up started during the shake").toBe(0);

      act(() => void vi.advanceTimersByTime(timeline.shakeMs));
      expect(digits(), "the count-up still had not started after the shake").toBe(0);

      act(() => void vi.advanceTimersByTime(timeline.scoreCountMs + 50));
      expect(digits()).toBe(67);
    } finally {
      vi.useRealTimers();
    }
  });

  it("holds the story until the panel is on screen", () => {
    // The panel fades itself in from `opacity: 0`, and the story used to start
    // on mount — so the opening `generating` beat played behind the fade and a
    // reader arriving at the hero saw a blank panel resolve into one already
    // halfway through its prompt. jsdom has no `IntersectionObserver`, which
    // makes the "never intersected" case easy to set up and the default case
    // (above) the unusual one.
    vi.useFakeTimers();
    // Every `Reveal` on the page opens one of these too, so the panel's is
    // picked out by what it observes rather than by position.
    const observers: { cb: IntersectionObserverCallback; targets: Element[] }[] = [];
    const original = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      targets: Element[] = [];
      constructor(cb: IntersectionObserverCallback) {
        observers.push({ cb, targets: this.targets });
      }
      observe = (node: Element) => void this.targets.push(node);
      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = "";
      thresholds: readonly number[] = [];
    } as unknown as typeof IntersectionObserver;

    // `[class*=...]` because the module hash is part of the emitted name.
    const panel = () => document.querySelector('[class*="animPanel"]');

    const panelObserver = () =>
      observers.find((o) =>
        // The class is CSS-module hashed, so match the stable part of the name.
        o.targets.some((t) =>
          [...t.classList].some((c) => c.includes("animPanel")),
        ),
      );

    try {
      stubMatchMedia(false);
      render(
        <MemoryRouter>
          <Home />
        </MemoryRouter>,
      );

      // Scrolled far past the hero: intersecting, but not visible.
      act(() => void vi.advanceTimersByTime(60_000));
      expect(panelObserver(), "the panel never watched for visibility").toBeDefined();
      expect(panel(), "the terminal panel is not rendered").toBeInTheDocument();
      expect(panel()).toHaveAttribute("data-entered", "false");
      // The whole story elapsed and nothing was revealed: not a character, not
      // a row, and the score untouched.
      expect(
        screen.getByText("$", { exact: false }).textContent,
        "prompt characters were typed before the panel was visible",
      ).not.toMatch(/Implement/);
      expect(screen.queryByText("two_sum_basic")).not.toBeInTheDocument();
      expect(document.querySelector(".ringValue")?.textContent).toBe("0%");

      // Now the panel comes into view, and the story runs from the top.
      act(() => void panelObserver()!.cb(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ));
      expect(panel()).toHaveAttribute("data-entered", "true");
      // Far enough to reach the first test reveal, which is what proves the
      // story resumed from the top rather than jumping to its end.
      const firstTestAt =
        800 + 99 * TERMINAL_TIMING.typeMs + TERMINAL_TIMING.runStartMs;
      act(() =>
        void vi.advanceTimersByTime(TERMINAL_ENTRANCE_MS + firstTestAt + 1),
      );
      expect(screen.getByText(/two_sum_basic/)).toBeInTheDocument();
      // And the opening beat was not skipped over on the way there.
      expect(panel()).toHaveAttribute("data-entered", "true");
    } finally {
      globalThis.IntersectionObserver = original;
      vi.useRealTimers();
    }
  });

  it("shows a verdict beside every sample test, and only for resolved ones", () => {
    renderHomeAtRest();
    // The mark is its own `aria-hidden` element, so a row reads as the test name
    // alone and the ✓/✗ is presentation. That is the point of the split — and it
    // is why these assert the row's state rather than a string like "✓ name",
    // which no longer exists as a single text node.
    // Note the row's state is only `pending`/`running`/`done` — the verdict is
    // the mark, not the state. A row that encoded pass/fail in `data-state`
    // would put the answer in the DOM twice, and the two could drift.
    for (const [name, mark] of [
      ["two_sum_basic", "✓"],
      ["two_sum_duplicates", "✓"],
      ["two_sum_unsorted", "✗"],
    ] as const) {
      const row = screen.getByText(name).closest("li");
      expect(row, `${name} has no row`).not.toBeNull();
      expect(row).toHaveAttribute("data-state", "done");
      expect(row?.querySelector('[aria-hidden="true"]')?.textContent).toBe(mark);
    }
    // No unresolved rows at rest: the story has finished, so nothing is left
    // wearing the "still running" mark.
    expect(screen.queryByText("⋯")).not.toBeInTheDocument();
  });

  it("summarises the sample report in the counts the platform would print", () => {
    renderHomeAtRest();
    // The tally is derived from the same rows, so it cannot disagree with them.
    expect(
      screen.getByText("2 passed · 1 failed · 142 ms · pytest"),
    ).toBeInTheDocument();
  });

  it("renders the Home stats strip and guest teaser", () => {
    renderHomeAtRest();
    expect(screen.getByText("Sample figures for the prototype")).toBeInTheDocument();
    expect(screen.getByText("Languages supported")).toBeInTheDocument();
    expect(screen.getByText("LLM providers")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "See a sample evaluation — no account needed",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Try the live demo")).toBeInTheDocument();
  });
});

/**
 * The landing pages make promises about what the platform guarantees. Those
 * promises are the kind of copy that creeps back in during a rewrite, and a
 * guarantee the code does not make is a support ticket later. These assertions
 * are deliberately about the *rendered* pages rather than the copy constants,
 * so a page cannot be fixed in one place and left stale in another.
 *
 * The Home page is excluded here: its copy is corrected in #221, which
 * rewrites the hero. It is asserted there instead.
 */
describe("landing copy does not over-promise", () => {
  const pages = [
    ["Features", <Features key="f" />],
    ["Pricing", <Pricing key="p" />],
    ["About", <About key="a" />],
    ["Demo", <Demo key="d" />],
  ] as const;

  it.each(pages)("%s makes no unconditional safety guarantee", (_name, page) => {
    render(<MemoryRouter>{page}</MemoryRouter>);
    const text = document.body.textContent ?? "";
    // services/evaluation.py falls back to a host subprocess with no caps when
    // Docker is unavailable, so no page may claim a solution cannot escape.
    expect(text).not.toMatch(/can never/i);
    expect(text).not.toMatch(/never harm/i);
    expect(text).not.toMatch(/cannot harm/i);
    expect(text).not.toMatch(/guarantee[ds]? (?:your )?safety/i);
  });

  it.each(pages)("%s does not claim a single-language platform", (_name, page) => {
    render(<MemoryRouter>{page}</MemoryRouter>);
    const text = document.body.textContent ?? "";
    // Thirteen languages ship (services/languages.py). "a pytest suite" as the
    // only description understates the platform by eight languages.
    expect(text).not.toMatch(/a pytest test suite/i);
    expect(text).not.toMatch(/pytest test suites defined per challenge/i);
  });

  it("does not list shipped features as roadmap items", () => {
    render(
      <MemoryRouter>
        <About />
      </MemoryRouter>,
    );
    // Scoped to the sentence that makes the roadmap claim. Docker sandbox
    // execution and self-hosting both ship, so they belong in the "functional"
    // list — it is only wrong for them to sit in the "on the roadmap" one.
    const roadmapParagraph = (document.body.textContent ?? "")
      .split(/(?<=\.)\s+/)
      .find((sentence) => /on the roadmap/i.test(sentence));
    expect(roadmapParagraph, "About page no longer states a roadmap").toBeDefined();
    expect(roadmapParagraph).not.toMatch(/Docker sandbox/i);
    expect(roadmapParagraph).not.toMatch(/self-hosting/i);
  });
});

