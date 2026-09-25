import type { CSSProperties } from "react";

interface ScoreRingProps {
  /** 0–100 score to visualize. */
  value: number;
  /** px diameter. Default 92. */
  size?: number;
  /** Accessible label; shown as text and combined into the ring label. */
  label: string;
}

function ScoreRing({ value, size = 92, label }: ScoreRingProps) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const normalized = Math.min(100, Math.max(0, value));
  const circumference = 2 * Math.PI * radius;
  const visibleArc = (normalized / 100) * circumference;
  const dash = `${visibleArc} ${circumference}`;
  const variantClass =
    normalized < 40 ? "ringDanger" : normalized < 70 ? "ringWarning" : "ringSuccess";
  const ringLabel = `${label} ${Math.round(normalized)} / 100`;

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
        y="47%"
        textAnchor="middle"
        className="ringValue"
      >
        {Math.round(normalized)}%
      </text>
      <text
        x="50%"
        y="64%"
        textAnchor="middle"
        className="ringLabel"
      >
        {label}
      </text>
    </svg>
  );
}

export default ScoreRing;
