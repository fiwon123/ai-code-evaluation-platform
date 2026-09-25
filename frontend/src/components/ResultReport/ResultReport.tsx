import Card from "../Card/Card.tsx";
import CodeBlock from "../CodeBlock/CodeBlock.tsx";
import { extensionForLanguage } from "../../utils/language.ts";
import { formatDurationMs, humanizeMetricKey, scoreVariant } from "../../utils/formatting.ts";
import type { EvaluationResult, SharedResult } from "../../types.ts";
import styles from "./ResultReport.module.css";

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Donut-style score ring colored by the score bucket. */
export function ScoreRing({ score }: { score: number }) {
  const variant = scoreVariant(score);
  const clamped = Math.min(100, Math.max(0, score));
  const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);
  return (
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      role="img"
      aria-label={`Score ${score} percent`}
      className={styles.ring}
    >
      <circle className={styles.ringTrack} cx="60" cy="60" r={RING_RADIUS} />
      <circle
        className={`${styles.ringValue} ${styles[`ring${variant}`]}`}
        cx="60"
        cy="60"
        r={RING_RADIUS}
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 60 60)"
      />
      <text x="60" y="60" textAnchor="middle" dominantBaseline="central" className={styles.ringText}>
        {score}%
      </text>
    </svg>
  );
}

interface ResultReportProps {
  /** Evaluation payload — either the owner's nested result or the public view. */
  result: EvaluationResult | SharedResult;
  /** Generated code being evaluated (may be absent on failures). */
  code: string | null;
  language: string | null;
  status?: string;
}

/**
 * The evaluation report body: score ring, pass stats, per-test breakdown,
 * generated code, logs, and metrics. Shared between the owner's submission
 * page and the public share-link page.
 */
function ResultReport({ result, code, language, status }: ResultReportProps) {
  const durationMs =
    "duration_ms" in result.metrics ? result.metrics.duration_ms : undefined;
  const testResults = Array.isArray(result.test_results) ? result.test_results : [];

  return (
    <div className={styles.report}>
      <div className={styles.stats}>
        <Card>
          <p className={styles.statLabel}>Score</p>
          <div className={styles.ringWrap}>
            <ScoreRing score={result.score} />
          </div>
        </Card>
        <Card>
          <p className={styles.statLabel}>Tests passed</p>
          <p className={styles.statValue}>
            {result.passed_tests}/{result.total_tests}
          </p>
        </Card>
        <Card>
          <p className={styles.statLabel}>Status</p>
          <p className={styles.statValue}>{status ?? "completed"}</p>
        </Card>
        <Card>
          <p className={styles.statLabel}>Duration</p>
          <p className={styles.statValue}>
            {typeof durationMs === "number" ? formatDurationMs(durationMs) : "—"}
          </p>
        </Card>
      </div>

      <Card>
        <h2 className={styles.sectionTitle}>Test results</h2>
        {testResults.length > 0 ? (
          <ul className={styles.testList} aria-label="Per-test breakdown">
            {testResults.map((test, index) => (
              <li key={`${test.name}-${index}`} className={styles.testRow}>
                <span
                  aria-hidden="true"
                  className={test.passed ? styles.testPass : styles.testFail}
                >
                  {test.passed ? "✓" : "✗"}
                </span>
                <span className={styles.testName}>{test.name}</span>
                {test.message ? (
                  <span className={styles.testMessage}>{test.message}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>
            No per-test breakdown was recorded for this run.
          </p>
        )}
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Generated code</h2>
        {code ? (
          <CodeBlock
            code={code}
            language={language ?? "python"}
            filename={`solution.${extensionForLanguage(language ?? "python")}`}
          />
        ) : (
          <p className={styles.muted}>No code was generated.</p>
        )}
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Execution logs</h2>
        {result.logs ? (
          <CodeBlock code={result.logs} log />
        ) : (
          <p className={styles.muted}>No logs recorded.</p>
        )}
      </Card>

      <Card>
        <h2 className={styles.sectionTitle}>Metrics</h2>
        {Object.keys(result.metrics).length > 0 ? (
          <table className={styles.metricTable}>
            <tbody>
              {Object.entries(result.metrics).map(([key, value]) => (
                <tr key={key}>
                  <th scope="row" className={styles.metricKey}>
                    {humanizeMetricKey(key)}
                  </th>
                  <td>
                    <code>{String(value)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={styles.muted}>No metrics recorded.</p>
        )}
      </Card>
    </div>
  );
}

export default ResultReport;