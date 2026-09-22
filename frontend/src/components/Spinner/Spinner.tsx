import styles from "./Spinner.module.css";

interface SpinnerProps {
  /** Accessible label for screen readers. Defaults to "Loading". */
  label?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Marks the spinner as decorative (excluded from the accessibility tree). */
  ariaHidden?: boolean;
}

function Spinner({
  label = "Loading",
  size = "md",
  className = "",
  ariaHidden = false,
}: SpinnerProps) {
  const classes = [
    styles.spinner,
    styles[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (ariaHidden) {
    return <span className={classes} aria-hidden="true" />;
  }

  return (
    <span
      className={classes}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className={styles.visuallyHidden}>{label}</span>
    </span>
  );
}

export default Spinner;