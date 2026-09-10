import { useId } from "react";
import styles from "./Logo.module.css";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

function Logo({ size = "md", showText = true, className = "" }: LogoProps) {
  const gradientId = useId();

  return (
    <span className={`${styles.logo} ${styles[size]} ${className}`}>
      <svg
        className={styles.mark}
        viewBox="0 0 48 48"
        role="img"
        aria-label="AI Code Eval logo"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${gradientId})`} />
        {/* </> code glyph */}
        <path
          d="M19 17l-7 7 7 7"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M29 17l7 7-7 7"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M25.2 14.5l-2.4 19"
          fill="none"
          stroke="#ffffff"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
        {/* evaluation checkmark */}
        <path
          d="M32.5 29.5l3.2 3.2 6-7.4"
          fill="none"
          stroke="#4ade80"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showText && (
        <span className={styles.wordmark}>
          AI<span className={styles.accent}>Code</span>Eval
        </span>
      )}
    </span>
  );
}

export default Logo;