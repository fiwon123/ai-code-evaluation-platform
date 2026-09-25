/**
 * Severity classification for log/output lines.
 *
 * There is no highlighting library in this app by design (zero runtime deps
 * beyond React/Router), so colorization is a small ordered rule set instead of
 * a tokenizer. The rules are deliberately about *log shape* — pytest, unittest,
 * `node --test`, `go test` and JUnit all announce themselves with a small set
 * of stable tokens — rather than about any one language, since `CodeBlock` is
 * shared by all five.
 */

export type LogSeverity = "error" | "warning" | "success" | "trace" | "info";

/**
 * Continuation of a traceback: a frame, not a new finding. Dimming these is
 * what makes the message below them readable — a stack trace is mostly frames.
 *
 * Requires leading whitespace so that a bare `12:04:31 booting` timestamp is
 * not mistaken for a `file:line` frame.
 */
const TRACE_FRAME = /^\s+(at\s|raise\b|File\s"|\S+:\d+|from\s)/;

/** The head of a Python traceback, or any line naming an error type. */
const ERROR_LINE =
  /^\s*traceback\b|\b\w*(?:error|exception)\s*:|\b(?:error|exception|fatal|panic|assertion)\b|\bfail(?:ed|ure|ures)?\b|^[E>]\s|\bE\s{2,}|not ok \d|✗|✘|×|❌/i;

/** `WARNING`, `WARN`, pytest's `W   ` marker, or a warning glyph. */
const WARNING_LINE = /\b(?:warn|warning)\b|^W\s|\bW\s{2,}|⚠/i;

/** `PASSED`, `1 passed`, `ok 3 - name`, a check glyph. */
const SUCCESS_LINE = /\b(?:pass|passed|ok)\b|✓|✔/i;

/**
 * Ordered; the first match wins. `error` precedes `success` on purpose: the
 * pytest summary `1 failed, 4 passed` must read as the failure it is, not as
 * the four successes it also contains.
 */
const RULES: ReadonlyArray<readonly [LogSeverity, RegExp]> = [
  ["trace", TRACE_FRAME],
  ["error", ERROR_LINE],
  ["warning", WARNING_LINE],
  ["success", SUCCESS_LINE],
];

/** Classify one line. `info` is the default and carries no extra styling. */
export function classifyLogLine(line: string): LogSeverity {
  for (const [severity, pattern] of RULES) {
    if (pattern.test(line)) {
      return severity;
    }
  }
  return "info";
}
