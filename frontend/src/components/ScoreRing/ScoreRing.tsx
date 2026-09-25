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
}

function ScoreRing({
  value,
  size = 92,
  label,
  animate = false,
  delayMs = 900,
  durationMs = 1200,
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
  const countUp = useCountUp(Math.round(normalized), durationMs, delayMs);
  const display = animate ? countUp : Math.round(normalized);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ringLabel}
      style={{ "--ring-size": `${size}px` } as CSSProperties}
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