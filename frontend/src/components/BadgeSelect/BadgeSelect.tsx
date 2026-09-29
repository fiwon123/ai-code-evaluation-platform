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
  error,
  errorId,
}: BadgeSelectProps<T>) {
  const groups = [styles.group, className].filter(Boolean).join(" ");

  return (
    <fieldset
      className={groups}
      aria-describedby={error && errorId ? errorId : undefined}
    >
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.options}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`${styles.option} ${selected ? styles.optionSelected : ""}`}
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
                className={styles.radio}
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
