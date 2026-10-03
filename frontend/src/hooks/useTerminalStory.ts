import { useEffect, useMemo, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * The Home hero terminal, as a single sequenced story (issues #352, #389).
 *
 * This replaces four independent clocks — a typewriter interval, a status
 * interval that looped forever, CSS `animation-delay` on the result rows, and a
 * `900ms`-delayed ring fill — with **one**. That is the whole point of the
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
 * ## Three attempts, one prompt
 *
 * The story runs the same prompt three times: one test passing, then two, then
 * all three — 33.3, 66.7, 100. The prompt is typed once, before the first run,
 * because re-typing it three times would say the work was done three times when
 * the point is that the *same* prompt was tried again.
 *
 * The reason is the score scale (#389). One run can only ever put the arc in one
 * band, so the four-colour scale was invisible on the page that exists to
 * demonstrate it. Three runs put it through red → orange → green, which is the
 * claim the ring makes and the thing a visitor has to be able to see.
 *
 * ## Each attempt repairs the last one rather than replacing it
 *
 * This is the part that is easy to get wrong. The obvious retry is to clear the
 * panel — every row, every count, the ring back to zero — and run the whole suite
 * again, and that is what this hook used to do. It is wrong because it tells the
 * reader the second attempt proved nothing: the same three rows go green from
 * scratch, and the rising score has nothing to do with the rising number of
 * passing tests. It also throws away the only evidence that the work is
 * *cumulative*, which is what a second attempt is for.
 *
 * So a retry removes only the rows that failed. The ones that passed stay on
 * screen with their marks, because a passing test is not re-proven by re-running
 * it; the failures are pulled out one at a time, and only those are run again. The
 * numbers then move for a reason a reader can check against the rows above them:
 * 33.3 with one ✓ and two ✗, 66.7 after the ✗s come back as one ✓ and one ✗, 100
 * when the last ✗ returns as a ✓. Nothing is re-typed, nothing green ever
 * disappears, and the ring's rise is legible as *the same suite, with fewer
 * failures*, rather than as three unrelated runs.
 *
 * Later attempts are also *trimmer* — shorter test gaps, a shorter shake, a
 * quicker count-up — because the first attempt is the one being read, each later
 * one runs fewer tests than the last, and the visitor is watching the failures
 * disappear rather than waiting for a third full suite. A retune that gives all
 * three attempts identical beats makes the whole panel 6s longer than it needs to
 * be and the visitor sees the last run as filler.
 *
 * Reduced motion is the *final* state, not the empty one: the last attempt, every
 * test resolved, the whole prompt present, the score at 100. `enter.css`
 * explains why that distinction is the difference between a safe opt-out and a
 * broken one.
 */

export type StoryStage =
  | "generating"
  | "prompt"
  | "running"
  | "results"
  | "score"
  | "retrying"
  | "ready";

export type StoryTestState = "pending" | "running" | "done";

export interface StoryTestInput {
  /**
   * Test name, as the runner prints it.
   *
   * No `passed` here: which tests pass changes per attempt, so the verdict lives
   * on the attempt. Leaving it on the test too would mean two answers to the
   * same question and a reduced-motion reader would be shown whichever one the
   * tests array happened to carry.
   */
  name: string;
}

export interface StoryAttemptInput {
  /** Pass/fail per test, in the same order as `tests`. */
  results: readonly boolean[];
}

export interface StoryTest extends StoryTestInput {
  passed: boolean;
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
  /**
   * The tests on screen: the ones carried over from the last attempt, plus the
   * ones this attempt has re-run so far. A pending one is absent, and a row is
   * absent again if it was removed to be re-run.
   */
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
  /** This attempt's score, for the ring. */
  score: number;
  /**
   * The score the ring should be *showing* at this frame.
   *
   * Normally `score` — except during the repair beat between attempts, where it
   * is the last score the ring drew. The digits and the arc both hold that value,
   * so the ring never rewinds and never jumps ahead: it climbs 0 → 33 → 67 → 100
   * with a pause at each score while the failures are pulled out. Handing the ring
   * `score` here instead would make it jump to the next attempt's number during
   * the repair — 33 → 67 with nothing drawn yet, then a count from 67 to 67, so
   * the second attempt's rise would be lost entirely.
   */
  ringValue: number;
  /**
   * Where the next count-up starts: the score already on the ring.
   *
   * A fact in the data rather than something the animation remembers, because the
   * ring's arc is filled by CSS from a custom property and a CSS keyframe cannot
   * read a value out of a hook. Both halves of the ring climb from the same
   * number at the same instant, so that number has to be one value in one place.
   * Zero for the first attempt, which is where its count starts anyway.
   */
  ringFrom: number;
  /** 1-based attempt number, as shown in the header. */
  attempt: number;
  attemptCount: number;
  /**
   * ms from mount at which this attempt's score stage begins, for the ring's
   * shake and for tests that want to step to it. Read from the timeline rather
   * than written down again, so the CSS delay and the state machine cannot drift
   * apart.
   */
  scoreAtMs: number;
  /** ms the shake runs before the count-up starts, for this attempt. */
  shakeMs: number;
  /** ms the count-up runs, for this attempt. */
  scoreDurationMs: number;
}

/**
 * The beats one attempt runs on.
 *
 * Split out from the shared timing because attempts 2 and 3 are trimmed. See the
 * module comment for why that is the design rather than an optimisation.
 */
export interface AttemptBeats {
  /** Start-to-start between successive tests. */
  testGapMs: number;
  /** How long a test shows as running before it resolves. */
  testResolveMs: number;
  /** Beat between the last result and the score, so they do not land together. */
  resultsHoldMs: number;
  shakeMs: number;
  scoreCountMs: number;
  /**
   * Beat after the count-up finishes, before the stage ends.
   *
   * The count is a `requestAnimationFrame` loop and the stage is a chained
   * `setTimeout`; under load the loop can miss the frame the stage ends on, and
   * the panel then shows a held arc beside a number still climbing — 33% drawn
   * next to 15%. The margin is what stops the two halves of one ring disagreeing:
   * the number always gets at least this long to land on the score the arc is
   * already holding, and the reader gets a beat to read the settled number before
   * the repair starts pulling rows out.
   */
  scoreHoldMs: number;
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
 * typing is 16ms a character against roughly 8ms of render, which both keeps the
 * cadence honest and reads as a person typing rather than a machine flushing a
 * buffer.
 *
 * The shape of the whole thing, at the prompt this page ships (99 characters).
 * Each retry is shorter than the last *because it runs fewer tests*: it removes
 * the failures and re-runs only those.
 *
 * | span                                       | ms   |
 * | ------------------------------------------ | ---- |
 * | generating                                 | 700  |
 * | typing, 99 × `typeMs`                      | 1584 |
 * | attempt 1 — 3 tests, shake, count, settle  | 3180 |
 * | attempt 2 — 2 failures removed, 2 re-run   | 2400 |
 * | attempt 3 — 1 failure removed, 1 re-run    | 1500 |
 * | **total**                                  | **~10.7s** |
 *
 * ~10.7s for three runs. That is deliberately slower than the 8s it started at:
 * the count-up is the part a visitor is actually watching, and the user-visible
 * complaint was that it flew past — a later attempt counted 33 → 67 in 520ms,
 * which reads as a jump rather than as *the score climbing because the failures
 * are being fixed*. The counts are now 1.5s, then 1.1s, then 1.1s, and the ring
 * holds each one through the repair beats, so the climb and the removals are the
 * same story rather than two things happening near each other. The repair beats
 * and the score-stage hold grew with them so the held number stays legible
 * before it moves again.
 *
 * The first attempt alone used to be 6.1s, so the whole story still costs about
 * what one attempt used to — which is the budget: the score scale needs three
 * runs to be legible, and the visitor is not being asked to wait for three times
 * as long to see it.
 * `useTerminalStory.test.ts` holds the total under `TOTAL_BUDGET_MS`, so adding a
 * fourth attempt or a longer typewriter fails there rather than in production.
 *
 * A caveat for whoever retunes these against the dev server: the numbers you
 * measure there are roughly double production, because `main.tsx` mounts under
 * `StrictMode` and every render is invoked twice. A 16ms gap against a ~6.5ms
 * production frame is comfortable; the same measurement in dev shows ~13ms and
 * makes the gap look marginal. Tune against the budget, not the dev reading.
 *
 * This is also why nothing else in the panel is scheduled against a wall clock;
 * see `AnimatedTerminal` for the ring, which is triggered by the story rather
 * than given a deadline to hit.
 */
export const TERMINAL_TIMING = {
  generatingMs: 700,
  typeMs: 16,
  /**
   * Beat between the prompt finishing and the first test starting.
   *
   * Not cosmetic: without it the first test's start frame lands on exactly the
   * last typing frame's timestamp, and a chained `setTimeout(fn, 0)` is applied
   * one macrotask *after* the frame it follows. Every frame in this timeline has
   * a real duration, which `has no zero-length frame` in the test enforces.
   */
  runStartMs: 180,
  /**
   * The whole repair beat: from one attempt's score to the next run starting.
   *
   * Spent removing the failed rows, not waiting — split across the rows being
   * dropped so the removal is one row per beat and the last row leaves on the
   * last frame. It is shorter than the redraws it replaced; with two failures to
   * remove that is 180ms each, which is enough to read as a deliberate act
   * rather than a flicker, and one row still gets the whole beat rather than a
   * snap.
   */
  retryMs: 360,
  /** The first run gets the full beats: it is the one being read. */
  firstAttempt: {
    testGapMs: 320,
    testResolveMs: 220,
    resultsHoldMs: 260,
    shakeMs: 300,
    scoreCountMs: 1500,
    scoreHoldMs: 260,
  } satisfies AttemptBeats,
  /**
   * Every later run, trimmed.
   *
   * The gaps come down hardest and the count-up least, because the gap is what
   * a visitor perceives as waiting while the count-up is what they are watching.
   */
  laterAttempt: {
    testGapMs: 220,
    testResolveMs: 160,
    resultsHoldMs: 200,
    shakeMs: 200,
    scoreCountMs: 1100,
    scoreHoldMs: 200,
  } satisfies AttemptBeats,
} as const;

/** The beats for attempt `index`. */
export function attemptBeats(index: number): AttemptBeats {
  return index === 0 ? TERMINAL_TIMING.firstAttempt : TERMINAL_TIMING.laterAttempt;
}

/**
 * How many tests carry into attempt `index` from the one before it.
 *
 * The count is the leading run of tests that pass in *both* attempts, because a
 * retry is only allowed to keep a row that is still green — carrying a row the
 * new run would fail would put a ✓ on screen above a suite that had just failed
 * it, which is the one thing this story must never do.
 *
 * Requiring both also makes the shape a *prefix*: carried rows are always the
 * first N, so the timeline can drop rows from the end and re-run the tail with
 * counts rather than with per-test bookkeeping. For the sample's accumulating
 * results that is 1, then 2 — the first attempt's single ✓ is never re-run, and
 * neither is the second attempt's.
 *
 * Exported because it is the story's actual contract — what a reader is watching
 * happen — and `useTerminalStory.test.ts` pins it directly rather than inferring
 * it from frame timings.
 */
export function carriedTests(
  tests: readonly StoryTestInput[],
  previous: StoryAttemptInput | undefined,
  next: StoryAttemptInput,
): number {
  const count = Math.min(tests.length, previous?.results.length ?? 0, next.results.length);
  let carried = 0;
  while (carried < count && previous!.results[carried] && next.results[carried]) {
    carried += 1;
  }
  return carried;
}

/**
 * Tag text per stage.
 *
 * `generating` covers both the opening beat and the prompt typing: the code is
 * being generated *from* that prompt, so advancing the tag there would claim
 * work that has not started. `running test` likewise holds across the reveal
 * and the results, because the results are that run's output. `re-running` is the
 * only stage that exists because there is more than one attempt; it is the beat
 * where the failed rows are pulled out and the score drops back to zero, and
 * calling it `running test` would claim a suite is moving while the failures are
 * still on screen.
 * `report ready` is the resting text, and the only one a reduced-motion reader
 * sees.
 */
const STAGE_LABELS: Record<StoryStage, string> = {
  generating: "generating",
  prompt: "generating",
  running: "running test",
  results: "running test",
  score: "scoring",
  retrying: "re-running",
  ready: "report ready",
};

export interface Snapshot {
  stage: StoryStage;
  typedChars: number;
  /**
   * Zero-based index of the attempt on screen.
   *
   * Carried on *every* frame, not just the ones that change it, so the timeline
   * can be asked a question about attempt 2 without the caller having to work out
   * which frames happen to carry the field.
   */
  attempt: number;
  /** Tests that have started, in order. */
  runningCount: number;
  /** Tests that have resolved, in order. */
  resolved: number;
  /** What the score ring shows; see `TerminalStory.ringValue`. */
  ringValue: number;
  /** What the next count-up starts from; see `TerminalStory.ringFrom`. */
  ringFrom: number;
}

const INITIAL: Snapshot = {
  stage: "generating",
  typedChars: 0,
  attempt: 0,
  runningCount: 0,
  resolved: 0,
  ringValue: 0,
  ringFrom: 0,
};

export interface Frame {
  /** Absolute ms from mount. */
  at: number;
  patch: Partial<Snapshot>;
}

export interface Timeline {
  frames: Frame[];
  /** ms from mount at which each attempt's score stage begins. */
  scoreStarts: number[];
  /** ms from mount to the last frame. */
  durationMs: number;
}

/** One empty attempt, so a caller that passes none still reaches `ready`. */
const NO_ATTEMPTS: readonly StoryAttemptInput[] = [{ results: [] }];

/** Exported for tests: a pure function of its inputs, so its absolute frame
 *  times can be asserted directly rather than inferred through fake timers. */
export function buildTimeline(
  prompt: string,
  tests: readonly StoryTestInput[],
  attempts: readonly StoryAttemptInput[],
): Timeline {
  const t = TERMINAL_TIMING;
  // A caller with no attempts gets one empty one rather than a story that runs
  // the prompt and then stops with no `ready` frame — `complete` would be false
  // forever and the panel would never settle.
  const runs = attempts.length > 0 ? attempts : NO_ATTEMPTS;
  const frames: Frame[] = [];
  const scoreStarts: number[] = [];
  let at = 0;
  const step = (ms: number, patch: Partial<Snapshot>) => {
    at += ms;
    frames.push({ at, patch });
  };

  // 1. `generating` — the title and tag are up; nothing has been typed yet.
  step(t.generatingMs, { stage: "generating", typedChars: 0, attempt: 0 });

  // 2. The prompt types out, one character per frame — once, for all three runs.
  //    A frame per character is the price of a single clock: `setInterval` would
  //    be cheaper, but then the next stage has to be scheduled off the
  //    interval's own completion and the two clocks are back, which is the bug
  //    this hook exists to remove.
  for (let chars = 1; chars <= prompt.length; chars += 1) {
    step(t.typeMs, { stage: "prompt", typedChars: chars });
  }

  const lastIndex = runs.length - 1;
  /**
   * How much of the circle the ring already has drawn, in score points.
   *
   * Walked forwards rather than read out of the frames behind, because the value
   * a count-up starts from is the score *before* it — and on the first attempt
   * that is nothing at all, not zero out of a lookup that has not happened yet.
   */
  let drawnScore = 0;
  runs.forEach((run, index) => {
    const beats = attemptBeats(index);
    const testCount = Math.min(tests.length, run.results.length);
    // Where this attempt's count begins, and what it climbs to.
    const attemptFrom = drawnScore;
    let attemptPassed = 0;
    for (let i = 0; i < testCount; i += 1) {
      if (run.results[i]) attemptPassed += 1;
    }
    const attemptScore = scoreOf(attemptPassed, testCount);
    /** Patched onto every frame before this attempt's score: the ring holds. */
    const holding = { ringValue: attemptFrom, ringFrom: attemptFrom };
    // Which rows survive into this attempt: the ones that passed last time and
    // still pass this time. Everything after them is pulled out and re-run.
    const carried = index === 0 ? 0 : carriedTests(tests, runs[index - 1], run);

    // 3. A visible beat between runs — spent *removing the failures*, one row per
    //    beat, rather than clearing the panel.
    //
    //    The counts walk down from `testCount` to `carried`, so the rows that go
    //    are exactly the ones that came back red, and the rows that were green
    //    never move. The clock advances as it drops them, which is what makes the
    //    removal something to watch: one frame that emptied all three at once read
    //    as a redraw, and a row that vanished alongside a falling ring read as the
    //    panel being reloaded.
    //
    //    A run with nothing to remove still gets its beat. The story would
    //    otherwise have no `retrying` frame at all, and the next attempt's first
    //    test would be scheduled from the score frame with nothing in between —
    //    which is the zero-length frame the `results` beat exists to avoid.
    if (index > 0) {
      const dropped = testCount - carried;
      const dropMs = dropped > 0 ? t.retryMs / dropped : t.retryMs;
      for (let revealed = testCount - 1; dropped > 0 && revealed >= carried; revealed -= 1) {
        step(dropMs, {
          stage: "retrying",
          attempt: index,
          runningCount: revealed,
          resolved: revealed,
          ...holding,
        });
      }
      if (dropped === 0) {
        step(dropMs, {
          stage: "retrying",
          attempt: index,
          runningCount: testCount,
          resolved: testCount,
          ...holding,
        });
      }
    }

    // 4. Each test starts and resolves on its own offset from the run's start, so
    //    they interleave the way a real suite does rather than arriving in pairs.
    //    Sorted because the two offsets per test do not line up with the iteration.
    //
    //    Only the removed tail runs: the carried rows are already resolved and
    //    already green, so re-running them would be both slower and a lie about
    //    what the retry did. The offsets are indexed from `carried`, not from
    //    `i`, or the first re-run test would wait out a gap that belongs to the
    //    rows before it — a 220ms wait in front of the panel's single remaining
    //    test, which reads as the retry hanging.
    //
    //    The *last* resolution is also what enters the `results` stage. That is
    //    not just tidiness: a frame with zero duration is applied one macrotask
    //    after its neighbour, because the chain schedules it with `setTimeout(fn,
    //    0)` and the timer that fires it is a *new* timer. So a `results` frame at
    //    the same instant as a `score` frame makes `scoreAtMs` a lie — the stage
    //    the ring is told to start on arrives after the number the ring is told to
    //    start on. Every frame here has a real duration instead.
    const runStart = at + t.runStartMs;
    const runFrames: Frame[] = [];
    const lastTest = testCount - 1;
    for (let i = carried; i < testCount; i += 1) {
      const offset = (i - carried) * beats.testGapMs;
      runFrames.push({
        at: runStart + offset,
        patch: {
          stage: "running",
          attempt: index,
          runningCount: i + 1,
          ...holding,
        },
      });
      runFrames.push({
        at: runStart + offset + beats.testResolveMs,
        patch: {
          stage: i === lastTest ? "results" : "running",
          attempt: index,
          resolved: i + 1,
          ...holding,
        },
      });
    }
    runFrames.sort((a, b) => a.at - b.at);
    frames.push(...runFrames);
    at = runFrames.length > 0 ? runFrames[runFrames.length - 1].at : at;

    // 5. A beat on the outcome, so the score does not land on the same frame as the
    //    final tick. With no tests to run there is no resolution to carry the
    //    `results` stage, so it gets its own frame and the same beat.
    if (runFrames.length === 0) {
      step(beats.resultsHoldMs, { stage: "results", attempt: index, ...holding });
    }

    // 6. The score. `scoreStarts[index]` is the instant the shake begins; the
    //    next frame is the end of the count-up plus `scoreHoldMs`, so the
    //    number has a margin to land on the score the arc holds rather than
    //    racing the boundary. The ring's delay is the shake and its duration is
    //    `scoreCountMs`, both for this attempt.
    step(beats.resultsHoldMs, {
      stage: "score",
      attempt: index,
      ringValue: attemptScore,
      ringFrom: attemptFrom,
    });
    scoreStarts.push(at);
    drawnScore = attemptScore;
    if (index === lastIndex) {
      step(beats.shakeMs + beats.scoreCountMs + beats.scoreHoldMs, {
        stage: "ready",
        ringValue: attemptScore,
        ringFrom: attemptFrom,
      });
    } else {
      // No frame: the score stage is already on screen for this whole span, and
      // emitting a second one would only give the story a place to restart. The
      // clock still advances, which is what keeps the next `retrying` frame a real
      // distance from the `score` frame rather than a zero-length hop. The ring
      // keeps the value this score stage drew, which is what `drawnScore` is for.
      at += beats.shakeMs + beats.scoreCountMs + beats.scoreHoldMs;
    }
  });

  return { frames, scoreStarts, durationMs: at };
}

function reduceAll(frames: Frame[]): Snapshot {
  return frames.reduce<Snapshot>(
    (state, frame) => ({ ...state, ...frame.patch }),
    INITIAL,
  );
}

/** Passed/total as the backend would print it: `round(passed / total * 100, 1)`. */
export function scoreOf(passed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((passed / total) * 1000) / 10;
}

export function useTerminalStory({
  prompt,
  tests,
  attempts,
  leadInMs = 0,
}: {
  prompt: string;
  /** Must be referentially stable — a fresh array restarts the story. */
  tests: readonly StoryTestInput[];
  /**
   * One entry per run of the prompt, each with a pass/fail per test. Must be
   * referentially stable for the same reason `tests` is.
   *
   * A caller that passes none gets a single run with no tests, so the panel still
   * reaches its resting state rather than hanging on the prompt.
   */
  attempts: readonly StoryAttemptInput[];
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
  const timeline = useMemo(
    () => buildTimeline(prompt, tests, attempts),
    [prompt, tests, attempts],
  );
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
    // stage arrives before the ring was told to start, and the last stage lands
    // early. Nothing looks wrong on screen, which is why `buildTimeline`'s
    // absolute times are asserted directly below rather than only through the
    // rendered stage names.
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

  const runs = attempts.length > 0 ? attempts : NO_ATTEMPTS;
  const attemptIndex = Math.min(snapshot.attempt, runs.length - 1);
  const run = runs[attemptIndex]!;
  const beats = attemptBeats(attemptIndex);

  /**
   * Whether the panel is pulling failures out to re-run them.
   *
   * The rows on screen through this beat are the *previous* attempt's: they have
   * not been re-run, so their verdicts have to be read from the run they came
   * from. Reading them from `run` instead paints the row that failed last time
   * green — the next attempt's verdict, a beat before the re-run that would earn
   * it — and a beat after that it removes that green row to re-run it anyway. The
   * e2e suite caught it as a ✓ being taken off screen and put back (#389), which
   * is the one thing the incremental repair promised would never happen: a reader
   * sees a passing row disappear.
   *
   * The header still counts up to this attempt, which is right: the repair is
   * this attempt's work, and the rows are what is left of the last one's.
   */
  const repair = snapshot.stage === "retrying";
  const shown = repair && attemptIndex > 0 ? runs[attemptIndex - 1]! : run;

  // Only the first `tests.length` results count, so an attempt that forgot a
  // verdict reads as "not passed" instead of inflating the score past 100.
  const results = shown.results.slice(0, tests.length);
  const passedCount = results.filter(Boolean).length;

  const storyTests: StoryTest[] = tests.map((test, index) => ({
    name: test.name,
    passed: results[index] === true,
    state:
      index < snapshot.resolved
        ? "done"
        : // Nothing is "running" during a repair. The re-run has not started, and
          // a row that is merely on its way out is finished, not in flight —
          // marking it running would draw a spinner on a row that is being
          // removed.
          repair || index >= snapshot.runningCount
          ? "pending"
          : "running",
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
    /**
     * This attempt's score.
     *
     * The target is known from the start of the run, so it is already this
     * attempt's score while the tests are still resolving — which is why the ring
     * is not given this number to draw until the score stage says so.
     */
    score: scoreOf(passedCount, results.length),
    /** What the ring draws right now — `score` from the score stage onwards, the
     *  last drawn score while the failures are being pulled out. See
     *  `TerminalStory.ringValue`. */
    ringValue: snapshot.ringValue,
    /** Where the ring's next count-up starts. See `TerminalStory.ringFrom`. */
    ringFrom: snapshot.ringFrom,
    /** 1-based, because it is shown to a reader: "attempt 2 of 3". */
    attempt: attemptIndex + 1,
    attemptCount: runs.length,
    /** ms from mount at which *this* attempt's score stage begins. */
    scoreAtMs: timeline.scoreStarts[attemptIndex] ?? 0,
    shakeMs: beats.shakeMs,
    scoreDurationMs: beats.scoreCountMs,
  };
}