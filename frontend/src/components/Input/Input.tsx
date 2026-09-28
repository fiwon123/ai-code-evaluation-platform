import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import styles from "./Input.module.css";

interface FieldProps {
  label: string;
  error?: string;
  children: ReactNode;
  id: string;
}

export function Field({ label, error, children, id }: FieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {error && <span className={styles.errorText}>{error}</span>}
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
  return (
    <div className={styles.field} role="group" aria-labelledby={id}>
      <span className={styles.label} id={id}>
        {label}
      </span>
      {children}
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ invalid, className = "", ...props }, ref) {
    const classes = [styles.input, invalid && styles.error, className].filter(Boolean).join(" ");
    return <input ref={ref} className={classes} {...props} />;
  },
);

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function SelectInput({ invalid, className = "", ...props }, ref) {
    const classes = [styles.select, invalid && styles.error, className].filter(Boolean).join(" ");
    return <select ref={ref} className={classes} {...props} />;
  },
);

export const TextAreaInput = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function TextAreaInput({ invalid, className = "", ...props }, ref) {
    const classes = [styles.textarea, invalid && styles.error, className].filter(Boolean).join(" ");
    return <textarea ref={ref} className={classes} {...props} />;
  },
);

export function useFieldId(prefix: string): string {
  return useId().replace(/:/g, "") + "-" + prefix;
}