import type { ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: "default" | "compact" | "none";
}

function Card({ children, className = "", padding = "default" }: CardProps) {
  const classes = [
    styles.card,
    padding === "compact" && styles.compact,
    padding === "none" && "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
}

export default Card;