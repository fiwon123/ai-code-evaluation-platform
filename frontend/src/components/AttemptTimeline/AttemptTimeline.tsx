import Badge from "../Badge/Badge.tsx";
import CodeBlock from "../CodeBlock/CodeBlock.tsx";
import { extensionForLanguage } from "../../utils/language.ts";
import type { EvaluationAttempt } from "../../types.ts";
import styles from "./AttemptTimeline.module.css";

interface AttemptTimelineProps {
  /** Every attempt, oldest first (as the API returns them). */
  attempts: EvaluationAttempt[];
  /** Repair budget the run was given, for "Attempt 2 of 3". */
  maxAttempts?: number;
  language: string | null;
  /**
   * Attempt number that produced the report being viewed — marked as current.
   * Omitted while a run is still going and no attempt has passed yet.
   */
  currentAttempt?: number | null;
}

/** Score bucket for an attempt: all green, all red, or partial. */
function scoreClass(score: number, passedAll: boolean): string {
  if (passedAll) {
    return styles.pass;
  }
  return score > 0 ? styles.partial : styles.fail;
}

/**
 * The repair history for a submission: what each attempt scored, why it
 * failed, and — behind a disclosure — the code and raw logs that produced it.
 *
 * The readable summary leads each row because the raw runner dump is the thing
 * that was unreadable; the dump stays one click away rather than being the
 * headline. Attempt 1 is the original generation, so a run that passed first
 * try shows exactly one row and the UI looks like it always did.
 */
function AttemptTimeline({
  attempts,
  maxAttempts,
  language,
  currentAttempt,
}: AttemptTimelineProps) {
  if (attempts.length === 0) {
    return null;
  }
  const budget = maxAttempts && maxAttempts > 1 ? ` of ${maxAttempts}` : "";

  return (
    <ol className={styles.timeline} aria-label="Repair attempts">
      {attempts.map((attempt) => {
        // A run that reported no test case at all (a timeout, a suite that
        // failed to import) is stored as 0/0, and 0 >= 0 would score it green
        // and badge it "Final" — the UI claiming a pass for a run that never
        // executed. Require a real denominator before believing the ratio.
        const ranTests = attempt.total_tests > 0;
        const passedAll = ranTests && attempt.passed_tests >= attempt.total_tests;
        const isCurrent = currentAttempt === attempt.attempt_number;
        const label = `Attempt ${attempt.attempt_number}${budget}`;
        return (
          <li
            key={attempt.id}
            className={`${styles.attempt}${isCurrent ? ` ${styles.current}` : ""}`}
          >
            <div className={styles.header}>
              <span className={styles.number}>{label}</span>
              <span
                className={`${styles.score} ${scoreClass(attempt.score, passedAll)}`}
              >
                {attempt.score}%
              </span>
              <span className={styles.mutedInline}>
                {ranTests
                  ? `${attempt.passed_tests}/${attempt.total_tests} tests`
                  : "no tests ran"}
              </span>
              {isCurrent ? (
                <Badge variant="primary">{passedAll ? "Final" : "Latest"}</Badge>
              ) : null}
            </div>

            {attempt.logs_summary ? (
              <p className={styles.summary}>{attempt.logs_summary}</p>
            ) : (
              <p className={styles.muted}>
                No summary was recorded for this attempt.
              </p>
            )}

            <details className={styles.disclosure}>
              <summary>Code, tests and raw logs</summary>
              <div className={styles.body}>
                {attempt.code ? (
                  <CodeBlock
                    code={attempt.code}
                    language={language ?? "python"}
                    filename={`attempt-${attempt.attempt_number}.${extensionForLanguage(
                      language ?? "python",
                    )}`}
                  />
                ) : null}

                {Array.isArray(attempt.test_results) && attempt.test_results.length > 0 ? (
                  <ul className={styles.tests}>
                    {attempt.test_results.map((test, index) => (
                      <li
                        key={`${attempt.id}-${test.name}-${index}`}
                        className={styles.testRow}
                      >
                        <span aria-hidden="true">{test.passed ? "✓" : "✗"}</span>
                        <span className={styles.testName}>{test.name}</span>
                        {test.message ? (
                          <span className={styles.testMessage}>{test.message}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {attempt.logs ? <CodeBlock code={attempt.logs} log /> : null}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

export default AttemptTimeline;
