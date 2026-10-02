import { useEffect, useMemo, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * The Home hero terminal, as a single sequenced story (issue #352).
 *
 * This replaces four independent clocks — a typewriter interval, a status
 * interval that looped forever, CSS `animation-delay` on the result rows, and
 * a `900ms`-delayed ring fill — with **one**. That is the whole point of the
 * change. The four never agreed with each other, so the panel showed its test
 * results and a score while the prompt was still being typed, and the status
 * pill cycled `Generating → Running → Scoring → Report ready` on a loop that
 * had no relationship to any of it. It listed stages rather than performing
 * them.
 *
 * One timeline, walked by one chained `setTimeout`, means "the score counts up
 * after the last test resolves" is a fact about the data rather than a hope
 * that four delays happen to line up. The same timeline also yields
 * `scoreAtMs`, which is how the ring's count-up and arc fill are put back on
 * this clock instead of their own.
 *
 * Reduced motion is the *final* state, not the empty one: every test resolved,
 * the whole prompt present, the score at its value. `enter.css` explains why
 * that distinction is the difference between a safe opt-out and a broken one.
 */

export type StoryStage =
  | "generating"
  | "prompt"
  | "running"
  | "results"
  | "score"
  | "ready";

export type StoryTestState = "pending" | "running" | "done";

export interface StoryTestInput {
  name: string;
  passed: boolean;
}

export interface StoryTest extends StoryTestInput {
  state: StoryTestState;
}

export interface TerminalStory {
  stage: StoryStage;
  /** Text for the header's stage tag. */
  label: string;
  /** The prompt as typed *so far* — empty until the `prompt` stage. */
  prompt: string;
  /** True once the whole prompt is on screen. */
  promptComplete: boolean;
  /** Only the tests the story has reached; a pending one is absent, not hidden. */
  tests: StoryTest[];
  passedCount: number;
  failedCount: number;
  /**
   * How many tests have resolved, passed or failed.
   *
   * Separate from `complete` on purpose. `complete` is the last *stage*, which
   * comes after the score has counted up, so using it to decide "the run is
   * over, show the tally" held the tally back for the whole scoring beat while
   * the panel sat there with three resolved rows above it and the words
   * "running suite…" underneath. The tally is about the rows, so it is gated on
   * the rows.
   */
  resolvedCount: number;
  /**
   * How many tests the run has in total, whether or not they have been revealed.
   *
   * Needed because `tests` is the *revealed* list, so it grows: comparing
   * `resolvedCount` against `tests.length` reads as "everything shown is done"
   * after the first row and put "1 passed · 0 failed" under a suite with two
   * tests still to run. The tally wants the whole run.
   */
  totalCount: number;
  /** True at the last stage — no further frames. */
  complete: boolean;
  /**
   * ms from mount at which the score stage begins, for the ring's shake.
   * Read from the timeline rather than written down again, so the CSS delay
   * and the state machine cannot drift apart.
   */
  scoreAtMs: number;
  /** ms the shake runs before the count-up starts. */
  shakeMs: number;
  /** ms the count-up runs. */
  scoreDurationMs: number;
}

/**
 * Stage durations, in ms.
 *
 * These were retuned after measuring the story in a browser rather than on a fake
 * clock, and the reason is worth keeping: a chained `setTimeout` cannot run
 * faster than the frames it drives, so an 18ms gap against an 18ms render cost
 * means the chain is permanently one frame behind and the *achieved* time is
 * roughly double the arithmetic. The first cut of these numbers was tuned on
 * paper, ran at 6.7s "designed", and took 8.3s in Chromium with the score landing
 * after the panel had already gone still.
 *
 * So the gap has to clear the frame cost with room to spare, not equal it. The
 * typing is 24ms a character against roughly 8ms of render, which both keeps the
 * cadence honest and reads as a person typing rather than a machine flushing a
 * buffer.
 *
 * The shape of the whole thing, at the prompt this page ships (99 characters):
 *
 * | span                        | ms   |
 * | --------------------------- | ---- |
 * | generating                  |  800 |
 * | typing, 99 × `typeMs`       | 2376 |
 * | `runStartMs`                |  220 |
 * | three tests, 2 × gap + 1 × resolve | 1060 |
 * | `resultsHoldMs`             |  280 |
 * | `shakeMs` + `scoreCountMs`  | 1400 |
 * | **total**                   | **6136** |
 *
 * The test span is the one number to keep an eye on: 1.06s is enough to follow
 * one result at a time and short enough that a visitor who has already read the
 * panel is not held. `e2e/terminal-story.spec.ts` measures the span the browser
 * actually achieves, so a retune that breaks the cadence fails there rather than
 * in a comment.
 *
 * A caveat for whoever retunes these against the dev server: the numbers you
 * measure there are roughly double production, because `main.tsx` mounts under
 * `StrictMode` and every render is invoked twice. A 24ms gap against a ~6.5ms
 * production frame is comfortable; the same measurement in dev shows ~13ms and
 * makes the gap look marginal. Tune against the budget, not the dev reading.
 *
 * This is also why nothing else in the panel is scheduled against a wall clock;
 * see `AnimatedTerminal` for the ring, which is triggered by the story rather
 * than given a deadline to hit.
 */
export const TERMINAL_TIMING = {
  generatingMs: 800,
  typeMs: 24,
  /**
   * Beat between the prompt finishing and the first test starting.
   *
   * Not cosmetic: without it the first test's start frame lands on exactly the
   * last typing frame's timestamp, and a chained `setTimeout(fn, 0)` is applied
   * one macrotask *after* the frame it follows. Every frame in this timeline has
   * a real duration, which `has no zero-length frame` in the test enforces.
   */
  runStartMs: 220,
  /** Start-to-start between successive tests. */
  testGapMs: 400,
  /** How long a test shows as running before it resolves. */
  testResolveMs: 260,
  /** Beat between the last result and the score, so they do not land together. */
  resultsHoldMs: 280,
  shakeMs: 400,
  scoreCountMs: 1000,
} as const;

/**
 * Tag text per stage.
 *
 * `generating` covers both the opening beat and the prompt typing: the code is
 * being generated *from* that prompt, so advancing the tag there would claim
 * work that has not started. `running test` likewise holds across the reveal
 * and the results, because the results are that run's output. `report ready` is
 * the resting text, and the only one a reduced-motion reader sees.
 */
const STAGE_LABELS: Record<StoryStage, string> = {
  generating: "generating",
  prompt: "generating",
  running: "running test",
  results: "running test",
  score: "scoring",
  ready: "report ready",
};

export interface Snapshot {
  stage: StoryStage;
  typedChars: number;
  /** Tests that have started, in order. */
  runningCount: number;
  /** Tests that have resolved, in order. */
  resolved: number;
}

const INITIAL: Snapshot = {
  stage: "generating",
  typedChars: 0,
  runningCount: 0,
  resolved: 0,
};

export interface Frame {
  /** Absolute ms from mount. */
  at: number;
  patch: Partial<Snapshot>;
}

export interface Timeline {
  frames: Frame[];
  scoreAtMs: number;
}

/** Exported for tests: a pure function of its inputs, so its absolute frame
 *  times can be asserted directly rather than inferred through fake timers. */
export function buildTimeline(
  prompt: string,
  tests: readonly StoryTestInput[],
): Timeline {
  const t = TERMINAL_TIMING;
  const frames: Frame[] = [];
  let at = 0;
  const step = (ms: number, patch: Partial<Snapshot>) => {
    at += ms;
    frames.push({ at, patch });
  };

  // 1. `generating` — the title and tag are up; nothing has been typed yet.
  step(t.generatingMs, { stage: "generating", typedChars: 0 });

  // 2. The prompt types out, one character per frame. A frame per character is
  //    the price of a single clock: `setInterval` would be cheaper, but then the
  //    next stage has to be scheduled off the interval's own completion and the
  //    two clocks are back, which is the bug this hook exists to remove.
  for (let chars = 1; chars <= prompt.length; chars += 1) {
    step(t.typeMs, { stage: "prompt", typedChars: chars });
  }

  // 3. Each test starts and resolves on its own offset from the run's start, so
  //    they interleave the way a real suite does rather than arriving in pairs.
  //    Sorted because the two offsets per test do not line up with the iteration.
  //
  //    The *last* resolution is also what enters the `results` stage. That is
  //    not just tidiness: a frame with zero duration is applied one macrotask
  //    after its neighbour, because the chain schedules it with `setTimeout(fn,
  //    0)` and the timer that fires it is a *new* timer. So a `results` frame at
  //    the same instant as a `score` frame makes `scoreAtMs` a lie — the stage
  //    the ring is told to start on arrives after the number the ring is told to
  //    start on. Every frame here has a real duration instead.
  const runStart = at + t.runStartMs;
  const lastIndex = tests.length - 1;
  const runFrames: Frame[] = [];
  tests.forEach((_, index) => {
    runFrames.push({
      at: runStart + index * t.testGapMs,
      patch: { stage: "running", runningCount: index + 1 },
    });
    runFrames.push({
      at: runStart + index * t.testGapMs + t.testResolveMs,
      patch: {
        stage: index === lastIndex ? "results" : "running",
        resolved: index + 1,
      },
    });
  });
  runFrames.sort((a, b) => a.at - b.at);
  frames.push(...runFrames);
  at = runFrames.length > 0 ? runFrames[runFrames.length - 1].at : at;

  // 4. A beat on the outcome, so the score does not land on the same frame as the
  //    final tick. With no tests to run there is no resolution to carry the
  //    `results` stage, so it gets its own frame and the same beat.
  if (runFrames.length === 0) {
    step(t.resultsHoldMs, { stage: "results" });
  }

  // 5. The score. `scoreAtMs` is the instant the shake begins and the next frame
  //    is the *end* of the count-up — so the ring's own delay is `scoreAtMs +
  //    shakeMs` and its duration is `scoreCountMs`.
  step(t.resultsHoldMs, { stage: "score" });
  const scoreAtMs = at;
  step(t.shakeMs + t.scoreCountMs, { stage: "ready" });

  return { frames, scoreAtMs };
}

function reduceAll(frames: Frame[]): Snapshot {
  return frames.reduce<Snapshot>(
    (state, frame) => ({ ...state, ...frame.patch }),
    INITIAL,
  );
}

export function useTerminalStory({
  prompt,
  tests,
  leadInMs = 0,
}: {
  prompt: string;
  /** Must be referentially stable — a fresh array restarts the story. */
  tests: readonly StoryTestInput[];
  /**
   * Wait this long before the first frame, or pass `null` to hold the story
   * until something else says go. Defaults to 0 — start now — because a caller
   * that has not thought about entrances should get the story on mount, as it
   * always did. `TERMINAL_ENTRANCE_MS` in `AnimatedTerminal` is the one caller
   * that does have to think about it.
   *
   * Only the *first* timer is offset. Every later delay is a delta between two
   * timeline frames, so pushing the start out cannot stretch the story.
   */
  leadInMs?: number | null;
}): TerminalStory {
  const reduced = usePrefersReducedMotion();
  const timeline = useMemo(() => buildTimeline(prompt, tests), [prompt, tests]);
  const finalState = useMemo(() => reduceAll(timeline.frames), [timeline]);

  // Always the first frame, never the last. `usePrefersReducedMotion` reports
  // `false` on the first render on purpose (see that hook: seeding it from
  // `matchMedia` would be a hydration mismatch), so a reduced-motion reader
  // gets one frame of the opening beat and the effect below resolves it. Seeding
  // this from `reduced` would make the very first paint correct on the client
  // and wrong on the server.
  const [snapshot, setSnapshot] = useState<Snapshot>(INITIAL);

  useEffect(() => {
    if (reduced) {
      setSnapshot(finalState);
      return;
    }
    // Nothing has been shown yet, so there is nothing to narrate. Holding here
    // rather than pausing is deliberate: a story that started on mount and was
    // caught up on scroll would open on whichever frame the reader arrived at.
    if (leadInMs === null) {
      return;
    }
    let index = 0;
    let current = INITIAL;
    let timer = 0;
    // Each timer fires *at* `frames[index].at` and applies that frame. The
    // obvious-looking alternative — increment first, then apply — applies frame
    // *i* at `frames[i-1].at` and runs the whole story one frame early: the score
    // stage arrives 420ms before the ring was told to start, and the last stage
    // lands at 3.2s instead of 4.8s. Nothing looks wrong on screen, which is
    // why `buildTimeline`'s absolute times are asserted directly below rather
    // than only through the rendered stage names.
    const advance = () => {
      current = { ...current, ...timeline.frames[index].patch };
      setSnapshot(current);
      index += 1;
      if (index < timeline.frames.length) {
        timer = window.setTimeout(
          advance,
          timeline.frames[index].at - timeline.frames[index - 1].at,
        );
      }
    };
    timer = window.setTimeout(advance, timeline.frames[0].at + leadInMs);
    // The story is decorative, so it is also a place a timer leak would be
    // invisible: only one is ever pending, and unmount clears it.
    return () => window.clearTimeout(timer);
  }, [reduced, timeline, finalState, leadInMs]);

  const storyTests: StoryTest[] = tests.map((test, index) => ({
    ...test,
    state:
      index < snapshot.resolved
        ? "done"
        : index < snapshot.runningCount
          ? "running"
          : "pending",
  }));

  return {
    stage: snapshot.stage,
    label: STAGE_LABELS[snapshot.stage],
    prompt: prompt.slice(0, snapshot.typedChars),
    promptComplete: snapshot.typedChars >= prompt.length,
    // A pending test is *absent*, not present-and-transparent. The old CSS put
    // `opacity: 0` on the rows and relied on a `forwards` fill to undo it, so
    // anything that stopped the animation — a reduced-motion override that
    // missed one selector, an animation that never ran — left the result
    // permanently invisible. Not rendering it cannot fail that way.
    tests: storyTests.filter((test) => test.state !== "pending"),
    passedCount: storyTests.filter((t) => t.state === "done" && t.passed).length,
    failedCount: storyTests.filter((t) => t.state === "done" && !t.passed).length,
    resolvedCount: storyTests.filter((t) => t.state === "done").length,
    totalCount: tests.length,
    complete: snapshot.stage === "ready",
    scoreAtMs: timeline.scoreAtMs,
    shakeMs: TERMINAL_TIMING.shakeMs,
    scoreDurationMs: TERMINAL_TIMING.scoreCountMs,
  };
}
