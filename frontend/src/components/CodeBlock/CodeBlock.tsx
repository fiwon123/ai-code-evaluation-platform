import { useCallback, useMemo, useState } from "react";
import styles from "./CodeBlock.module.css";
import { classifyLogLine, type LogSeverity } from "./logSeverity";

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
  const label = filename ?? (log ? "logs" : language ? `language: ${language}` : "code");

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
        <pre className={styles.code}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

export default CodeBlock;
