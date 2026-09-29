import styles from "./ComparisonMark.module.css";

/**
 * A yes/no cell in the plan comparison table, and the check in a tier's feature
 * list.
 *
 * Lives in `components/` rather than beside the page because it is a component
 * with a stylesheet, not a page shell: every CSS module under `pages/` is a
 * page's own `.page` rule, and `page-rhythm.test.ts` relies on that glob meaning
 * "a page shell" — a component module dropped there fails it as an unclassified
 * rhythm.
 *
 * The glyph is a decorative SVG; the *meaning* is visually-hidden text. Both are
 * needed, and neither replaces the other:
 *
 * - The table's whole reason for existing is "which rows differentiate the
 *   tiers", so the mark has to be a fast visual channel — colour-coded, drawn at
 *   the control's own size rather than being a text character that inherits
 *   whatever font the cell happens to use.
 * - But a cell whose only content is an `aria-hidden` SVG is announced as
 *   *empty*, and a cell whose only content is the literal `"✓"` character is
 *   announced as "check mark" (or skipped, depending on the screen reader) —
 *   which is not the same claim as "this tier includes it". `—` is worse still:
 *   "em dash", or silence. So every yes/no cell also carries "Included" or "Not
 *   included" as text that only assistive tech sees.
 *
 * `value` is `boolean | string` rather than the `["—", "✓"]` strings this
 * replaced, so the distinction between "no" and "some text" is carried by the
 * type instead of by a convention about which character was typed. A new
 * comparison row now cannot get it wrong by accident.
 */
export default function ComparisonMark({ value }: { value: boolean | string }) {
  if (typeof value === "string") {
    return <>{value}</>;
  }

  return (
    <span className={styles.mark}>
      <svg
        className={`${styles.icon} ${value ? styles.yes : styles.no}`}
        viewBox="0 0 16 16"
        width="16"
        height="16"
        role="presentation"
        aria-hidden="true"
        focusable="false"
      >
        {value ? (
          /* Check: a single polyline, drawn with `round` caps so the ends match
             the cross's weight rather than looking like a different icon set. */
          <path
            d="M2.5 8.5 6.2 12.2 13.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          /* Cross: two diagonals of the same length and weight, so the two
             marks are visually the same "size" in the column. */
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className={styles.srOnly}>
        {value ? "Included" : "Not included"}
      </span>
    </span>
  );
}
