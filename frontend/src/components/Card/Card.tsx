import type { CSSProperties, ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: "default" | "compact" | "none";
  /**
   * `dark` paints the marketing/informational surface: a dark panel in the
   * light theme that falls back to a normal card in the dark theme, so a page
   * can ask for "a strong panel" without knowing which theme is active (#387).
   * It re-points the descendant tokens rather than restyling children, so the
   * caller needs no dark-aware rules. Auth/form card shells deliberately stay
   * light.
   */
  variant?: "default" | "dark";
  /**
   * Custom properties, almost always: a card that needs an accent colour is
   * handed `--card-accent` and the module mixes it against the surface. Setting
   * `style` directly is allowed so callers do not have to work around a missing
   * prop to colour a card (issue #347).
   */
  style?: CSSProperties;
}

function Card({
  children,
  className = "",
  padding = "default",
  variant = "default",
  style,
}: CardProps) {
  const classes = [
    styles.card,
    padding === "compact" && styles.compact,
    padding === "none" && "",
    variant === "dark" && styles.dark,
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