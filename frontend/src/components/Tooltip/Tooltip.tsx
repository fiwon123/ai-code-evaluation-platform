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
  /**
   * Controlled visibility. Omit it and the tooltip manages itself.
   *
   * This exists for one case: a trigger that cannot own the pointer. A card with
   * a stretched link over it has a transparent `::after` covering the whole
   * surface, so the pointer never reaches anything inside — hovering the card
   * hits the link's overlay, and a tooltip hung on a child would open for a
   * keyboard user and never for a mouse. The card then drives `open` from its own
   * hover and focus instead, and passes it down.
   *
   * Pair it with `onOpenChange`, or Escape will close the bubble and the parent
   * will open it again on the next hover.
   */
  open?: boolean;
  /** Notified whenever the tooltip would change visibility, controlled or not. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Let pointer events fall through the bubble to whatever is beneath it.
   *
   * WCAG 1.4.13 asks for the bubble to be hoverable — the pointer must be able
   * to travel into it without it vanishing — and it stays hoverable whether or
   * not the bubble takes the pointer, as long as the surface it sits on is still
   * hovered. Taking the pointer is what breaks things: a bubble over a card with
   * a stretched link swallows the click meant for the card, and a bubble that
   * appears between mousedown and mouseup cancels the click outright, so the
   * card stops responding to clicks. Use this for a bubble that explains content
   * rather than offering actions.
   */
  passThrough?: boolean;
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
  open: controlledOpen,
  onOpenChange,
  passThrough = false,
}: TooltipProps) {
  const id = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      // In controlled mode the parent owns the state; telling it is the whole
      // job, and writing the internal copy anyway would let the two drift.
      if (controlledOpen === undefined) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const show = useCallback(() => setOpen(true), [setOpen]);
  const hide = useCallback(() => setOpen(false), [setOpen]);

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
  }, [open, setOpen]);

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
  const bubbleClasses = [styles.bubble, styles[placement], passThrough && styles.passThrough]
    .filter(Boolean)
    .join(" ");

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
        // Close only when focus has left the widget entirely, so a `blur`
        // landing on something inside does not close it.
        //
        // `relatedTarget` is null whenever focus is taken *away* rather than
        // moved — the address bar, another window, the devtools — and
        // `Node.contains(null)` is false, so null falls into the "left it" branch
        // and closes. That is the right answer, and it is the common case, so it
        // is worth being explicit about: the null check is not needed here
        // because `contains` already answers it.
        //
        // The case this cannot distinguish is focus moving *into* the widget,
        // which cannot happen on a single tab stop: with one focusable
        // descendant the only way in is from outside. `isFocusable` is what keeps
        // that true — it moves the tab stop onto the wrapper exactly when the
        // child is not focusable, so the widget is always one stop.
        if (!wrapper.current?.contains(event.relatedTarget as Node | null)) {
          hide();
        }
      }}
    >
      {trigger}
      <span id={id} role="tooltip" className={bubbleClasses} data-open={open || undefined}>
        {label}
      </span>
    </span>
  );
}
