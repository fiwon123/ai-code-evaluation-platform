import type { CSSProperties, ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: "default" | "compact" | "none";
  /**
   * Custom properties, almost always: a card that needs an accent colour is
   * handed `--card-accent` and the module mixes it against the surface. Setting
   * `style` directly is allowed so callers do not have to work around a missing
   * prop to colour a card (issue #347).
   */
  style?: CSSProperties;
}

function Card({ children, className = "", padding = "default", style }: CardProps) {
  const classes = [
    styles.card,
    padding === "compact" && styles.compact,
    padding === "none" && "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}

export default Card;