import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import styles from "./Tooltip.module.css";

interface TooltipProps {
  /** The text shown in the bubble and announced as the trigger's description. */
  label: string;
  /** The trigger content. Exactly one element. */
  children: ReactNode;
  className?: string;
  /** Which side of the trigger the bubble sits on. */
  placement?: "top" | "bottom";
}

/** Elements that are focusable without a `tabIndex` of their own. */
const NATIVELY_FOCUSABLE = new Set(["a", "button", "input", "select", "textarea", "summary"]);

/**
 * Whether the child can take focus unaided. Decides who carries
 * `aria-describedby` and, more importantly, whether the tooltip needs a tab
 * stop of its own: a description attached to something a keyboard cannot reach
 * is decoration no keyboard user can ever see.
 */
function isFocusable(child: ReactNode): boolean {
  if (!isValidElement(child)) {
    return false;
  }
  const element = child as ReactElement<{ tabIndex?: number; type?: string }>;
  if (element.props.tabIndex !== undefined) {
    return element.props.tabIndex >= 0;
  }
  const type = element.props.type ?? element.type;
  return typeof type === "string" && NATIVELY_FOCUSABLE.has(type);
}

/**
 * A tooltip a keyboard can actually reach (issue #347).
 *
 * The repo's only previous tooltip was a native `title` on `LanguageBadge`.
 * `title` fails the job it is being used for in three ways that all matter on a
 * coloured card: it does not appear on focus at all, it cannot be styled (so it
 * cannot be made legible against a language tint), and it is never exposed as a
 * description, so a screen reader does not announce the truncated text the
 * tooltip exists to reveal.
 *
 * WCAG 1.4.13 (Content on Hover or Focus) asks for three behaviours, each
 * implemented explicitly here rather than inherited from the platform:
 *
 *   - **Dismissible** — Escape hides the bubble without moving focus. The one
 *     thing a hover-only tooltip can never do.
 *   - **Hoverable** — the bubble is a real element the pointer can travel into,
 *     so a reader can move down onto a long string and keep reading it. A
 *     `:hover`-only CSS tooltip drops its own content mid-gesture, which is
 *     what makes people learn to distrust tooltips.
 *   - **Persistent** — it stays until hover or focus leaves, not for a timer.
 *
 * The bubble is always in the DOM and always referenced by `aria-describedby`,
 * so the description resolves whether or not the bubble is currently open;
 * rendering it conditionally would make the accessible description flicker as
 * the pointer moves. Visibility is `data-open` plus CSS.
 */
export default function Tooltip({
  label,
  children,
  className = "",
  placement = "top",
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  // Escape dismisses from anywhere in the widget, without moving focus. A
  // window listener rather than one on the wrapper, because the pointer can be
  // over the bubble while focus is still on the trigger.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const focusable = isFocusable(Children.only(children));

  // The description belongs on the trigger itself, not the wrapper: announced
  // against the wrapper it would be lost the moment focus moved to the real
  // control inside it. An unfocusable trigger cannot be described to anyone, so
  // the wrapper takes the tab stop and becomes the thing being described.
  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": id,
      })
    : children;

  const classes = [styles.wrapper, className].filter(Boolean).join(" ");
  const bubbleClasses = [styles.bubble, styles[placement]].filter(Boolean).join(" ");

  return (
    <span
      ref={wrapper}
      className={classes}
      {...(focusable ? {} : { tabIndex: 0, "aria-describedby": id })}
      onMouseEnter={show}
      // `mouseleave`, not `mouseout`: it does not fire for the moves *between*
      // the trigger and the bubble, so travelling down onto a long tooltip does
      // not flicker it closed.
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(event) => {
        // Close only when focus has left the widget entirely — a `blur` landing
        // on something inside must not close it.
        //
        // `null` is a real case, not a degenerate one: browsers report a
        // `relatedTarget` of null whenever focus is being taken *away* — to the
        // document body, the address bar, another window, or the devtools. In
        // jsdom a plain `.focus()` reports null too. Treating null as "inside"
        // would leave the tooltip stuck open after focus leaves for good, and
        // would make this component untestable without `fireEvent.blur`
        // everywhere.
        //
        // The gap that leaves is focus moving *into* the widget, which cannot
        // happen on a single Tab stop: with one focusable descendant the only
        // way in is from outside. `isFocusable` is what keeps that true — it
        // moves the tab stop onto the wrapper exactly when the child is not
        // focusable, so the widget is always one stop.
        if (event.relatedTarget && wrapper.current?.contains(event.relatedTarget as Node)) {
          return;
        }
        hide();
      }}
    >
      {trigger}
      <span id={id} role="tooltip" className={bubbleClasses} data-open={open || undefined}>
        {label}
      </span>
    </span>
  );
}
