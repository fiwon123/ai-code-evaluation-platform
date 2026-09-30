import { useCallback, useMemo, useState } from "react";
import LanguageBadge from "../LanguageBadge/LanguageBadge.tsx";
import styles from "./CodeBlock.module.css";
import { classifyLogLine, type LogSeverity } from "./logSeverity";
import { highlight, isHighlightable, type Token } from "./highlight";

/** Rows rendered before the "show all" affordance appears. */
export const DEFAULT_LINE_LIMIT = 300;

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  /**
   * Render as an execution log: line numbers, severity colorization and a
   * capped view. Off by default — prompts and generated source read badly with
   * a log gutter and severity tints.
   */
  log?: boolean;
}

const SEVERITY_CLASS: Record<LogSeverity, string | undefined> = {
  error: styles.lineError,
  warning: styles.lineWarning,
  success: styles.lineSuccess,
  trace: styles.lineTrace,
  info: undefined,
};

/**
 * Token kind to CSS class. `plain` maps to `undefined` on purpose: wrapping
 * every space and brace in a span would multiply the DOM by the size of the
 * code for no visual gain, and leaving unhighlighted text as bare text nodes
 * keeps the block's text content a plain, copyable string.
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

/**
 * Split into display rows. Trailing blank lines are an artifact of a trailing
 * newline; rendered as the gutter numbers them, which reads like an off-by-one
 * bug. Interior blank lines are real output and are kept.
 */
export function splitLogLines(code: string): string[] {
  if (code === "") {
    return [];
  }
  const lines = code.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function CodeBlock({ code, language = "", filename, log = false }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = useCallback(async () => {
    // Always the full source, never the capped view: a truncated log that
    // silently copies short is worse than no copy button.
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const lines = useMemo(() => (log ? splitLogLines(code) : []), [code, log]);
  const visibleCount = expanded ? lines.length : Math.min(lines.length, DEFAULT_LINE_LIMIT);
  const truncated = lines.length > DEFAULT_LINE_LIMIT;
  // The header names the *file* when there is one and otherwise says what the
  // surface is. The language is carried by the badge, not by this label: a
  // header reading "language: python" exposed a database value where the reader
  // wanted a display name, and duplicating it alongside the badge would say the
  // same thing twice.
  const label = filename ?? (log ? "logs" : "code");

  // Tokenize only real code. Logs keep severity colorization (a red FAILED
  // line must not also be syntax-colored, and traceback frames would color
  // differently from the prose around them), and "text" is prose, not code.
  const tokens = useMemo(
    () => (log ? null : highlight(code, language)),
    [code, language, log],
  );

  // The badge carries the language name, so the plain-text label must not
  // repeat it — otherwise a filename-less block reads "Python ... Py Python".
  // Keeping the two responsibilities apart is also what lets the badge sit
  // beside a filename: "solution.py · Py" is a useful pairing, because a
  // generated file's extension and its actual language can disagree.
  const showBadge = !log && isHighlightable(language);

  const codeBody = (
    <pre className={styles.code}>
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
          : code}
      </code>
    </pre>
  );

  const logBody = (
    <pre className={styles.code} aria-label="Execution log">
      <code>
        {lines.slice(0, visibleCount).map((text, index) => {
          const severity = classifyLogLine(text);
          return (
            <span
              key={index}
              className={`${styles.line} ${SEVERITY_CLASS[severity] ?? ""}`}
              data-severity={severity}
            >
              <span className={styles.lineNumber} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.lineText}>{text}</span>
            </span>
          );
        })}
      </code>
    </pre>
  );

  return (
    <div className={styles.block}>
      <div className={styles.header}>
        <span>{label}</span>
        {showBadge && (
          <LanguageBadge language={language} className={styles.headerBadge} />
        )}
        <button
          type="button"
          className={`${styles.copyButton} ${copied ? styles.copied : ""}`}
          onClick={() => void handleCopy()}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {log ? (
        <>
          <div className={styles.scroller}>{logBody}</div>
          {truncated && (
            <div className={styles.footer} aria-live="polite">
              <span>
                Showing {visibleCount} of {lines.length} lines
              </span>
              <button
                type="button"
                className={styles.footerButton}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Show less" : "Show all"}
              </button>
            </div>
          )}
        </>
      ) : (
        codeBody
      )}
    </div>
  );
}

export default CodeBlock;
