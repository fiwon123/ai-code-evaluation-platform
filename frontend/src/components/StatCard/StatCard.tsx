import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Card from "../Card/Card.tsx";
import styles from "./StatCard.module.css";

/**
 * Identity hues, or a judgement about the value.
 *
 * `identity` is for a plain count: a number has no opinion about being good,
 * so it gets a colour that only says "this is a different thing".
 * `success` / `warning` / `danger` are for a value that *is* a judgement — an
 * average score, a completion rate — and those must come from the same scale as
 * the rest of the app (`scoreVariant`), so one reader learns it once.
 */
export type StatAccent =
  | "primary"
  | "teal"
  | "violet"
  | "rose"
  | "success"
  | "warning"
  | "danger";

interface StatCardProps {
  label: string;
  /** Pre-formatted so a caller can show a score, a percentage, or a count. */
  value: ReactNode;
  accent: StatAccent;
  /** Makes the whole card a link, for stats that drill down. */
  to?: string;
  className?: string;
}

/**
 * One stat card, used by the profile dashboard and the admin dashboard.
 *
 * Both pages had the same three-line block — value, label, centred in a card —
 * and both grew it independently: plain on Profile, plain on Admin, with no
 * colour and no motion. This is the version with an identity.
 *
 * The colour is carried by one custom property (`--stat-accent`) that the
 * module resolves from `accent`, so the accent bar, the wash, the hover ring and
 * the value's own colour can never drift apart. Nothing here introduces a
 * colour token: the washes are `color-mix` over the accent and the surface, and
 * the accents are `--color-primary`, `--color-accent-*`, and the status tokens.
 */
function StatCard({ label, value, accent, to, className = "" }: StatCardProps) {
  const classes = [styles.statCard, styles[`accent${capitalise(accent)}`], className]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={styles.statLink}>
        <Card className={classes}>{body}</Card>
      </Link>
    );
  }

  return <Card className={classes}>{body}</Card>;
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default StatCard;
