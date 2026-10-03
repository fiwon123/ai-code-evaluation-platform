import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import styles from "./Input.module.css";

interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
  id: string;
}

/**
 * Wires an error message to its control for assistive tech.
 *
 * The error message is rendered as a sibling of the child control, so on its
 * own it is orphaned text: a screen reader announces the field's label but
 * nothing about its error. The child control (an `input`, `select` or
 * `textarea`) gets `aria-invalid` (says the value is wrong) and
 * `aria-describedby` pointing at the message, so the message is announced
 * when the control is focused.
 *
 * The child is cloned to carry those two attributes because `Field` does not
 * own the control — callers pass it as `children`. Attributes the caller set
 * on the child win (clone merges, it does not overwrite), and when there is
 * no `error` the child is left untouched, so a valid field carries no
 * aria-noise. `FieldGroup` (a caption over several controls) instead puts
 * `aria-describedby` on the group's `role="group"` wrapper, where the error
 * belongs as a description of the group.
 *
 * A field may carry more than one child — the register password field has a
 * strength hint beside the input — so the control is found as the *first*
 * element in `children` rather than by testing `children` itself. React hands
 * over an array in that case, `isValidElement` is false for an array, and the
 * previous `isValidElement(children)` guard therefore skipped the wiring
 * entirely: the message still rendered, orphaned, and the control was marked
 * invalid with no way to hear why (#323).
 */
function wireError(
  children: ReactNode,
  error: string | undefined,
  errorId: string,
  viaChild: boolean,
): ReactNode {
  if (!error || !viaChild) return children;

  // `toArray` flattens a single child into a one-item array, so this covers
  // both shapes with one lookup.
  const kids = Children.toArray(children);
  const index = kids.findIndex(isValidElement);
  if (index === -1) {
    // No control to wire. Loud in development, silent in production: a warning
    // the build cannot act on would only ever reach a page's console.
    if (import.meta.env.DEV) {
      console.warn(
        "<Field> was given an error but no element to attach it to, so the " +
          "message will not be announced with the field. Pass the control as " +
          "the first child.",
      );
    }
    return children;
  }

  const wired = cloneElement(
    kids[index] as ReactElement<Record<string, unknown>>,
    { "aria-invalid": true, "aria-describedby": errorId },
  );
  if (kids.length === 1) return wired;
  return kids.map((kid, i) => (i === index ? wired : kid));
}

export function Field({ label, error, children, id }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {wireError(children, error, errorId, true)}
      {error && (
        <span id={errorId} className={styles.errorText}>
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Caption + a group of controls that are *not* a single labelable field.
 *
 * `Field` is only correct when `id` names a real form control, because it emits
 * `<label for={id}>`. Reaching for it around, say, a row of buttons produced a
 * label pointing at nothing (Lighthouse: "Incorrect use of `<label
 * for=FORM_ELEMENT>`"), which also makes screen readers announce a label for a
 * control that does not exist.
 *
 * This renders the same markup and classes, but names the group with
 * `aria-labelledby` on a `role="group"` wrapper instead — which is what a
 * caption over several controls actually is.
 */
export function FieldGroup({
  label,
  error,
  children,
  id,
}: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div
      className={styles.field}
      role="group"
      aria-labelledby={id}
      aria-describedby={error ? errorId : undefined}
    >
      <span className={styles.label} id={id}>
        {label}
      </span>
      {children}
      {error && (
        <span id={errorId} className={styles.errorText}>
          {error}
        </span>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ invalid, className = "", ...props }, ref) {
    const classes = [styles.input, invalid && styles.error, className].filter(Boolean).join(" ");
    const aria = invalid ? { "aria-invalid": true } : {};
    return <input ref={ref} className={classes} {...aria} {...props} />;
  },
);

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function SelectInput({ invalid, className = "", ...props }, ref) {
    const classes = [styles.select, invalid && styles.error, className].filter(Boolean).join(" ");
    const aria = invalid ? { "aria-invalid": true } : {};
    return <select ref={ref} className={classes} {...aria} {...props} />;
  },
);

export const TextAreaInput = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function TextAreaInput({ invalid, className = "", ...props }, ref) {
    const classes = [styles.textarea, invalid && styles.error, className].filter(Boolean).join(" ");
    const aria = invalid ? { "aria-invalid": true } : {};
    return <textarea ref={ref} className={classes} {...aria} {...props} />;
  },
);

export function useFieldId(prefix: string): string {
  return useId().replace(/:/g, "") + "-" + prefix;
}