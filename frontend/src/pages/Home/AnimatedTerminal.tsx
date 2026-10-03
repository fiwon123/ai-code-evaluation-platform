import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useTerminalStory } from "../../hooks/useTerminalStory.ts";
import ScoreRing from "../../components/ScoreRing/ScoreRing.tsx";
import styles from "./Home.module.css";

/**
 * The Home hero's terminal: one clock, one prompt, three runs, a score (issue
 * #352, and #389 for the runs).
 *
 * ## Why this is its own component
 *
 * The story used to be a hook call in `Home`, which meant every typed character
 * re-rendered the entire landing page — hero, feature grid, pipeline, stats,
 * guest teaser, footer and all the ambient layers. Measured in a real browser,
 * that cost about 18ms per frame, which is *exactly* the 18ms gap between
 * frames, so the `setTimeout` chain could never get ahead of itself and the
 * story ran at roughly half speed: the 101-character prompt took ~3.7s instead
 * of 1.8s and the whole panel took ~9s instead of 6.7s.
 *
 * That is not a cosmetic wobble, because anything scheduled against a wall clock
 * inherits the drift. It is also the reason the score ring is triggered by the
 * `data-scoring` attribute rather than by a delay: the honest fix for a late
 * story is to stop the other clocks from depending on it being punctual.
 *
 * Owning the state here fixes the cost at the source — a frame now re-renders
 * this subtree and nothing else — and leaves the page free to be a page. It took
 * a per-frame cost from ~18ms to ~8ms, which is what made the retuned 24ms
 * typing gap achievable; see `TERMINAL_TIMING` for why the gap has to clear the
 * frame cost rather than equal it.
 */

/**
 * The prompt the sample run is "given".
 *
 * Module-level, like the tests below, because `useTerminalStory` restarts its
 * timeline whenever `prompt` or `tests` change identity: a literal rebuilt on
 * every render would restart the story on every frame and it would never move.
 */
const SAMPLE_PROMPT =
  "Implement two_sum(nums, target) and return the indices of the two values that add up to the target.";

const SAMPLE_TESTS = [
  { name: "two_sum_basic" },
  { name: "two_sum_duplicates" },
  { name: "two_sum_unsorted" },
];

/**
 * The prompt is tried three times, and each try fixes one thing (issue #389).
 *
 * 33.3 → 66.7 → 100 — the scores the backend would actually print, since
 * `services/evaluation.py` computes `round((passed / total) * 100, 1)` and two of
 * three tests is 66.7. The hero used to claim 88 next to a visible `✗`, which is
 * the landing page stating a number its own backend would never produce for the
 * result shown beside it.
 *
 * Three runs rather than one because of the score scale. The ring steps red →
 * orange → green as the number counts, and one run can only ever put it in one
 * band — so the one surface built to demonstrate the scale was the one surface
 * that never showed it. These scores land on red, orange and green in that
 * order; a scale banded on quarters would put the middle run on yellow and the
 * visitor would never see orange at all.
 *
 * Each attempt adds its fix rather than re-rolling the dice, because a run that
 * failed differently each time would be a different prompt's result. The unsorted
 * case is the last one fixed, which is also the one the second attempt still
 * fails on, so the third attempt has something to show for itself.
 *
 * The rows make that visible rather than implied. A retry does not clear the
 * panel: the failures are pulled out and only they are run again, so a ✓ is never
 * re-earned and never disappears, and the ring's climb is legible against the
 * rows above it — one ✓ and two ✗, then two ✓ and one ✗, then three ✓. `see the
 * module comment in useTerminalStory.ts for why clearing the panel was the wrong
 * shape.
 */
const SAMPLE_ATTEMPTS = [
  { results: [true, false, false] },
  { results: [true, true, false] },
  { results: [true, true, true] },
];

/** Illustrative duration for the sample run, in ms, as pytest reports it. */
const SAMPLE_DURATION_MS = 142;

/**
 * How long the panel takes to fade in, in ms.
 *
 * This is the panel's own entrance rather than a `Reveal` wrapper's, and the
 * number is used for two things that must agree: the CSS transition below and
 * the story's lead-in. They were not supposed to be related at all until a
 * screenshot showed what happens when they are not.
 *
 * The panel used to be wrapped in `<Reveal delayMs={320}>`, which starts it at
 * `opacity: 0` and fades it in over 550ms. The story, meanwhile, started on
 * mount. So the two ran on different clocks and the opening beat was spent
 * behind the fade: `generating` is 800ms long, the fade finishes at ~870ms, and
 * a reader arriving at the hero saw a blank panel resolve into a panel already
 * halfway through its prompt — the one stage whose whole job is to be watched
 * from the start. Three 700ms frames across both themes agreed: correct content
 * at roughly 10% opacity, and one of them a blank hole in the hero.
 *
 * Owning the entrance here is what makes the two provably consistent. The
 * constant sets the transition *and* the lead-in, so the panel is fully opaque
 * before the first frame is applied and the drift cannot come back. The hero
 * looks the same as before — same 320ms stagger, same 550ms fade, same easing —
 * so the only change is that the story waits for the panel it is in.
 */
