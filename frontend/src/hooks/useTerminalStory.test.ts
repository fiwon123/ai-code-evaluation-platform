import { act, renderHook } from "@testing-library/react";
import { restoreMatchMedia, stubMatchMedia } from "../test/matchMedia.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTimeline,
  TERMINAL_TIMING,
  useTerminalStory,
  type StoryTestInput,
} from "./useTerminalStory.ts";

/**
 * The terminal story is a *sequence*, so the test that matters is that the
 * stages arrive in order and that nothing appears before its turn — not that
 * each stage exists. A hook that showed all three test results at t=0 and then
 * cycled the status label would satisfy every "has a stage" assertion while
 * still telling no story, which is precisely the bug #352 opened on.
 */

const PROMPT = "def f(): pass";
const TESTS: StoryTestInput[] = [
  { name: "a", passed: true },
  { name: "b", passed: true },
  { name: "c", passed: false },
];


function mount() {
  return renderHook(() => useTerminalStory({ prompt: PROMPT, tests: TESTS }));
}

/** Run the whole timeline to its end. */
function playOut(result: { current: ReturnType<typeof mount>["result"]["current"] }) {
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  return result.current;
}

describe("buildTimeline", () => {
  const timeline = buildTimeline(PROMPT, TESTS);
  const t = TERMINAL_TIMING;

  /** The first frame carrying each stage, in absolute ms. */
  const stageAt = (stage: string) =>
    timeline.frames.find((frame) => frame.patch.stage === stage)?.at;

  it("emits frames in non-decreasing time order", () => {
    // The run frames are built per test and sorted, then spliced in between the
    // typing frames and the score. If that splice ever produced them out of
    // order, every `at - previousAt` below would go negative and the chain would
    // schedule a frame in the past.
    const times = timeline.frames.map((frame) => frame.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("holds the opening beat before a single character is typed", () => {
    expect(stageAt("generating")).toBe(t.generatingMs);
    expect(stageAt("prompt")).toBe(t.generatingMs + t.typeMs);
  });

  it("types one character per frame", () => {
    // Frame 0 carries `typedChars: 0` as the "nothing typed yet" state, so it is
    // not one of the typing frames.
    const promptFrames = timeline.frames.filter(
      (f) => (f.patch.typedChars ?? 0) > 0,
    );
    expect(promptFrames).toHaveLength(PROMPT.length);
    expect(promptFrames.map((f) => f.patch.typedChars)).toEqual(
      Array.from({ length: PROMPT.length }, (_, i) => i + 1),
    );
  });

  it("starts and resolves each test on its own offset", () => {
    const runStart = t.generatingMs + t.typeMs * PROMPT.length + t.runStartMs;
    const starts = TESTS.map((_, i) =>
      runFrameAt(timeline, "runningCount", i + 1),
    );
    starts.forEach((at, i) => {
      expect(at).toBe(runStart + i * t.testGapMs);
    });
    // Resolution trails the start, and a test resolves before the next one
    // starts — so the rows overlap the way a real suite does rather than
    // arriving in pairs.
    const firstResolve = runFrameAt(timeline, "resolved", 1);
    expect(firstResolve).toBe(runStart + t.testResolveMs);
    expect(firstResolve).toBeLessThan(starts[1]);
  });

  it("enters `results` on the last resolution and holds before the score", () => {
    const runStart = t.generatingMs + t.typeMs * PROMPT.length + t.runStartMs;
    const lastResolve = runStart + (TESTS.length - 1) * t.testGapMs + t.testResolveMs;
    expect(stageAt("results")).toBe(lastResolve);
    // The score waits out `resultsHoldMs` on the outcome — the beat that stops
    // the score and the final tick landing together.
    expect(timeline.scoreAtMs).toBe(lastResolve + t.resultsHoldMs);
  });

  it("ends one shake plus one count-up after the score begins", () => {
    const last = timeline.frames[timeline.frames.length - 1];
    expect(last.patch.stage).toBe("ready");
    expect(last.at).toBe(timeline.scoreAtMs + t.shakeMs + t.scoreCountMs);
  });

  it("has no zero-length frame", () => {
    // A `setTimeout(fn, 0)` link is applied one macrotask *after* its neighbour,
    // so a frame sharing a timestamp with the next one lands late — which is
    // what made an earlier draft of `scoreAtMs` a lie.
    for (let i = 1; i < timeline.frames.length; i += 1) {
      expect(
        timeline.frames[i].at - timeline.frames[i - 1].at,
        `frame ${i} must have a real duration`,
      ).toBeGreaterThan(0);
    }
  });

  it("still visits `results` when there are no tests to run", () => {
    const empty = buildTimeline(PROMPT, []);
    const stages = empty.frames.map((frame) => frame.patch.stage);
    expect(stages).toContain("results");
    expect(stages[stages.length - 1]).toBe("ready");
  });
});

/**
 * The absolute time of the frame that sets `key` to `value`.
 *
 * Throws rather than returning `undefined`: a missing frame means the timeline
 * stopped describing the thing being asserted, and an `undefined` would only
 * surface as a confusing `toBeLessThan` type error or a silent `NaN`.
 */
function runFrameAt(
  timeline: { frames: { at: number; patch: Record<string, unknown> }[] },
  key: string,
  value: number,
): number {
  const at = timeline.frames.find((frame) => frame.patch[key] === value)?.at;
  if (at === undefined) {
    throw new Error(`no frame sets ${key} to ${value}`);
  }
  return at;
}

describe("useTerminalStory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreMatchMedia();
  });

  it("starts at the opening beat with nothing typed and no tests", () => {
    stubMatchMedia(false);
    const { result } = mount();

    expect(result.current.stage).toBe("generating");
    expect(result.current.label).toBe("generating");
    expect(result.current.prompt).toBe("");
    expect(result.current.tests).toEqual([]);
  });

  it("reveals nothing before its turn, then the tests one at a time", () => {
    stubMatchMedia(false);
    const t = TERMINAL_TIMING;
    const { result } = mount();
    const elapseTo = (target: number) =>
      act(() => {
        vi.advanceTimersByTime(target - elapsed);
        elapsed = target;
      });
    let elapsed = 0;

    // Absolute targets rather than increments: the boundaries are what this test
    // is about, and arithmetic on increments drifts.
    const typingEnds = t.generatingMs + t.typeMs * PROMPT.length;
    const runStarts = typingEnds + t.runStartMs;

    elapseTo(t.generatingMs - 1);
    expect(result.current.stage).toBe("generating");
    expect(result.current.prompt).toBe("");
    expect(result.current.tests).toEqual([]);

    // Mid-typing: the prompt grows a character at a time, tests still absent —
    // an already-rendered results panel here is the bug this rewrite removes.
    elapseTo(t.generatingMs + t.typeMs * 5);
    expect(result.current.stage).toBe("prompt");
    expect(result.current.prompt).toBe(PROMPT.slice(0, 5));
    expect(result.current.tests).toEqual([]);

    elapseTo(typingEnds);
    expect(result.current.prompt).toBe(PROMPT);
    expect(result.current.tests).toEqual([]);

    // The first test is present but unresolved: `running`, not a guess.
    elapseTo(runStarts);
    expect(result.current.stage).toBe("running");
    expect(result.current.tests).toEqual([{ name: "a", passed: true, state: "running" }]);

    elapseTo(runStarts + t.testResolveMs);
    expect(result.current.tests).toEqual([{ name: "a", passed: true, state: "done" }]);
  });

  it("reaches the resting state with every result and the count", () => {
    stubMatchMedia(false);
    const { result } = mount();
    const final = playOut(result);

    expect(final.stage).toBe("ready");
    expect(final.label).toBe("report ready");
    expect(final.complete).toBe(true);
    expect(final.prompt).toBe(PROMPT);
    expect(final.promptComplete).toBe(true);
    expect(final.tests).toEqual([
      { name: "a", passed: true, state: "done" },
      { name: "b", passed: true, state: "done" },
      { name: "c", passed: false, state: "done" },
    ]);
    expect(final.passedCount).toBe(2);
    expect(final.failedCount).toBe(1);
  });

  it("visits every stage in the order the issue describes", () => {
    stubMatchMedia(false);
    const { result } = mount();
    const seen: string[] = [result.current.stage];

    // Sample the timeline finely enough that no stage can slip past unobserved.
    for (let elapsed = 0; elapsed < 60_000; elapsed += 20) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
      const stage = result.current.stage;
      if (seen[seen.length - 1] !== stage) seen.push(stage);
    }

    expect(seen).toEqual([
      "generating",
      "prompt",
      "running",
      "results",
      "score",
      "ready",
    ]);
  });

  it("puts the score stage after the last test resolves, not on a fixed clock", () => {
    stubMatchMedia(false);
    const { result } = mount();
    const elapseTo = (target: number) =>
      act(() => {
        vi.advanceTimersByTime(target - elapsed);
        elapsed = target;
      });
    let elapsed = 0;

    const { scoreAtMs, shakeMs, scoreDurationMs } = result.current;
    elapseTo(scoreAtMs - 1);

    // One tick before scoring begins, every result is settled and the score has
    // not started — the ordering four independent delays could not guarantee.
    expect(result.current.stage).toBe("results");
    expect(result.current.tests.every((test) => test.state === "done")).toBe(true);
    expect(result.current.failedCount).toBe(1);

    elapseTo(scoreAtMs + 1);
    expect(result.current.stage).toBe("score");

    // The shake and the whole count-up pass before the panel comes to rest.
    elapseTo(scoreAtMs + shakeMs + scoreDurationMs - 1);
    expect(result.current.stage).toBe("score");
    elapseTo(scoreAtMs + shakeMs + scoreDurationMs + 1);
    expect(result.current.stage).toBe("ready");
    expect(result.current.complete).toBe(true);
  });

  it("goes straight to the resting state under reduced motion", () => {
    stubMatchMedia(true);
    const { result } = mount();

    // No timers advanced at all. Everything is present immediately: a reduced
    // motion opt-out that showed the *empty* first frame would leave a reader
    // with a panel that never types, never reveals a test and never scores.
    expect(result.current.stage).toBe("ready");
    expect(result.current.label).toBe("report ready");
    expect(result.current.prompt).toBe(PROMPT);
    expect(result.current.tests).toHaveLength(3);
    expect(result.current.passedCount).toBe(2);
    expect(result.current.failedCount).toBe(1);
    expect(result.current.complete).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("jumps to the resting state when the preference is turned on mid-story", () => {
    const media = stubMatchMedia(false);
    const { result } = mount();

    act(() => {
      vi.advanceTimersByTime(TERMINAL_TIMING.generatingMs + 200);
    });
    expect(result.current.stage).not.toBe("ready");
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // The live subscription in `usePrefersReducedMotion` is what makes this
    // work: a one-shot read could not answer it.
    act(() => {
      media.set(true);
    });
    expect(result.current.stage).toBe("ready");
    expect(result.current.tests).toHaveLength(3);
  });

  it("leaves no timer pending when unmounted mid-story", () => {
    stubMatchMedia(false);
    const { unmount } = mount();
    act(() => {
      vi.advanceTimersByTime(TERMINAL_TIMING.generatingMs);
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    // A 106-frame chain is exactly the kind of thing that leaks if the
    // cleanup only clears the current link.
    expect(vi.getTimerCount()).toBe(0);
  });
  /**
   * The panel this story lives in fades in from `opacity: 0` before it is
   * readable, so `leadInMs` is what stops the opening beat being spent behind
   * the fade. Held open (`null`), the story must not move at all.
   */
  describe("leadInMs", () => {
    function mountHeld(leadInMs: number | null) {
      return renderHook(
        ({ lead }: { lead: number | null }) =>
          useTerminalStory({ prompt: PROMPT, tests: TESTS, leadInMs: lead }),
        { initialProps: { lead: leadInMs } },
      );
    }

    it("does not start at all while it is null", () => {
      stubMatchMedia(false);
      const { result } = mountHeld(null);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      // Not "still generating" by luck of the clock — untouched, with no rows
      // and no characters typed, which is what a panel that has not faded in
      // should be showing.
      expect(result.current.stage).toBe("generating");
      expect(result.current.prompt).toBe("");
      expect(result.current.tests).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("waits out the lead-in and then plays the whole story", () => {
      stubMatchMedia(false);
      const LEAD = 550;
      const { result } = mountHeld(LEAD);

      // Almost, but not quite, the end of the entrance.
      act(() => {
        vi.advanceTimersByTime(LEAD - 1);
      });
      expect(result.current.prompt).toBe("");

      // Now the first frame is due, and the rest of the timeline follows.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(result.current.stage).toBe("ready");
      expect(result.current.tests).toHaveLength(3);
    });

    it("offsets only the start, so the story is not stretched", () => {
      stubMatchMedia(false);
      const LEAD = 550;
      const { result } = mountHeld(LEAD);
      act(() => {
        vi.advanceTimersByTime(
          LEAD + TERMINAL_TIMING.generatingMs + TERMINAL_TIMING.typeMs,
        );
      });
      // The first frame (`generating`, nothing typed) landed at LEAD +
      // `generatingMs`, and the second one `typeMs` later — exactly as it would
      // be with no lead-in. A lead-in that leaked into the per-frame deltas
      // would run the story `LEAD x frames` long, which for 106 frames is
      // nearly a minute of extra typing.
      expect(result.current.stage).toBe("prompt");
      expect(result.current.prompt).toBe(PROMPT[0]);
    });

    it("ignores the lead-in for reduced motion", () => {
      stubMatchMedia(true);
      const { result } = mountHeld(null);
      act(() => {
        vi.advanceTimersByTime(0);
      });
      // Reduced motion shows the resting state, and the hook reports "on
      // screen" immediately in that case, so a null lead-in must not leave a
      // reduced-motion reader staring at an empty terminal.
      expect(result.current.stage).toBe("ready");
      expect(result.current.tests).toHaveLength(3);
    });
  });
});
