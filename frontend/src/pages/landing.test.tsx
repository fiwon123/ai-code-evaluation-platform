import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attemptBeats, TERMINAL_TIMING } from "../hooks/useTerminalStory.ts";
import { restoreMatchMedia, stubMatchMedia } from "../test/matchMedia.ts";
import About from "./About/About.tsx";
import Demo from "./Demo/Demo.tsx";
import Features from "./Features/Features.tsx";
import Home from "./Home/Home.tsx";
/**
 * The hero terminal's sample report, scoped.
 *
 * Since #355 the page carries a second panel that lists the *same* sample test
 * names — the teaser run log, which is a summary of the run the terminal plays in
 * full. So a page-wide query for `two_sum_basic` now matches twice, and the
 * assertions that concern the story have to say which panel they mean.
 * `[class*=...]` because the module hash is part of the emitted name.
 */
const storyReport = () =>
  within(document.querySelector('[class*="sampleReport"]') as HTMLElement);

/**
 * The terminal panel's header, where the attempt number and the stage tag live.
 *
 * Scoped separately from `storyReport` because the attempt counter is *not* part
 * of the report: it qualifies the panel, and a page-wide query for "attempt"
 * would also match the three-run assertion in the hook suite's prose.
 */
const storyHeader = () =>
  within(document.querySelector('[class*="animHeader"]') as HTMLElement);

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
    // 100, not 88. `services/evaluation.py` scores a run as
    // `round((passed / total) * 100, 1)`, and the panel used to print 88 beside a
    // visible ✗ — a number the landing page's own backend would never produce for
    // the result beside it. `ScoreRing` rounds for display, so the accessible name
    // is 100.
    //
    // The report at rest is the *third* attempt: the terminal runs the same prompt
    // three times (33.3 → 66.7 → 100) so the score ring steps through the scale,
    // and the resting frame is the one where the suite passes. The attempt number
    // is in the label so a reader using assistive tech knows which run they are
    // being told about.
    expect(
      screen.getByRole("img", {
        name: "Sample score, attempt 3 of 3 100 / 100",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Sample evaluation report"),
    ).toBeInTheDocument();
    expect(screen.getByText("attempt 3 of 3")).toBeInTheDocument();
  });

  /**
   * The stat sweep (#354).
   *
   * The four values used to all start at the same 200ms delay, so they grew
   * together. Every one of them still reached the right number, which is why
   * this could not be caught by asserting the values — only by watching *when*
   * each one starts.
   */
  describe("the How-it-works stat sweep", () => {
    /** The value in each step card, as `[text, counting]` in DOM order. */
    function sweep() {
      return [...document.querySelectorAll<HTMLElement>('[class*="stepStatValue"]')].map(
        (el) => ({
          text: el.textContent ?? "",
          counting: el.dataset.counting,
        }),
      );
    }

    it("runs the values one after another, left to right", () => {
      vi.useFakeTimers();
      try {
        stubMatchMedia(false);
        render(
          <MemoryRouter>
            <Home />
          </MemoryRouter>,
        );

        // Long after every delay has elapsed but before the first value could
        // have finished on its own: nothing has started, and nothing is left
        // half-finished.
        const before = sweep();
        expect(before, "no stat values rendered").toHaveLength(4);
        for (const value of before) {
          expect(value.text).toMatch(/^0/);
        }

        // Walk the whole sweep, recording when each value first leaves zero.
        // The order is the claim: value 1 must finish before value 2 starts.
        const startedAt: number[] = [];
        const settledAt: number[] = [];
        let elapsed = 0;
        while (startedAt.length < 4 || settledAt.length < 4) {
          elapsed += 50;
          act(() => void vi.advanceTimersByTime(50));
          sweep().forEach((value, index) => {
            const moving = value.counting === "true";
            const atZero = value.text.startsWith("0");
            if (!atZero && startedAt[index] === undefined) startedAt[index] = elapsed;
            if (!moving && !atZero && settledAt[index] === undefined) {
              settledAt[index] = elapsed;
            }
          });
          expect(elapsed, "the sweep never finished").toBeLessThan(30_000);
        }

        expect(
          startedAt,
          "the four values did not start in document order",
        ).toEqual([...startedAt].sort((a, b) => a - b));
        for (let i = 1; i < 4; i += 1) {
          expect(
            startedAt[i],
            `value ${i} started at ${startedAt[i]}ms, before value ${i - 1} settled at ${settledAt[i - 1]}ms`,
          ).toBeGreaterThan(settledAt[i - 1]!);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("finishes on the exact targets, with nothing left counting", () => {
      vi.useFakeTimers();
      try {
        stubMatchMedia(false);
        render(
          <MemoryRouter>
            <Home />
          </MemoryRouter>,
        );
        act(() => void vi.advanceTimersByTime(30_000));
        // "Finishes in a stable state" is the acceptance criterion, and it is a
        // different claim from "reaches the right number": a sweep that stopped
        // at 96% of its target would pass a value assertion at a glance.
        expect(sweep().map((v) => [v.text, v.counting])).toEqual([
          ["13", "false"],
          ["6", "false"],
          ["3", "false"],
          ["64 KB", "false"],
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * The deferral, which is the fix rather than a nicety.
     *
     * The sweep used to begin on mount: four rAF loops running a screen above
     * the section, against the terminal animation that nobody watching them
     * could see. It was measurable — `terminal-story.spec.ts` asserts on a real
     * timed animation and failed intermittently while the two competed for the
     * main thread (three runs, one or two failures each, against a clean
     * baseline). Deferring to first intersection fixed it and made the page do
     * less work on load, so it is locked here rather than left to the e2e suite.
     */
    it("does not start counting until the section is on screen", () => {
      vi.useFakeTimers();
      // Captures the hook's callback so the test can deliver the intersection
      // the browser would. jsdom has no IntersectionObserver at all, so without
      // this stub the hook takes its "unavailable" path and is visible
      // immediately — which is exactly the case that hides this regression.
      // Every callback, not just the last one. This used to keep a single
      // `deliver`, which silently assumed the page mounts one observer — true
      // until #355 added a second `useInView` for the teaser log, at which point
      // `deliver` held the *teaser's* callback and the test was asserting that
      // the stat sweep never runs while delivering the one event that starts it.
      const callbacks: IntersectionObserverCallback[] = [];
      class FakeObserver {
        constructor(cb: IntersectionObserverCallback) {
          // A block body on purpose: an expression-bodied arrow returns
          // `act`'s thenable, which makes the enclosing `act` look async and
          // React then demands an `await` that a sync test cannot give.
          callbacks.push(cb);
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
      }
      vi.stubGlobal("IntersectionObserver", FakeObserver);

      try {
        stubMatchMedia(false);
        render(
          <MemoryRouter>
            <Home />
          </MemoryRouter>,
        );

        // Long past the whole sweep: an observer exists, nothing has intersected,
        // and so no value may have moved.
        act(() => void vi.advanceTimersByTime(30_000));
        expect(
          sweep().map((v) => v.text),
          "the sweep ran while the section was off-screen",
          // The 4th keeps its " KB" suffix — only the value is deferred.
        ).toEqual(["0", "0", "0", "0 KB"]);

        // On screen, the sweep runs — the deferral is a delay, not a removal.
        // Annotated as `Element` rather than left as `HTMLElement`: the partial
        // entry literal is only comparable to the full entry type at the
        // declared width the callback expects.
        const target = document.body as Element;
        act(() => {
          for (const cb of callbacks) {
            cb(
              [{ isIntersecting: true, target } as IntersectionObserverEntry],
              {} as IntersectionObserver,
            );
          }
        });
        act(() => void vi.advanceTimersByTime(30_000));
        expect(sweep().map((v) => v.text)).toEqual(["13", "6", "3", "64 KB"]);
      } finally {
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });

    it("shows every value settled for a reduced-motion reader", () => {
      // No sweep at all: `useCountUp` returns its target when motion is reduced,
      // so all four are final on the first frame.
      renderHomeAtRest();
      expect(sweep().map((v) => v.text)).toEqual([
        "13",
        "6",
        "3",
        "64 KB",
      ]);
      for (const value of sweep()) {
        expect(value.counting).toBe("false");
      }
    });
  });

  it("holds the digits at 0% through each shake, then counts up once per attempt", () => {
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
      // labelled with the *target* — "…100 / 100" — from the first frame, which
      // is right for a screen reader and useless for this: the count being
      // asserted lives in the `<text>`.
      const digits = () => {
        const value = document.querySelector(".ringValue");
        return Number(value?.textContent?.replace("%", "").trim() ?? "0");
      };
      const attempts = () =>
        storyHeader().getByText(/^attempt \d of \d$/).textContent;
      // The result rows as a reader sees them: the verdict mark is its own
      // element, so the row's own text is the pair.
      const rows = () =>
        [...document.querySelectorAll('[class*="sampleTests_"] li')].map((row) =>
          (row.textContent ?? "").trim(),
        );

      // The story waits for the panel's own fade before its first frame, so
      // every offset below is measured from *after* that. The lead-in is read
      // from the component rather than repeated here, because if the two ever
      // disagree this test would be asserting against a timeline the page no
      // longer runs — and it would still pass, one beat out of step.
      const t = TERMINAL_TIMING;
      const first = attemptBeats(0);
      const later = attemptBeats(1);

      // Absolute ms at which attempt `index`'s count-up finishes, from the same
      // constants the hook builds its frames from. Accumulated in `elapsed`
      // rather than as deltas, because a chain of seven `advanceTimersByTime`
      // increments is arithmetic that has to be re-derived by hand every time a
      // beat is retuned — and a wrong delta fails as a timing flake, not as a
      // broken story.
      const typing = TERMINAL_ENTRANCE_MS + t.generatingMs + 99 * t.typeMs;
      /**
       * Absolute ms at which an attempt's count-up finishes, from the same
       * constants the hook builds its frames from.
       *
       * Two shapes rather than one: the first attempt runs all three tests
       * straight after the prompt, and every later attempt spends `retryMs`
       * pulling its failures out first and then runs only the ones it pulled out.
       * So the number of rows that start is part of the offset — which is what
       * makes the later attempts shorter.
       */
      const attempt = (beats: typeof first, runStart: number, rows: number) => {
        const scoreStart =
          runStart +
          (rows - 1) * beats.testGapMs +
          beats.testResolveMs +
          beats.resultsHoldMs;
        return {
          scoreStart,
          end:
            scoreStart +
            beats.shakeMs +
            beats.scoreCountMs +
            beats.scoreHoldMs,
        };
      };
      // Attempt 1: all three rows, no repair beat.
      const firstRun = typing + t.runStartMs;
      const firstAttempt = attempt(first, firstRun, 3);
      // Attempt 2: two failures pulled out, then those two re-run.
      const secondRun = firstAttempt.end + t.retryMs + t.runStartMs;
      const secondAttempt = attempt(later, secondRun, 2);
      // Attempt 3: the last failure pulled out, then re-run.
      const thirdRun = secondAttempt.end + t.retryMs + t.runStartMs;
      const thirdAttempt = attempt(later, thirdRun, 1);
      let elapsed = 0;
      /**
       * Advance to an absolute time, in 50ms steps.
       *
       * The stepping is not cosmetic. `useCountUp` counts on
       * `requestAnimationFrame`, and one `advanceTimersByTime(1900)` does not
       * hand the count-up the frames it needs: jumping straight over a whole
       * attempt leaves the digits on the previous attempt's value, so the
       * second and third counts silently read 0. A browser gets ~60 of those
       * frames a second, and this test is about timing, so its clock moves the
       * way the real one does.
       */
      const elapseTo = (target: number) => {
        while (elapsed < target) {
          const step = Math.min(50, target - elapsed);
          // Its own `act`, so each step is its own commit. Batching 1.4s of
          // timers into one flush collapses the story's frames into a single
          // render, and the count-up's `requestAnimationFrame` work scheduled by
          // that render never gets the turns it needs to reach its target.
          act(() => {
            vi.advanceTimersByTime(step);
          });
          elapsed += step;
        }
      };

      // Every value the ring is read at, so "never rewinds" can be asserted over
      // the whole story rather than at three chosen moments.
      const seenDigits: number[] = [];

      // Throughout attempt 1's run the score has not started.
      elapseTo(
        typing +
          t.runStartMs +
          2 * first.testGapMs +
          first.testResolveMs,
      );
      expect(digits()).toBe(0);
      seenDigits.push(digits());
      expect(attempts()).toBe("attempt 1 of 3");
      expect(
        screen.getByText("1 passed · 2 failed · 142 ms · pytest"),
      ).toBeInTheDocument();

      // The score stage begins, and the shake runs before the count-up.
      elapseTo(firstAttempt.scoreStart + 1);
      expect(digits(), "the count-up started during the shake").toBe(0);
      seenDigits.push(digits());

      elapseTo(firstAttempt.scoreStart + first.shakeMs);
      expect(digits(), "the count-up still had not started after the shake").toBe(0);
      seenDigits.push(digits());

      elapseTo(firstAttempt.end + 50);
      expect(digits(), "attempt 1 passes one test of three").toBe(33);
      seenDigits.push(digits());

      // The repair. The two failures are pulled out and only they re-run — the ✓
      // stays exactly where it was — and the ring *holds* 33 while that happens
      // rather than emptying. This is the change that makes the three attempts one
      // ring instead of three: the panel now reads "one test passes, two still
      // running" beside a number that has not gone backwards.
      elapseTo(secondRun);
      expect(attempts()).toBe("attempt 2 of 3");
      expect(digits(), "the ring holds its score while the failures come out").toBe(33);
      seenDigits.push(digits());
      expect(rows(), "the ✓ stays; the first ✗ is back and running again").toEqual([
        "✓two_sum_basic",
        "⋯two_sum_duplicates",
      ]);
      expect(screen.getByText("running suite…")).toBeInTheDocument();

      elapseTo(secondAttempt.end + 50);
      expect(digits(), "attempt 2 passes two tests of three").toBe(67);
      seenDigits.push(digits());
      expect(
        screen.getByText("2 passed · 1 failed · 142 ms · pytest"),
      ).toBeInTheDocument();

      // The last one: one failure pulled out, the two ✓ untouched, ring held at 67
      // until the re-run finishes.
      elapseTo(thirdRun);
      expect(attempts()).toBe("attempt 3 of 3");
      expect(digits(), "the ring still holds 67 before the last fix").toBe(67);
      seenDigits.push(digits());
      expect(
        rows(),
        "the two ✓ are untouched; only the last ✗ is back and running",
      ).toEqual([
        "✓two_sum_basic",
        "✓two_sum_duplicates",
        "⋯two_sum_unsorted",
      ]);

      // And the last one lands on a full pass, which is the resting state.
      elapseTo(thirdAttempt.end + 50);
      expect(digits()).toBe(100);
      seenDigits.push(digits());
      expect(attempts()).toBe("attempt 3 of 3");
      expect(
        screen.getByText("3 passed · 0 failed · 142 ms · pytest"),
      ).toBeInTheDocument();

      // The whole claim in one line: 0 while the suite runs, then up to 100 and
      // never down. A ring that emptied between attempts would show 33 → 0 here,
      // and a ring that jumped ahead would show 33 → 67 before the re-run.
      expect(seenDigits).toEqual([0, 0, 0, 33, 33, 67, 67, 100]);
      for (let i = 1; i < seenDigits.length; i += 1) {
        expect(seenDigits[i], "the ring rewound").toBeGreaterThanOrEqual(
          seenDigits[i - 1]!,
        );
      }
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
      expect(storyReport().queryByText("two_sum_basic")).not.toBeInTheDocument();
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
        TERMINAL_TIMING.generatingMs +
        99 * TERMINAL_TIMING.typeMs +
        TERMINAL_TIMING.runStartMs;
      act(() =>
        void vi.advanceTimersByTime(TERMINAL_ENTRANCE_MS + firstTestAt + 1),
      );
      expect(storyReport().getByText(/two_sum_basic/)).toBeInTheDocument();
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
      ["two_sum_unsorted", "✓"],
    ] as const) {
      const row = storyReport().getByText(name).closest("li");
      expect(row, `${name} has no row`).not.toBeNull();
      expect(row).toHaveAttribute("data-state", "done");
      expect(row?.querySelector('[aria-hidden="true"]')?.textContent).toBe(mark);
    }
    // No unresolved rows at rest: the story has finished, so nothing is left
    // wearing the "still running" mark.
    expect(storyReport().queryByText("⋯")).not.toBeInTheDocument();
  });

  it("marks each attempt's own failures while the story runs", () => {
    // The marks belong to the attempt on screen, not to the suite. At rest the
    // panel has always passed all three, which means a report that hard-coded a
    // ✓ would pass every assertion above while never showing a failure at all —
    // and the ring stepping red → orange → green is only legible if the failures
    // it corresponds to are on screen when it happens.
    vi.useFakeTimers();
    try {
      stubMatchMedia(false);
      render(
        <MemoryRouter>
          <Home />
        </MemoryRouter>,
      );
      const t = TERMINAL_TIMING;
      const first = attemptBeats(0);
      // Far enough into attempt 1 for all three of its results to have resolved,
      // but before its score, so the failures are visible on their own.
      act(() =>
        void vi.advanceTimersByTime(
          TERMINAL_ENTRANCE_MS +
            t.generatingMs +
            99 * t.typeMs +
            t.runStartMs +
            2 * first.testGapMs +
            first.testResolveMs +
            1,
        ),
      );
      expect(storyHeader().getByText("attempt 1 of 3")).toBeInTheDocument();
      for (const [name, mark] of [
        ["two_sum_basic", "✓"],
        ["two_sum_duplicates", "✗"],
        ["two_sum_unsorted", "✗"],
      ] as const) {
        const row = storyReport().getByText(name).closest("li");
        expect(row?.querySelector('[aria-hidden="true"]')?.textContent, name).toBe(mark);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("summarises the sample report in the counts the platform would print", () => {
    renderHomeAtRest();
    // The tally is derived from the same rows, so it cannot disagree with them.
    // At rest that is attempt 3, where all three pass.
    expect(
      screen.getByText("3 passed · 0 failed · 142 ms · pytest"),
    ).toBeInTheDocument();
  });

  it("renders the step figures and guest teaser", () => {
    renderHomeAtRest();
    // The four figures moved into the How-it-works cards (#354), so there is no
    // strip and no caption left to assert. Their honesty is covered in
    // homeAmbient.test.tsx, which checks each number against the backend.
    for (const label of [
      "languages supported",
      "LLM providers",
      "attempts per submission",
      "of logs captured",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(
      screen.queryByText("Sample figures for the prototype"),
    ).not.toBeInTheDocument();
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

