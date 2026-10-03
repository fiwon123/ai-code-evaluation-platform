import { act, renderHook } from "@testing-library/react";
import { restoreMatchMedia, stubMatchMedia } from "../test/matchMedia.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attemptBeats,
  buildTimeline,
  carriedTests,
  scoreOf,
  TERMINAL_TIMING,
  useTerminalStory,
  type StoryAttemptInput,
  type StoryTestInput,
} from "./useTerminalStory.ts";

/**
 * The terminal story is a *sequence*, so the test that matters is that the
 * stages arrive in order and that nothing appears before its turn — not that
 * each stage exists. A hook that showed all three test results at t=0 and then
 * cycled the status label would satisfy every "has a stage" assertion while
 * still telling no story, which is precisely the bug #352 opened on.
 *
 * It is also a *sequence of three runs* (#389), and the second and third have to
 * be asserted as runs in their own right: same prompt, same suite, one more test
 * passing each time. "The story ends at 100%" is not enough — a story that
 * retyped the prompt, or whose attempts shared a score, would satisfy it.
 */

const PROMPT = "def f(): pass";
const TESTS: StoryTestInput[] = [
  { name: "a" },
  { name: "b" },
  { name: "c" },
];

/** One passing test, then two, then all three — 33.3, 66.7, 100. */
const ATTEMPTS: StoryAttemptInput[] = [
  { results: [true, false, false] },
  { results: [true, true, false] },
  { results: [true, true, true] },
];

function mount() {
  return renderHook(() =>
    useTerminalStory({ prompt: PROMPT, tests: TESTS, attempts: ATTEMPTS }),
  );
}

/** Run the whole timeline to its end. */
function playOut(result: { current: ReturnType<typeof mount>["result"]["current"] }) {
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  return result.current;
}

