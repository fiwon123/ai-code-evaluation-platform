/**
 * The single page-title treatment for the whole app.
 *
 * Every page used to render its own `<h1>`: four different class names across
 * 21 pages, three of them unclassed, and a hand-copied gradient on only six of
 * them. Four of those six had no light-mode override, so a dark-mode gradient
 * survived into light mode while its two siblings opted out — the same visual
 * decision made three different ways.
 *
 * Centralising it here means the gradient is defined once, and the light/dark
 * behaviour comes from the tokens (`--gradient-title` is built from the
 * per-theme primary colors) instead of from per-page overrides that have to be
 * kept in sync by hand.
 *
 * `className` stays for page *layout* only (width, margins, centering) — size
 * and the gradient belong to `size`/`variant` so they cannot drift per page.
 */
import type { ReactNode } from "react";
import styles from "./PageTitle.module.css";

/** `sm` auth/card titles · `md` app pages · `lg` landing pages. */
export type PageTitleSize = "sm" | "md" | "lg";

/** `page` is the standard two-stop gradient; `hero` is the animated home hero. */
export type PageTitleVariant = "page" | "hero";

interface PageTitleProps {
  children: ReactNode;
  size?: PageTitleSize;
  variant?: PageTitleVariant;
  /** Page-specific layout only (margins, max-width, centering). */
  className?: string;
}

export function PageTitle({
  children,
  size = "md",
  variant = "page",
  className,
}: PageTitleProps) {
  const classes = [styles.title, styles[size]];
  if (variant === "hero") {
    classes.push(styles.hero);
  }
  if (className) {
    classes.push(className);
  }
  return <h1 className={classes.join(" ")}>{children}</h1>;
}

export default PageTitle;
