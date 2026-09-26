import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Link, type To } from "react-router-dom";
import Spinner from "../Spinner/Spinner.tsx";
import styles from "./Button.module.css";

/** Props shared by both renderings. */
interface CommonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}

/**
 * The button rendering: everything a `<button>` takes.
 *
 * `to` is `undefined` here rather than absent, so that `<Button to="…">` and
 * `<Button onClick={…}>` resolve to different members of the union instead of
 * both matching and silently producing a link.
 */
type AsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & {
    to?: undefined;
    /** Shows a spinner and disables the button while async work is running. */
    loading?: boolean;
    /** Label shown while `loading` is true; defaults to `children`. */
    loadingText?: string;
  };

/**
 * The link rendering: what a react-router `Link` takes.
 *
 * There is deliberately no `disabled` and no `loading` here. A link cannot be
 * disabled, and a spinner on something that navigates away is a lie about what
 * is happening — so the type refuses both, which is the whole reason for
 * splitting the union instead of adding an optional `to`.
 */
type AsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps> & {
    /** Renders a react-router `Link` instead of a `<button>`. */
    to: To;
  };

type ButtonProps = AsButton | AsLink;

/**
 * A button, or a link that looks like one.
 *
 * Twenty call sites were writing `<Link to="/x"><Button>…</Button></Link>`,
 * which nests a `<button>` inside an `<a href>`: invalid HTML, two focus stops
 * for one action, and a screen reader announcing a link that contains a button.
 * `to` makes the navigation and the appearance the same element, so the two
 * cannot disagree.
 */
const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = "primary",
      size = "md",
      className = "",
      children,
      to,
      loading,
      loadingText,
      disabled,
      ...rest
    } = props as CommonProps & {
      to?: To;
      loading?: boolean;
      loadingText?: string;
      disabled?: boolean;
    };

    const classes = [
      styles.button,
      styles[variant],
      size !== "md" && styles[size],
      loading && styles.loading,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    if (to !== undefined) {
      return (
        <Link ref={ref} to={to} className={classes} {...(rest as object)}>
          {children}
        </Link>
      );
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {loading && <Spinner size="sm" ariaHidden />}
        {loading && loadingText ? loadingText : children}
      </button>
    );
  },
);

export default Button;
