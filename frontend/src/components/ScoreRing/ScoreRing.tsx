import type { CSSProperties } from "react";
import { useCountUp } from "../../hooks/useCountUp";

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
}

function ScoreRing({
  value,
  size = 92,
  label,
  animate = false,
  delayMs = 900,
  durationMs = 1200,
  active,
}: ScoreRingProps) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const normalized = Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * radius;
  const visibleArc = (normalized / 100) * circumference;
  const dash = `${visibleArc} ${circumference}`;
  const variantClass =
    normalized < 40 ? "ringDanger" : normalized < 70 ? "ringWarning" : "ringSuccess";
  const ringLabel = `${label} ${Math.round(normalized)} / 100`;

  // Count-up is enabled only where the ring arc animates (Home hero); other
  // consumers keep a static number. `useCountUp` is always called to satisfy
  // the rules of hooks — its value is only used when `animate` is true.
  //
  // `active` defaults to `animate`, so every consumer that passes neither gets
  // the previous behaviour exactly: the count-up runs on mount.
  const countUpActive = active ?? animate;
  const countUp = useCountUp(countUpActive ? Math.round(normalized) : 0, durationMs, delayMs);
  const display = animate ? countUp : Math.round(normalized);

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
         number for the entire run, then snapped empty to refill. */
      style={
        {
          "--ring-size": `${size}px`,
          "--ring-arc": `${visibleArc}`,
          "--ring-circumference": `${circumference}`,
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
        className={`ringProgress ${variantClass}`}
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