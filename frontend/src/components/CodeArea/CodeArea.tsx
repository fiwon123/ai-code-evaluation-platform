import {
  useCallback,
  useMemo,
  useRef,
  type TextareaHTMLAttributes,
  type UIEvent,
} from "react";
import { highlight, type Token } from "../CodeBlock/highlight";
import styles from "./CodeArea.module.css";

/**
 * Token kind → CSS class. `plain` maps to `undefined` on purpose, for the same
 * reason as in `CodeBlock`: wrapping every space and brace in a span would
 * multiply the DOM by the size of the text for no visual gain, and leaving
 * unhighlighted runs as bare text keeps them inheriting `--color-code-text`.
 *
 * The vocabulary is shared with `CodeBlock` (both come from `highlight.ts`'s
 * `TokenKind`), but the *classes* are per-component because CSS Modules scope
 * them: `CodeBlock`'s `.string` is a different rule object from this one even
 * though both resolve to `--color-code-string`. Keeping one map here and one
 * there is deliberate — importing another component's module class would couple
 * two surfaces that are otherwise independent, and the token values they paint
 * are held together by the design tokens instead.
 */
const TOKEN_CLASS: Record<Token["kind"], string | undefined> = {
  plain: undefined,
  comment: styles.comment,
  string: styles.string,
  number: styles.number,
  keyword: styles.keyword,
  type: styles.type,
  function: styles.function,
};

export interface CodeAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "children"> {
  /**
   * Catalog language used to pick the grammar. An unknown value, or `"text"`,
   * still gets the dark code surface — the text is simply not tokenized, which
   * is the correct reading of a prompt in a language the catalog does not
   * carry rather than a reason to fall back to a light form control.
   */
  language?: string | null;
}

/**
 * An editable, syntax-highlighted code field.
 *
 * Why an overlay and not a real editor: a `<textarea>` cannot hold markup, so
 * highlighting *inside* the control is not possible without replacing it with a
 * third-party editor (CodeMirror/Monaco), which this app has ruled out — it
 * carries zero runtime dependencies beyond React and the router (see
 * `CodeBlock/highlight.ts` for the reasoning). So the value stays in a real
 * `<textarea>` and a tokenized `<pre>` is painted behind it.
 *
 * What this costs, stated plainly, because it is the whole trade-off:
 *
 *   - **The value is still the textarea's.** Accessibility is unchanged: the
 *     control keeps its role, its label, its value, keyboard editing, undo,
 *     spellcheck and native selection. The paint layer is `aria-hidden`, so a
 *     screen reader reads the code once, from the control.
 *   - **Scroll has to be mirrored by hand.** The control scrolls; the paint
 *     does not, so `onScroll` copies `scrollTop`/`scrollLeft` across. A missing
 *     `onScroll` is the single most visible possible bug here — the text would
 *     scroll under a stationary highlight — so it is locked by a test.
 *   - **The metrics must match exactly.** Font, line-height, padding, wrapping
 *     and `tab-size` are shared through the composed `.layer` rule. Any metric
 *     that differs by even one pixel desynchronizes the paint from the
 *     characters, and the failure is subtle: a few lines in, everything is
 *     offset by the width of one character.
 *   - **`color: transparent`.** The real text is invisible and the *painted*
 *     text is what you see, which means text rendering is now the paint's job.
 *     The caret is re-coloured with `caret-color`, the selection is repainted,
 *     and the placeholder is exempted, or the user would be typing into a box
 *     they cannot read.
 *
 * What it buys: the prompt and test-suite fields read as code — dark surface,
 * real token colours, generous size — using the same tokens as every other code
 * surface in the app, with no new dependency and no change to what the form
 * submits.
 */
function CodeArea({
  language,
  value,
  className = "",
  onScroll,
  ...props
}: CodeAreaProps) {
  const paintRef = useRef<HTMLPreElement | null>(null);
  // `TextareaHTMLAttributes["value"]` is the full React value type, so a caller
  // could legally pass a number or an array. This control is a code editor, and
  // neither of those is source code — coercing to a string here (rather than
  // narrowing the prop) keeps the type honest for every caller and renders an
  // array as its `toString`, which is at least visible rather than blank.
  const text = typeof value === "string" ? value : String(value ?? "");

  // Tokenize the live value, not a debounced copy. The paint sits one paint
  // frame behind React's render anyway, and debouncing here would show
  // unhighlighted text while typing — the exact moment a user is looking at it.
  const tokens = useMemo(() => highlight(text, language), [text, language]);

  // A trailing newline is the common case (every example test suite ends in
  // one), and a `<pre>` collapses a trailing newline, so the final — empty —
  // line would have no line box and the paint would stop a line short of where
  // the caret actually is. One extra newline gives that last line its box.
  const painted = useMemo(
    () => (text.endsWith("\n") ? `${text}\n` : text),
    [text],
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLTextAreaElement>) => {
      const paint = paintRef.current;
      if (paint) {
        paint.scrollTop = event.currentTarget.scrollTop;
        paint.scrollLeft = event.currentTarget.scrollLeft;
      }
      onScroll?.(event);
    },
    [onScroll],
  );

  const wrapperClasses = [styles.wrapper, className].filter(Boolean).join(" ");

  return (
    <div className={wrapperClasses}>
      <pre
        ref={paintRef}
        // Presentational only: the textarea below is the accessible control and
        // already carries the value, so exposing the paint as well would read
        // every line of code twice.
        aria-hidden="true"
        className={`${styles.paint} ${text === "" ? styles.empty : ""}`}
      >
        <code>
          {tokens
            ? tokens.map((token, index) => (
                <span
                  key={index}
                  className={TOKEN_CLASS[token.kind]}
                  data-token={token.kind}
                >
                  {token.value}
                </span>
              ))
            : painted}
        </code>
      </pre>
      <textarea
        {...props}
        className={styles.control}
        value={value}
        onScroll={handleScroll}
      />
    </div>
  );
}

export default CodeArea;
