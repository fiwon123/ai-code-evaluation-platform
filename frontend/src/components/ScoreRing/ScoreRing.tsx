import { type CSSProperties } from "react";
import { useCountUp } from "../../hooks/useCountUp";
import { type ScoreBand, scoreBand, scoreVariant } from "../../utils/formatting";

/**
 * The four scale bands as the global arc classes that paint them (#389).
 *
 * Exported because the report's donut ring paints the same scale from the same
 * stylesheet — one map, one list of class names, so the two rings cannot drift
 * apart the way a second copy of the rules did.
 *
 * Written out rather than built as `` `ringScore${cap(band)}` ``: the string is
 * derivable, but only by someone willing to trust the mapping. `SCORE_BANDS` in
 * `formatting.test.ts` reads this table, so a typo fails a test instead of
 * silently rendering an unstyled arc.
 */
export const SCORE_BAND_CLASS: Readonly<Record<ScoreBand, string>> = {
  red: "ringScoreRed",
  orange: "ringScoreOrange",
  yellow: "ringScoreYellow",
  green: "ringScoreGreen",
};

interface ScoreRingProps {
  /** 0–100 score to visualize. */
  value: number;
  /** px diameter. Default 92. */
  size?: number;
  /** Accessible label; combined into the SVG aria-label (screen readers). */
  label: string;
  /**
   * Count the number up on mount (e.g. the Home hero ring, where the arc and
   * digit animate in sync). Defaults match the ringFill animation in
   * Home.module.css: 900ms delay, 1200ms duration. Honors reduced motion.
   */
  animate?: boolean;
  /** Count-up start delay in ms. Default 900. */
  delayMs?: number;
  /** Count-up duration in ms. Default 1200. */
  durationMs?: number;
  /**
   * Whether the count-up may run. Defaults to `animate`.
   *
   * The Home hero needs this. Its count-up is triggered by the *story* — the
   * number must read 0% through the whole run and start when the score stage
   * does — and that cannot be expressed as a delay, because a delay is a
   * wall-clock deadline and the story is a chain of per-character re-renders
   * that runs late under load. Passing the delay alone put the number at 67% by
   * the time the first test had started.
   *
   * Gating the *target* rather than the timer is deliberate: it needs no new
   * code path in `useCountUp`, and a zero target settles on the first frame
   * after which React bails out of the identical `setValue`, so the idle ring
   * re-renders nothing.
   */
  active?: boolean;
  /**
   * The number already on the ring, so a count-up climbs from there.
   *
   * Default 0, which is what every other consumer wants. The Home hero (#389)
   * passes the previous attempt's score, and the whole point is that the ring
   * never rewinds: it holds 33 while the failures are pulled out, counts to 67,
   * holds that, and counts to 100. Counting each attempt up from zero instead
   * would read as three separate runs rather than one being finished — and
   * because each segment covers the same 33.3 points, counting from `countFrom`
   * also keeps the *speed* the same across all three, rather than the first being
   * visibly quicker just because it started lower.
   *
   * It is one value read by both halves of the ring: the digits take it as the
   * count-up's start, and `--ring-arc-from` puts the arc's fill at the same
   * offset. Splitting them would let the two finish at different numbers, which is
   * the failure the shared `scoreCountMs` exists to prevent.
   */
  countFrom?: number;
  /**
   * Step the arc's colour through the four-band red→orange→yellow→green score
   * scale as the number counts, instead of settling on one flat band. Opt-in,
   * used where a score is read as a position on a scale rather than as a verdict
   * — the Home hero (#389) and the report's own ring.
   *
   * The bands come from `scoreBand`, which is nested inside `scoreVariant`, so
   * the arc can never contradict a chip rendered next to it. It is one flat
   * colour at any instant — no gradient. The earlier version interpolated four
   * stops across the arc, which put three colours on a ring whose entire content
   * is one number and left the reader working out which part of it the score
   * referred to.
   *
   * The colour follows the *animated* value, not the score, so it changes while
   * the count-up runs: the arc is red at 0% and lands on the band the final
   * score belongs to. That is the whole effect, and it is why this prop only
   * does something visible alongside `animate`. Under reduced motion the
   * count-up returns its target on the first frame, so the arc arrives at its
   * final colour without passing through the others — the scale is still legible,
   * it is just not swept.
   */
  scale?: boolean;
}

