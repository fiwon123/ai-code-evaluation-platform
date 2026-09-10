import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeVariant = "primary" | "success" | "warning" | "danger" | "neutral";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

function Badge({ variant = "neutral", children, className = "" }: BadgeProps) {
  const classes = [styles.badge, styles[variant], className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}

export default Badge;