const TERMINAL_ENTRANCE_DELAY_MS = 320;
export const TERMINAL_ENTRANCE_MS = 550;

/**
 * Whether the panel has been scrolled into view, with the same fallback policy
 * as `Reveal`: no `IntersectionObserver` (jsdom, or a very old browser) and
 * reduced-motion readers both report "visible" immediately, so the story is
 * never withheld from someone who will never see the fade.
 */
function useOnScreen<T extends HTMLElement>(): [
  RefObject<T | null>,
  boolean,
] {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setOnScreen(true);
            // Once, like `Reveal`: a reader who scrolls away and back should not
            // replay a story that has already finished.
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, onScreen];
}

function AnimatedTerminal() {
  const [entranceRef, onScreen] = useOnScreen<HTMLDivElement>();
  const story = useTerminalStory({
    prompt: SAMPLE_PROMPT,
    tests: SAMPLE_TESTS,
    attempts: SAMPLE_ATTEMPTS,
    // Not the stagger: the story must not begin until the fade it is hidden
    // behind has finished, so the lead-in is the entrance's own duration.
    leadInMs: onScreen ? TERMINAL_ENTRANCE_MS : null,
  });

  /**
   * When the ring starts: after the shake, *relative to the score stage*.
   *
   * Passing the story's absolute score time here is the obvious version and it
   * is wrong. The story is a chain of per-character re-renders that runs late
   * under load; a ring delay is a wall-clock deadline and does not care. The e2e
   * suite caught the result: the number reached 26% while the second of three
   * tests was still running.
   *
   * So the ring is not told *when* to start, it is told *that it is time*. This
   * is the only number involved — the shake, which is 260ms on the first
   * attempt and 180ms on the two after it, so it is read per attempt rather than
   * written down once. A 400ms slip is invisible; a 5458ms one was a lie.
   */
  const ringStartDelayMs = story.shakeMs;
  const isScoring = story.stage === "score";
  /**
   * Whether the ring has a score to show at all, which is what gates the count-up.
   *
   * Not the same question as "is the score stage running", and the difference is
   * the point: once a score is out the ring *keeps* it through the repair beats
   * between attempts, so the digits hold 33 while the two failures are pulled out
   * and then climb to 67. Gating on the score stage instead rewound the number to
   * zero between attempts, which turned three attempts into three separate rings
   * and threw away the second one's climb.
   */
  const ringLive = story.ringValue > 0;
  /**
   * The value the ring draws, and the one its next count-up starts from.
   *
   * `story.ringValue` is the timeline's answer rather than a rule written here:
   * it is the attempt's own score from the score stage onwards, and the score the
   * ring already reached while the failures are being pulled out. `ringFrom` is
   * that earlier score, which is where the next count begins — so the digits and
   * the arc fill both start from one number in one place, and neither can be a
   * beat ahead of the other.
   */
  const ringValue = story.ringValue;
  const ringFrom = story.ringFrom;

  return (
    <div
      ref={entranceRef}
      className={styles.animPanel}
      data-entered={onScreen ? "true" : "false"}
      /* Fed from the same two constants as the lead-in, so the fade the story
         waits out is the fade that actually runs. The CSS carries a matching
         fallback in case these ever stop arriving. */
      style={
        {
          "--terminal-entrance": `${TERMINAL_ENTRANCE_MS}ms`,
          "--terminal-entrance-delay": `${TERMINAL_ENTRANCE_DELAY_MS}ms`,
        } as CSSProperties
      }
    >
      <span className={styles.panelGlow} aria-hidden="true" />
      <span className={styles.panelScan} aria-hidden="true" />
      {/* The header narrates progress a screen reader cannot usefully follow, so
          it is hidden from the tree; the report below carries the label. */}
      <div className={styles.animHeader} aria-hidden="true">
        <span className={styles.animDots}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.animTitle}>Code Evaluation</span>
        {/* Which of the three runs this is. Without it the panel re-resolves
              its rows and its score twice for no stated reason, and a reader
              arriving mid-story sees a suite that has failed once, then again,
              then passes — the sequence is the demonstration, so it has to be
              the one labelled. */}
          <span className={styles.animAttempt}>
            attempt {story.attempt} of {story.attemptCount}
          </span>
          <span className={styles.animStatus} data-stage={story.stage}>
          {/* `ready` is the resting state, so a pulse there would say "still
              going" about a run that has finished. */}
          <span
            className={styles.animStatusDot}
            data-active={story.complete ? "false" : "true"}
          />
          {story.label}
        </span>
      </div>

      <div className={styles.animPrompt} aria-hidden="true" data-typed={story.prompt.length}>
        <span className={styles.animPromptLabel}>$</span>
        <span className={styles.animPromptText}>
          {story.prompt}
          {/* The caret tracks the story rather than blinking on its own timer, so
              it cannot sit blinking under a finished prompt. */}
          {story.promptComplete ? null : <span className={styles.animCaret} />}
        </span>
      </div>

      {/* The outcome. Both halves of the ring are triggered by `data-scoring`: the
          arc by the attribute, the digits by `ScoreRing`'s `active`. Nothing here
          waits on a wall clock. */}
      <div
        className={styles.sampleReport}
        aria-label="Sample evaluation report"
        data-scoring={isScoring ? "true" : "false"}
        /* Separate from `data-scoring`, which is the *trigger*. Without a
           settled state the score stage ends, `data-scoring` returns to false,
           the rule naming the fill stops matching, and the arc falls back to
           holding the previous attempt's score — while the digits hold 100%. Two
           attributes because "start filling" and "is finished" are different
           claims, and conflating them is what left the ring at 67% at rest. */
        data-complete={story.complete ? "true" : "false"}
        style={
          {
            "--ring-delay": `${ringStartDelayMs}ms`,
            /* The arc takes as long as the digits, from the same constants, so
               the two cannot finish at different times if a count-up is
               retuned. It used to be a hardcoded 1.2s against a 1s count. */
            "--ring-duration": `${story.scoreDurationMs}ms`,
          } as CSSProperties
        }
      >
        <div className={styles.scoreWrap}>
          {/* `active` is "the ring has a score": the number reads 0% until the
              first score stage, then counts over the same `shakeMs` the arc waits
              out, and holds that number through the repair beats so the ring is
              never rewound between attempts.

              `delayMs` and `durationMs` are the story's, and they are load-bearing.
              They used to be `ScoreRing`'s defaults — a 900ms delay and a 1200ms
              count — against a score stage that is a 400ms shake followed by a
              1000ms count. Two clocks, and both were wrong in opposite
              directions: the number started counting 500ms before the arc did, and
              was still climbing 500ms after the stage it belongs to had ended, so
              the panel came to rest showing 55% next to a settled 67% arc.
              `active` says "start"; these two say "how long". */}
          <ScoreRing
            /* The timeline's ring value, so the arc holds 33% while attempt 1's
               failures are pulled out and then extends to 67% — one ring climbing
               to 100, not three rings each starting empty. `countFrom` is what
               makes the fill start where the last one ended. */
            value={ringValue}
            countFrom={ringFrom}
            label={`Sample score, attempt ${story.attempt} of ${story.attemptCount}`}
            animate
            scale
            active={ringLive}
            delayMs={ringStartDelayMs}
            durationMs={story.scoreDurationMs}
          />
        </div>
        <div className={styles.sampleMeta}>
          <ul className={styles.sampleTests}>
            {story.tests.map((test) => (
              <li
                key={test.name}
                className={styles.sampleTestRow}
                data-state={test.state}
              >
                {/* A test that has not resolved yet shows a mark that cannot be
                    mistaken for a verdict. */}
                <span
                  className={
                    test.state !== "done"
                      ? styles.sampleTestPending
                      : test.passed
                        ? styles.sampleTestPass
                        : styles.sampleTestFail
                  }
                  aria-hidden="true"
                >
                  {test.state !== "done" ? "⋯" : test.passed ? "✓" : "✗"}
                </span>
                {test.name}
              </li>
            ))}
          </ul>
          {/* Gated on the *whole run* having resolved, not on the story being over
              and not on the rows shown so far. All three of those are wrong in a
              different direction: `complete` held the tally back through the
              whole scoring beat, and `tests.length` counts only revealed rows, so
              it printed "1 passed · 0 failed" under a suite with two tests
              outstanding. The screenshot is what caught it; the DOM said nothing
              wrong at any point. */}
          <div className={styles.sampleMetaRow}>
            <span>
              {story.resolvedCount === story.totalCount
                ? `${story.passedCount} passed · ${story.failedCount} failed · ${SAMPLE_DURATION_MS} ms · pytest`
                : "running suite…"}
            </span>
            <span className={styles.sampleMetaLink}>View report →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnimatedTerminal;