function ScoreRing({
  value,
  size = 92,
  label,
  animate = false,
  delayMs = 900,
  durationMs = 1200,
  active,
  scale = false,
  countFrom = 0,
}: ScoreRingProps) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const normalized = Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * radius;
  const visibleArc = (normalized / 100) * circumference;
  const dash = `${visibleArc} ${circumference}`;
  /**
   * `countFrom`, rounded, and the arc length of it for the fill's start offset.
   *
   * `stroke-dasharray` is `<arc> <circumference>`, so a dash offset of
   * `arc - from` leaves exactly `from` drawn: the ring continues from where it
   * was instead of emptying and refilling. It is a custom property rather than an
   * inline `stroke-dashoffset` because the fill is a CSS animation, and a
   * keyframe has to be able to name a start value that is not the current one.
   *
   * Rounded, and the digits are rounded too — the ring must hold the arc of the
   * number it is actually showing. A third of a suite is 33.3 and the reader sees
   * `33%`, so an arc left at 33.3 would be a third of a percent ahead of the
   * digits for the whole repair beat, which is precisely the "two halves of one
   * ring disagreeing" this prop exists to prevent.
   */
  const fromValue = Math.round(Math.min(100, Math.max(0, countFrom)));
  const fromArc = (fromValue / 100) * circumference;
  const ringLabel = `${label} ${Math.round(normalized)} / 100`;

  // Count-up is enabled only where the ring arc animates (Home hero); other
  // consumers keep a static number. `useCountUp` is always called to satisfy
  // the rules of hooks — its value is only used when `animate` is true.
  //
  // `active` defaults to `animate`, so every consumer that passes neither gets
  // the previous behaviour exactly: the count-up runs on mount.
  const countUpActive = active ?? animate;
  const countUp = useCountUp(
    countUpActive ? Math.round(normalized) : 0,
    durationMs,
    delayMs,
    countUpActive ? fromValue : 0,
  );
  /**
   * Zero the moment `active` goes false, rather than routing the reset through
   * `useCountUp`.
   *
   * `useCountUp` waits `delayMs` before it starts *anything* — that delay is the
   * ring's shake, the beat between "scoring" and the number moving. Handing it a
   * target of zero therefore did not clear the number immediately; it scheduled a
   * count-to-zero `delayMs` later. The Home hero used to turn `active` off
   * between attempts, so for a quarter of a second the panel read "attempt 2 of
   * 3" with the previous attempt's 33% still on the ring — beside an arc that had
   * *already* gone empty, because that clears from `data-scoring`. Two halves of
   * one ring disagreeing is worse than either.
   *
   * It does not zero the ring now: `AnimatedTerminal` keeps `active` on once the
   * score is out and holds the number through the repair beats, because a ring
   * that rewinds between attempts is three unrelated rings rather than one that
   * gets to 100. The reset path is still here — it is what a consumer that
   * genuinely has no score to show gets, and it is what keeps "no value" from
   * being spelled "the last value".
   *
   * Returning the target early is still what `useCountUp` does under reduced
   * motion, so this is the same answer by a shorter route.
   */
  const display = !animate
    ? Math.round(normalized)
    : countUpActive
      ? countUp
      : 0;

  // The colour follows `display`, not `normalized` — that is what makes the scale
  // change while the number counts rather than only once it has arrived. The
  // flat bands keep reading the final score, so a consumer that never animates
  // cannot be given a band derived from a count-up that is not running.
  //
  // Both branches read the app-wide scale rather than their own thresholds: the
  // rings used to hardcode 40/70 here while every chip used `scoreVariant`'s
  // 60/80, so a 55 scored an amber arc on the page and an amber chip meant
  // "warning" only from 60. One scale, two shapes.
  const variant = scoreVariant(normalized);
  const arcClass = scale
    ? SCORE_BAND_CLASS[scoreBand(display)]
    : variant === "success"
      ? "ringSuccess"
      : variant === "warning"
        ? "ringWarning"
        : "ringDanger";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ringLabel}
      /* `--ring-arc` is the score's own arc length, published so a stylesheet
         that animates the fill can work in the score's units instead of a
         hardcoded one. See the `ringFill` keyframes in `Home.module.css`: with
         `stroke-dasharray` set to `<visibleArc> <circumference>`, offsetting by
         exactly `visibleArc` puts the whole filled segment inside the gap, so the
         ring reads empty. A keyframe that started from a number copied from one
         particular radius showed two thirds of the arc sitting next to a 0%
         number for the entire run, then snapped empty to refill.

         In `px`, and that unit is load-bearing rather than decorative. Every
         consumer wants to write `calc(var(--ring-arc) - var(--ring-arc-from, 0px))`,
         and `calc(83.69 - 0)` — two unitless numbers — resolves to a unitless
         number, which is not a valid `stroke-dashoffset`, so the declaration is
         dropped and the property falls back to its initial `0`. Nothing announces
         that: `getAnimations()` reported `ringFill` running from 0ms to 800ms with
         `stroke-dashoffset` pinned at 0 the whole way, so the arc sat at its
         *target* for the entire count-up. The ring never filled — it teleported,
         once per score stage, to the score it was about to count to (#389). */
      style={
        {
          "--ring-size": `${size}px`,
          "--ring-arc": `${visibleArc}px`,
          "--ring-arc-from": `${fromArc}px`,
          "--ring-circumference": `${circumference}px`,
        } as CSSProperties
      }
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className="ringTrack"
        fill="none"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        className={`ringProgress ${arcClass}`}
        fill="none"
        strokeWidth={stroke}
        strokeDasharray={dash}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        strokeLinecap="round"
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="ringValue"
      >
        {display}%
      </text>
    </svg>
  );
}

export default ScoreRing;