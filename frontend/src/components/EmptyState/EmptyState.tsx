import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  /** Short headline. The one thing a reader should take away. */
  title: string;
  /** Optional supporting sentence. */
  children?: ReactNode;
  /** Heading level, so the empty state does not fight the page outline. */
  as?: "h2" | "h3" | "p";
  className?: string;
}

/**
 * The one empty state.
 *
 * Four pages each hand-rolled their own — a dashed box on the challenges list,
 * a bare muted sentence on the challenge and submission pages — so the same
 * "nothing here yet" moment read as four different products. This is that
 * treatment, in one place.
 *
 * Deliberately no icon: every candidate glyph was either an emoji (the repo's
 * guardrail is no new emoji) or a shape that needed its own accessibility
 * decision. A dashed edge and centred copy are enough to say "empty" without
 * decorating the absence of content.
 */
function EmptyState({
  title,
  children,
  as: Heading = "h2",
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`${styles.empty} ${className}`.trim()}>
      <Heading className={styles.title}>{title}</Heading>
      {children ? <div className={styles.body}>{children}</div> : null}
    </div>
  );
}

export default EmptyState;
