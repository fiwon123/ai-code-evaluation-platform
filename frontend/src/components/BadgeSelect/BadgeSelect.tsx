import { type ReactNode } from "react";
import styles from "./BadgeSelect.module.css";

export interface BadgeSelectOption<T extends string> {
  value: T;
  /**
   * What the option shows. A `Badge`, a `LanguageBadge`, or plain text.
   *
   * This is the visible body only — the option's accessible name comes from
   * the wrapping `<label>`, so whatever is rendered here must contain readable
   * text. A pure symbol or icon needs an `aria-label` on the option's `label`,
   * which is why the radio carries an optional `srLabel`.
   */
  children: ReactNode;
  /** Overrides the accessible name when `children` is not itself text. */
  srLabel?: string;
  /** Native tooltip, e.g. "Python · pytest". */
  title?: string;
  /** Extra colour for the option's selected ring. */
  accent?: string;
}

interface BadgeSelectProps<T extends string> {
  /** Names the group. Rendered as a real `<legend>`. */
  legend: string;
  /** Shared `name` for the radios — this is what a form posts. */
  name: string;
  value: T;
  options: readonly BadgeSelectOption<T>[];
  onChange: (next: T) => void;
  /** Extra class on the `<fieldset>`, for page-level layout. */
  className?: string;
  /**
   * Extra class on the `<legend>`, for a page that needs the group named but
   * not shown.
   *
   * A prop rather than a page targeting `fieldset > legend` in its own module,
   * because that is not expressible: `composes` is only valid on a single local
   * class name, so a compound selector is a build error, and a descendant
   * selector on another module's hashed `.legend` is unreachable by name. The
   * escape hatch is a class handed to the element that owns it.
   */
  legendClassName?: string;
  /**
   * `card` (default) draws each option as a bordered card with a visible
   * radio — the right weight for a 20-item language grid where each option is
   * big enough to be a target. `plain` drops the card, the raised surface and
   * the radio's own glyph, leaving the option's `children` as a bare tag
   * (issue #346: "difficulty tags only").
   *
   * `plain` is presentation only. The radios stay in the DOM and stay
   * focusable, because they are what gives the group its `name`/`value`,
   * arrow-key selection and "selected" announcement. Hiding the radio is the
   * only difference, and the group falls back to the same focus ring it uses in
   * `card` mode.
   */
  appearance?: "card" | "plain";
  /** Error text, announced against the group via `aria-describedby`. */
  error?: string;
  /** Id for the error node. Generated when omitted. */
  errorId?: string;
}

/**
 * A grid of badge-like options over a native radio group.
 *
 * The mechanism is a `fieldset` + `legend` wrapping real
 * `<input type="radio">` elements, and that is deliberate rather than a
 * shortcut:
 *
 * - One tab stop for the whole group, with arrow keys moving between options —
 *   a row of 20 `<button>`s would be 20 tab stops and would need its own roving
 *   `tabindex`, `aria-checked` and `role="radio"` bookkeeping to reach the same
 *   place. A `role="radiogroup"` of divs is also invisible to a plain form post.
 * - The radios keep real `name`/`value` semantics, so the control submits
 *   without any extra work and screen readers announce "selected" natively.
 * - The `legend` names the group, so no `role` has to be invented. This is what
 *   `FieldGroup` in `Input.tsx` is for, and why a grid of options is *not*
 *   wrapped in a `Field` (a `<label for>` pointing at a group of radios names
 *   nothing).
 *
 * The radio stays visible inside the option. Hiding it behind
 * `opacity: 0` + a `:has(:focus-visible)` ring is the usual "card radio"
 * trick, and it is deliberately avoided: it depends on `:has()` for its focus
 * ring, and an invisible focus ring is a keyboard trap for anyone whose browser
 * lacks it. A real, focusable radio is the honest version of the same control.
 *
 * `BadgeSelect` is generic over the option value so the same component drives
 * difficulty (`easy`/`medium`/`hard`) and language (20 catalog values) without
 * either one special-casing the other.
 */
export default function BadgeSelect<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  className = "",
  legendClassName = "",
  appearance = "card",
  error,
  errorId,
}: BadgeSelectProps<T>) {
  const groups = [styles.group, className].filter(Boolean).join(" ");
  const legendClasses = [styles.legend, legendClassName].filter(Boolean).join(" ");
  const plain = appearance === "plain";
  // In `plain` mode the options are tags, not cards, so a fixed 11rem track
  // would space three short words across half the form. The row is content-
  // sized and wraps instead.
  const optionClasses = plain
    ? `${styles.option} ${styles.optionPlain}`
    : styles.option;

  return (
    <fieldset
      className={groups}
      aria-describedby={error && errorId ? errorId : undefined}
    >
      <legend className={legendClasses}>{legend}</legend>
      <div className={`${styles.options} ${plain ? styles.optionsPlain : ""}`}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`${optionClasses} ${selected ? styles.optionSelected : ""}`}
              style={
                option.accent
                  ? ({ "--option-accent": option.accent } as React.CSSProperties)
                  : undefined
              }
              title={option.title}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className={plain ? styles.radioHidden : styles.radio}
                aria-label={option.srLabel}
              />
              <span className={styles.body}>{option.children}</span>
            </label>
          );
        })}
      </div>
      {error && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
    </fieldset>
  );
}
