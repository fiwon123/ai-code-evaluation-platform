import type { ReactNode, ButtonHTMLAttributes } from "react";
import Spinner from "../Spinner/Spinner.tsx";
import styles from "./Button.module.css";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  /** Shows a spinner and disables the button while async work is running. */
  loading?: boolean;
  /** Label shown while `loading` is true; defaults to `children`. */
  loadingText?: string;
  children: ReactNode;
}

function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingText,
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    size !== "md" && styles[size],
    loading && styles.loading,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size="sm" ariaHidden />}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}

export default Button;