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