describe("buildTimeline", () => {
  const timeline = buildTimeline(PROMPT, TESTS, ATTEMPTS);
  const t = TERMINAL_TIMING;
  const first = attemptBeats(0);

  /** The first frame carrying each stage, in absolute ms. A missing `attempt` is
   *  attempt 0 — the opening frames predate any run. */
const stageAt = (stage: string, attempt = 0) =>
    timeline.frames.find(
      (frame) =>
        frame.patch.stage === stage && (frame.patch.attempt ?? 0) === attempt,
    )?.at;

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

  it("types one character per frame, once for all three attempts", () => {
    // Frame 0 carries `typedChars: 0` as the "nothing typed yet" state, so it is
    // not one of the typing frames.
    const promptFrames = timeline.frames.filter(
      (f) => (f.patch.typedChars ?? 0) > 0,
    );
    expect(promptFrames).toHaveLength(PROMPT.length);
    expect(promptFrames.map((f) => f.patch.typedChars)).toEqual(
      Array.from({ length: PROMPT.length }, (_, i) => i + 1),
    );
    // And nothing after the typing re-opens it: three attempts, one prompt. A
    // frame that reset `typedChars` would show the panel retyping the same
    // sentence three times, which is the one thing the story must not do.
    const lastTyped = timeline.frames.at(-1)!.at;
    const retype = timeline.frames.filter(
      (f) => (f.patch.typedChars ?? PROMPT.length) < PROMPT.length && f.at > t.generatingMs + t.typeMs * PROMPT.length,
    );
    expect(retype, "the prompt is typed once, before the first run").toEqual([]);
    expect(lastTyped).toBeGreaterThan(t.generatingMs + t.typeMs * PROMPT.length);
  });

  it("starts and resolves each test on its own offset", () => {
    const runStart = t.generatingMs + t.typeMs * PROMPT.length + t.runStartMs;
    const starts = TESTS.map((_, i) => runFrameAt(timeline, "runningCount", i + 1, 0));
    starts.forEach((at, i) => {
      expect(at).toBe(runStart + i * first.testGapMs);
    });
    // Resolution trails the start, and a test resolves before the next one
    // starts — so the rows overlap the way a real suite does rather than
    // arriving in pairs.
    const firstResolve = runFrameAt(timeline, "resolved", 1, 0);
    expect(firstResolve).toBe(runStart + first.testResolveMs);
    expect(firstResolve).toBeLessThan(starts[1]);
  });

  it("enters `results` on the last resolution and holds before the score", () => {
    const runStart = t.generatingMs + t.typeMs * PROMPT.length + t.runStartMs;
    const lastResolve =
      runStart + (TESTS.length - 1) * first.testGapMs + first.testResolveMs;
    expect(stageAt("results", 0)).toBe(lastResolve);
    // The score waits out `resultsHoldMs` on the outcome — the beat that stops
    // the score and the final tick landing together.
    expect(timeline.scoreStarts[0]).toBe(lastResolve + first.resultsHoldMs);
  });

  it("ends one shake plus one count-up after the *last* score begins", () => {
    const last = timeline.frames[timeline.frames.length - 1];
    const lastAttempt = ATTEMPTS.length - 1;
    const finalScoreStart = timeline.scoreStarts[lastAttempt]!;
    // The closing attempt's own beats, not the first attempt's: the final one is
    // trimmed like the second, and reading `firstAttempt` here would have passed
    // against a timeline that forgot to trim.
    const closing = attemptBeats(lastAttempt);
    expect(last.patch.stage).toBe("ready");
    expect(last.at).toBe(
      finalScoreStart + closing.shakeMs + closing.scoreCountMs + closing.scoreHoldMs,
    );
  });

  it("scores each attempt on its own beat, trimming the two after the first", () => {
    // The gap between one attempt's score starting and the next is what a visitor
    // waits through. The second attempt is trimmed, so its span must be strictly
    // shorter than the first's — a retune that gave all three attempts identical
    // beats would add ~4s to the panel and fail here.
    expect(attemptBeats(0)).toEqual(TERMINAL_TIMING.firstAttempt);
    expect(attemptBeats(1)).toEqual(TERMINAL_TIMING.laterAttempt);
    expect(attemptBeats(2)).toEqual(TERMINAL_TIMING.laterAttempt);
    const later = attemptBeats(1);
    for (const key of [
      "testGapMs",
      "testResolveMs",
      "resultsHoldMs",
      "shakeMs",
      "scoreCountMs",
      "scoreHoldMs",
    ] as const) {
      expect(later[key], `${key} must be trimmed for the later attempts`).toBeLessThan(
        first[key],
      );
    }
    // And the trims are real on the timeline: attempt 2's score starts sooner
    // after its own last result than attempt 1's did.
    const spanOf = (attempt: number) => {
      const results = stageAt("results", attempt)!;
      return timeline.scoreStarts[attempt]! - results;
    };
    expect(spanOf(1)).toBe(spanOf(2));
    expect(spanOf(1)).toBeLessThan(spanOf(0));
  });

  it("removes the failures between runs instead of clearing the panel", () => {
    // A retry that emptied the panel would tell the reader the second attempt
    // proved nothing: the same three rows go green from scratch and the rising
    // score has nothing to do with the rows above it. So the `retrying` frames
    // walk the counts *down* from the last attempt's rows to the ones that passed,
    // one row per frame, and nothing green is ever in the path.
    //
    // Two frames for the first retry (two failures came back red) and one for the
    // second (one did). Asserted as a list rather than as "there is a retry frame"
    // because the count is the claim: a single frame dropping both rows at once
    // reads as a redraw, which is the version this replaced.
    const retries = timeline.frames.filter((f) => f.patch.stage === "retrying");
    expect(retries.map((f) => f.patch.attempt)).toEqual([1, 1, 2]);
    expect(
      retries.map((f) => f.patch.resolved),
      "attempt 1's failures drop one at a time, then attempt 2's",
    ).toEqual([2, 1, 2]);
    expect(retries.map((f) => f.patch.runningCount)).toEqual([2, 1, 2]);

    // Nothing is left hanging: every retry beat ends with the panel showing
    // exactly the rows the next attempt carries, resolved and green.
    for (const frame of retries) {
      expect(frame.patch.resolved).toBe(frame.patch.runningCount);
      expect(frame.patch.resolved).toBeGreaterThan(0);
    }

    // And the beat is spent dropping rows, not waiting on a fixed pause: the rows
    // come out evenly across `retryMs`, so two rows at 180ms reads as a
    // deliberate act and one row still gets the whole beat rather than a snap.
    // Ending on `retryMs` rather than starting there is deliberate — the panel
    // holds its rows until there is somewhere for them to have gone.
    const scoreEnd = (attempt: number) =>
      timeline.scoreStarts[attempt]!
      + attemptBeats(attempt).shakeMs
      + attemptBeats(attempt).scoreCountMs
      + attemptBeats(attempt).scoreHoldMs;
    const offsetsByAttempt = new Map<number, number[]>();
    for (const frame of retries) {
      const attempt = frame.patch.attempt!;
      offsetsByAttempt.set(attempt, [
        ...(offsetsByAttempt.get(attempt) ?? []),
        frame.at - scoreEnd(attempt - 1),
      ]);
    }
    expect(offsetsByAttempt.get(1)).toEqual([180, 360]);
    expect(offsetsByAttempt.get(2)).toEqual([360]);
  });

  it("keeps every row that passed, and re-runs only the rest", () => {
    // The other half of the contract, and the one a reader checks by eye: the
    // second attempt does not re-prove the first test. Frames after the retry
    // reach `runningCount: 2` while `resolved` is already 1, which is the shape
    // of a suite that kept its ✓ and re-ran the rest.
    const afterFirstRetry = timeline.frames.filter(
      (f) => (f.patch.attempt ?? 0) === 1 && f.patch.stage !== "retrying",
    );
    const firstRunning = afterFirstRetry.find((f) => f.patch.stage === "running")!;
    expect(
      firstRunning.patch.runningCount,
      "attempt 2's first re-run is its second test, not its first",
    ).toBe(2);

    // And the score's climb is accounted for by the rows: one pass, then two,
    // then three — the same numbers `passedCount` reports, in the same order.
    const scores = timeline.scoreStarts.map((_, attempt) => attempt);
    expect(scores).toEqual([0, 1, 2]);
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

  it("fits the budget the three runs are allowed", () => {
    // One run used to be 6.1s. Three runs that show the scale have to cost about
    // what one used to, or the scale is not worth the wait. The budget is the
    // guard on the *story*, not on a comment claiming a number: a fourth attempt
    // or a slower typewriter fails here instead of in production.
    //
    // The ceiling rose from 9s to 11s when the count-up was slowed on user
    // feedback: the climb is the demonstration, and a 520ms 33→67 read as a jump.
    // The fixture prompt is 14 characters against the shipping 99, which is the
    // only reason the shipping timeline (~10s) is not what this number bounds —
    // it bounds the *shape*, and the shape is still one story, not four runs.
    //
    // The floor exists for a story that lost a stage — a timeline that stopped
    // early would sail under it.
    expect(timeline.durationMs).toBeLessThanOrEqual(11_000);
    expect(timeline.durationMs).toBeGreaterThan(6_000);
  });

  it("still visits `results` when there are no tests to run", () => {
    const empty = buildTimeline(PROMPT, [], []);
    const stages = empty.frames.map((frame) => frame.patch.stage);
    expect(stages).toContain("results");
    expect(stages[stages.length - 1]).toBe("ready");
  });

  it("treats no attempts as one empty run rather than never settling", () => {
    // A caller that passes no attempts still reaches `ready`; otherwise
    // `complete` is false forever and the panel never comes to rest.
    const none = buildTimeline(PROMPT, TESTS, []);
    expect(none.frames.at(-1)!.patch.stage).toBe("ready");
    expect(none.scoreStarts).toHaveLength(1);
  });
});

describe("carriedTests", () => {
  // The sample's own attempts: one pass, then two, then three.
  const accumulating = ATTEMPTS;

  it("keeps the tests that passed last time and still pass", () => {
    // 1 into the second attempt, 2 into the third: the first test is re-proven
    // once and never again, which is the whole point of a retry.
    expect(carriedTests(TESTS, accumulating[0], accumulating[1])).toBe(1);
    expect(carriedTests(TESTS, accumulating[1], accumulating[2])).toBe(2);
  });

  it("carries a row the new run would fail", () => {
    // This is the one that must never happen: a ✓ left on screen above a suite
    // that has just failed it. The count is the leading run of tests green in
    // *both* attempts, so a regression stops the carry instead of inheriting it.
    expect(carriedTests(TESTS, { results: [true, true, true] }, { results: [false, true, true] }))
      .toBe(0);
  });

  it("carries only the leading run, never a later pass", () => {
    // A suite can go  ✗ ✓ ✓ → ✗ ✓ ✓: the first two are green but they are not a
    // prefix, so nothing carries and the whole suite is re-run. Carrying a
    // non-prefix would leave the removal removing rows from the middle, which the
    // timeline's counts cannot express.
    expect(carriedTests(TESTS, { results: [false, true, true] }, { results: [false, true, true] }))
      .toBe(0);
  });

  it("has nothing to carry from no previous attempt", () => {
    expect(carriedTests(TESTS, undefined, accumulating[0])).toBe(0);
  });

  it("is bounded by the tests and by whichever results array is short", () => {
    expect(carriedTests(TESTS, { results: [true] }, { results: [true] })).toBe(1);
    expect(carriedTests([], { results: [true] }, { results: [true] })).toBe(0);
  });
});

describe("scoreOf", () => {
  it("rounds the way the backend does", () => {
    // `services/evaluation.py` computes `round((passed / total) * 100, 1)`, so a
    // third of a suite is 33.3 and two thirds is 66.7 — not 33 or 67. The hero
    // used to claim a score its own backend would never print for the result
    // beside it.
    expect(scoreOf(1, 3)).toBe(33.3);
    expect(scoreOf(2, 3)).toBe(66.7);
    expect(scoreOf(3, 3)).toBe(100);
  });

  it("is 0 for an empty run rather than NaN", () => {
    expect(scoreOf(0, 0)).toBe(0);
  });
});

/**
 * The absolute time of the frame that sets `key` to `value` within `attempt`.
 *
 * Throws rather than returning `undefined`: a missing frame means the timeline
 * stopped describing the thing being asserted, and an `undefined` would only
 * surface as a confusing `toBeLessThan` type error or a silent `NaN`.
 */
function runFrameAt(
  timeline: { frames: { at: number; patch: Record<string, unknown> }[] },
  key: string,
  value: number,
  attempt = 0,
): number {
  const at = timeline.frames.find(
    (frame) => frame.patch[key] === value && (frame.patch.attempt ?? 0) === attempt,
  )?.at;
  if (at === undefined) {
    throw new Error(`no frame sets ${key} to ${value} in attempt ${attempt}`);
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
    expect(result.current.attempt).toBe(1);
    expect(result.current.attemptCount).toBe(3);
  });

  it("reveals nothing before its turn, then the tests one at a time", () => {
    stubMatchMedia(false);
    const t = TERMINAL_TIMING;
    const first = attemptBeats(0);
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

    // The first test is present but unresolved: `running`, not a guess. Its
    // verdict is attempt 1's, not the suite's — it is the one that fails here.
    elapseTo(runStarts);
    expect(result.current.stage).toBe("running");
    expect(result.current.tests).toEqual([{ name: "a", passed: true, state: "running" }]);

    elapseTo(runStarts + first.testResolveMs);
    expect(result.current.tests).toEqual([{ name: "a", passed: true, state: "done" }]);
  });

  it("reaches the resting state on the *last* attempt, fully passing", () => {
    stubMatchMedia(false);
    const { result } = mount();
    const final = playOut(result);

    expect(final.stage).toBe("ready");
    expect(final.label).toBe("report ready");
    expect(final.complete).toBe(true);
    expect(final.prompt).toBe(PROMPT);
    expect(final.promptComplete).toBe(true);
    // Attempt 3's verdicts, not attempt 1's: the resting frame is what a reader
    // who scrolls past the animation sees, and it has to show the suite passing.
    expect(final.attempt).toBe(3);
    expect(final.tests).toEqual([
      { name: "a", passed: true, state: "done" },
      { name: "b", passed: true, state: "done" },
      { name: "c", passed: true, state: "done" },
    ]);
    expect(final.passedCount).toBe(3);
    expect(final.failedCount).toBe(0);
    expect(final.score).toBe(100);
  });

  it("walks the score up through the three attempts", () => {
    // The reason the story has three runs: the ring steps red → orange → green,
    // and these are the three scores that put it there.
    stubMatchMedia(false);
    const { result } = mount();
    const seen: Array<{ stage: string; attempt: number; score: number; passed: number }> = [];
    for (let elapsed = 0; elapsed < 60_000; elapsed += 20) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
      const { stage, attempt, score, passedCount } = result.current;
      if (seen.at(-1)?.stage !== stage) {
        seen.push({ stage, attempt, score, passed: passedCount });
      }
    }
    const scores = seen.filter((s) => s.stage === "score").map((s) => s.score);
    expect(scores, "each attempt scores its own result").toEqual([33.3, 66.7, 100]);
    const passes = seen.filter((s) => s.stage === "score").map((s) => s.passed);
    expect(passes).toEqual([1, 2, 3]);
    // And the header can say which run this is throughout.
    expect(new Set(seen.map((s) => s.attempt))).toEqual(new Set([1, 2, 3]));
  });

  it("keeps the old score and takes the failed rows off screen between attempts", () => {
    // The beat that makes three attempts read as one piece of work being finished:
    // attempt 1's 33% must not still be on screen when attempt 2's suite is
    // running, and its ✗ rows must not either.
    //
    // Sampled rather than read from the timeline because this is the claim a
    // reader makes with their eyes: the ring emptying *while* the row that failed
    // is still there, then the row going, is the repair. Checking the frames
    // directly would prove the timeline was right without proving the panel shows
    // it, which is the half that broke first.
    stubMatchMedia(false);
    const { result } = mount();
    let sawRepair = false;
    let sawScore1 = false;
    const removals: number[] = [];
    for (let elapsed = 0; elapsed < 60_000; elapsed += 20) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
      if (result.current.stage === "score" && result.current.attempt === 1) {
        sawScore1 = true;
      }
      if (sawScore1 && result.current.stage === "retrying") {
        const { tests, attempt, resolvedCount } = result.current;
        // The rows still up are the *previous* attempt's, carrying its verdicts:
        // the ones that came back red are on their way out, and each one that
        // leaves takes its ✗ with it. What is left at the end is green.
        //
        // Read from the attempt being repaired instead, the red row would be
        // painted green one beat before the re-run that would earn it, and a beat
        // after that it would be removed as a ✓ — the "a passing row disappeared"
        // defect #389 promised would never happen (#389).
        expect(tests.map((test) => test.passed)).toEqual(
          ATTEMPTS[attempt - 2]!.results.slice(0, tests.length),
        );
        expect(tests.length).toBeGreaterThan(0);
        expect(resolvedCount, "a row being removed is finished, not running").toBe(
          tests.length,
        );
        expect(result.current.prompt, "the prompt stays typed").toBe(PROMPT);
        // The ring holds the score it reached rather than rewinding to nothing,
        // and it holds the score the rows on screen came from — not the one the
        // repair is working towards, which would have the ring counting up over a
        // suite that has not run yet.
        expect(result.current.ringValue).toBe(
          scoreOf(
            ATTEMPTS[attempt - 2]!.results.filter(Boolean).length,
            TESTS.length,
          ),
        );
        expect(result.current.ringFrom).toBe(result.current.ringValue);
        // Sampled every 20ms, so one removal spans several samples; recorded on
        // the change only, which is what turns the samples back into the beats.
        if (removals.at(-1) !== tests.length) {
          removals.push(tests.length);
        }
        sawRepair = true;
      }
    }
    expect(sawRepair, "attempt 2 must start by removing attempt 1's failures").toBe(true);
    // Both failures went, one after the other, and then the last one: 3 → 2 → 1
    // → 2 → 3 rows across the whole story. Not the panel emptying and refilling.
    expect(removals).toEqual([2, 1, 2]);
  });

  it("hands the ring one number to hold and one to count from, and never rewinds", () => {
    // The ring's contract (#389). Two numbers, because they answer different
    // questions: what is on the ring *now*, and where the next count-up begins.
    //
    // During the repair the two are the same number — the ring holds what it drew
    // while the failures are pulled out — and they differ only inside a score
    // stage, which is where the ring moves. A timeline that only carried `score`
    // could not express that: the digits and the arc's fill would each have to
    // re-derive "hold the last one", from two different places, and they would
    // not agree.
    stubMatchMedia(false);
    const { result } = mount();
    const held = new Set<string>();
    const ringValues: number[] = [];
    for (let elapsed = 0; elapsed < 60_000; elapsed += 20) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
      const { stage, ringValue, ringFrom } = result.current;
      held.add(`${stage}:${ringValue}:${ringFrom}`);
      if (ringValues.at(-1) !== ringValue) ringValues.push(ringValue);
    }

    // Before any score is out there is nothing to hold and nothing to count from.
    expect(held.has("running:0:0")).toBe(true);
    // Each score stage counts from the score before it, and holds afterwards.
    expect(held.has("score:33.3:0"), "attempt 1 counts from nothing").toBe(true);
    expect(held.has("score:66.7:33.3"), "attempt 2 counts from 33.3").toBe(true);
    expect(held.has("score:100:66.7"), "attempt 3 counts from 66.7").toBe(true);
    expect(held.has("retrying:33.3:33.3"), "the ring holds 33 while repairing").toBe(
      true,
    );
    expect(held.has("retrying:66.7:66.7"), "the ring holds 67 while repairing").toBe(
      true,
    );
    // And the numbers the ring goes through, in order, going up.
    expect(ringValues).toEqual([0, 33.3, 66.7, 100]);
  });

  it("never shows a verdict a row has not earned in the run on screen", () => {
    // The failure mode this design rules out, stated as an invariant over the
    // whole story rather than as a moment: every mark on screen belongs to the run
    // the panel is currently showing.
    //
    // Two runs are on screen at once during a repair — the header counts up to the
    // attempt being repaired while the rows are still the previous attempt's — so
    // "the rows are this attempt's" is not the invariant. The marks are the
    // previous attempt's, which is what a reader needs to see: the row that failed
    // is still red while it is being taken away, and comes back green only once
    // the re-run has resolved it. A row that kept a verdict from a run it has left
    // is a pass the reader was never shown being earned.
    stubMatchMedia(false);
    const { result } = mount();
    const cameBack: string[] = [];
    let onScreen = result.current.tests.length;
    for (let elapsed = 0; elapsed < 60_000; elapsed += 20) {
      act(() => {
        vi.advanceTimersByTime(20);
      });
      const { tests, stage, attempt } = result.current;
      // A row that reappears is always in flight, whatever it read before. This is
      // the frame-by-frame form of "a verdict is earned on screen", and it is
      // recorded here because it is the one claim that cannot be read off a single
      // moment.
      if (stage === "running" && tests.length > onScreen) {
        cameBack.push(`${tests.at(-1)!.name}:${tests.at(-1)!.state}`);
      }
      onScreen = tests.length;
      expect(tests.length).toBeLessThanOrEqual(TESTS.length);
      expect(tests.map((test) => test.name)).toEqual(
        TESTS.slice(0, tests.length).map((test) => test.name),
      );
      // During a repair the rows are still the previous attempt's; everywhere else
      // they are this attempt's.
      const from = stage === "retrying" ? ATTEMPTS[attempt - 2] : ATTEMPTS[attempt - 1];
      expect(tests.map((test) => test.passed)).toEqual(
        from!.results.slice(0, tests.length),
      );
      if (stage === "retrying") {
        // A row on its way off screen is finished, not in flight: nothing spins
        // while it is being taken away.
        for (const test of tests) {
          expect(test.state, `${test.name} is ${test.state} during the repair`).toBe(
            "done",
          );
        }
      }
    }
    // Every row that came back on screen came back unresolved — including the two
    // that were pulled out for another run and had a verdict a moment earlier.
    expect(cameBack.length, "no row ever came back on screen").toBeGreaterThan(0);
    expect(cameBack).not.toContain("b:done");
    expect(cameBack).not.toContain("c:done");
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
      "retrying",
      "running",
      "results",
      "score",
      "retrying",
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
    // Attempt 1's tally: one passing, two failing.
    expect(result.current.failedCount).toBe(2);

    elapseTo(scoreAtMs + 1);
    expect(result.current.stage).toBe("score");

    // The shake and the whole count-up pass, and then the panel *holds* on the
    // score (`scoreHoldMs`) for a beat before the next run clears it. Asserting
    // the hold matters: it is the window in which attempt 1's 33% is legible
    // after the digits have landed, and a retune that dropped it would let a
    // starved count-up race the stage boundary and leave the arc holding a score
    // the number had not reached.
    elapseTo(scoreAtMs + shakeMs + scoreDurationMs - 1);
    expect(result.current.stage).toBe("score");
    elapseTo(scoreAtMs + shakeMs + scoreDurationMs + 1);
    expect(result.current.stage, "the score holds until the next run starts").toBe(
      "score",
    );
    elapseTo(
      scoreAtMs +
        shakeMs +
        scoreDurationMs +
        attemptBeats(0).scoreHoldMs +
        TERMINAL_TIMING.retryMs,
    );
    expect(result.current.stage).toBe("retrying");
    expect(result.current.attempt).toBe(2);
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
    expect(result.current.passedCount).toBe(3);
    expect(result.current.failedCount).toBe(0);
    // The *last* attempt, at 100 — a reduced-motion reader sees the result the
    // story ends on, not attempt 1's 33%.
    expect(result.current.attempt).toBe(3);
    expect(result.current.score).toBe(100);
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
    expect(result.current.score).toBe(100);
  });

  it("leaves no timer pending when unmounted mid-story", () => {
    stubMatchMedia(false);
    const { unmount } = mount();
    act(() => {
      vi.advanceTimersByTime(TERMINAL_TIMING.generatingMs);
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    // A ~190-frame chain is exactly the kind of thing that leaks if the
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
          useTerminalStory({
            prompt: PROMPT,
            tests: TESTS,
            attempts: ATTEMPTS,
            leadInMs: lead,
          }),
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
      expect(result.current.attempt).toBe(3);
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
      // would run the story `LEAD x frames` long, which for ~190 frames is
      // nearly two minutes of extra typing.
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