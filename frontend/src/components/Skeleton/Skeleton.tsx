import type { CSSProperties } from "react";
import styles from "./Skeleton.module.css";

interface SkeletonProps {
  /** Shape of the placeholder. */
  variant?: "text" | "circle" | "rect";
  /** Approximate width (CSS length). */
  width?: string | number;
  /** Approximate height (CSS length). */
  height?: string | number;
  className?: string;
  /** Accessible label for the loading region. */
  label?: string;
}

function Skeleton({
  variant = "text",
  width,
  height,
  className = "",
  label,
}: SkeletonProps) {
  const style: CSSProperties = {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };

  const classes = [
    styles.skeleton,
    styles[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      style={style}
      role={label ? "status" : undefined}
      aria-label={label}
    />
  );
}

export default Skeleton;