import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import CodeBlock from "../components/CodeBlock/CodeBlock.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useSubmissionSocket } from "../hooks/useSubmissionSocket.ts";
import { useNow } from "../hooks/useNow.ts";
import { submissionsApi } from "../services/api.ts";
import type { Submission } from "../types.ts";
import { extractError } from "../utils/errors.ts";
import {
  extensionForLanguage,
  evaluationEstimate,
} from "../utils/language.ts";
import {
  formatDurationMs,
  formatElapsed,
  humanizeMetricKey,
  isDelayed,
  isSeverelyDelayed,
  scoreVariant,
  statusVariant,
} from "../utils/formatting.ts";
import styles from "./SubmissionDetail.module.css";

const POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_INTERVAL_MS = POLL_INTERVAL_MS;

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Donut-style score ring colored by the score bucket. */
function ScoreRing({ score }: { score: number }) {
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

function SubmissionDetail({ pollIntervalMs = DEFAULT_POLL_INTERVAL_MS }: { pollIntervalMs?: number }) {
  const { id } = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { liveSubmission, state: socketState } = useSubmissionSocket(id);

  // Initial load, plus fallback polling that runs only while the WebSocket is
  // not open (the socket is the fast path; polling covers unavailable sockets).
  useEffect(() => {
    if (!id) {
      return;
    }
    const submissionId = id;
    let cancelled = false;
    let pollTimer: number | undefined;

    async function load() {
      try {
        const data = await submissionsApi.get(submissionId);
        if (cancelled) {
          return;
        }
        setSubmission(data);
        setLoading(false);
        setError(null);
        if (
          (data.status === "pending" || data.status === "processing") &&
          socketState !== "open"
        ) {
          pollTimer = window.setTimeout(() => void load(), pollIntervalMs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractError(err));
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [id, pollIntervalMs, socketState]);

  // Merge live socket data into the displayed submission. A snapshot carries
  // the full record; a status update patches the status in place. When the
  // status flips to terminal via the socket, fetch the final record once so
  // the report (code, evaluation result) is complete.
  useEffect(() => {
    if (!liveSubmission) {
      return;
    }
    setSubmission((prev) => (prev ? { ...prev, ...liveSubmission } : liveSubmission));
    setLoading(false);
    if (
      (liveSubmission.status === "completed" || liveSubmission.status === "failed") &&
      !liveSubmission.evaluation_result
    ) {
      submissionsApi
        .get(liveSubmission.id)
        .then((full) => setSubmission(full))
        .catch(() => {
          // Keep the live data — the fallback poll/refetch will surface errors.
        });
    }
  }, [liveSubmission]);

  // Tick the elapsed counter while the evaluation is still running. Derived
  // from state so this hook runs unconditionally (before the early returns).
  const inProgress =
    submission?.status === "pending" || submission?.status === "processing";
  const now = useNow(inProgress);

  if (loading) {
    return (
      <div role="status" aria-label="Loading submission">
        <Skeleton variant="text" width="40%" height="1.5rem" />
        <Skeleton variant="rect" width="100%" height="180px" />
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div>
        <p role="alert" className={styles.errorText}>
          {error ?? "Submission not found."}
        </p>
        <p>
          <Link to="/challenges">Back to challenges</Link>
        </p>
      </div>
    );
  }

  const result = submission.evaluation_result;
  const durationMs = result?.metrics.duration_ms;
  const testResults = Array.isArray(result?.test_results) ? result.test_results : [];

  return (
    <div className={styles.page}>
      <p>
        <Link to="/challenges">← Back to challenges</Link>
      </p>

      <div className={styles.header}>
        <h1 className={styles.title}>Evaluation report</h1>
        <Badge variant={statusVariant(submission.status)}>{submission.status}</Badge>
      </div>

      {inProgress ? (
        <Card>
          <p className={styles.progressText}>
            {submission.status === "pending"
              ? "Waiting in the evaluation queue…"
              : "Running your evaluation…"}
          </p>
          <p className={styles.estimate}>
            Elapsed: <strong>{formatElapsed(submission.created_at, now)}</strong>
            {" · "}Most evaluations finish in{" "}
            {evaluationEstimate(submission.language)}. The page refreshes
            automatically.
          </p>
          {isDelayed(submission.created_at, now) &&
            (submission.status === "pending" &&
            isSeverelyDelayed(submission.created_at, now) ? (
              <p role="status" className={styles.delayed}>
                This evaluation has been waiting over 10 minutes and may never
                start — the evaluation worker is likely offline. It will be
                marked as failed automatically; you can re-submit from the
                challenge page.
              </p>
            ) : (
              <p role="status" className={styles.delayed}>
                This is taking longer than usual — the server may be busy.
                Check back in a minute.
              </p>
            ))}
          <p className={styles.muted}>
            Queued at {new Date(submission.created_at).toLocaleString()} ·
            provider: <code>{submission.provider ?? "demo"}</code>
          </p>
        </Card>
      ) : result ? (
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
              <p className={styles.statValue}>{submission.status}</p>
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
            {submission.code ? (
              <CodeBlock
                code={submission.code}
                language={submission.language ?? "python"}
                filename={`solution.${extensionForLanguage(submission.language ?? "python")}`}
              />
            ) : (
              <p className={styles.muted}>No code was generated.</p>
            )}
          </Card>

          <Card>
            <h2 className={styles.sectionTitle}>Execution logs</h2>
            {result.logs ? (
              <CodeBlock code={result.logs} language="text" />
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

          <Link to={`/challenges/${submission.challenge_id}`}>
            <Button
              variant={submission.status === "failed" ? "primary" : "secondary"}
            >
              {submission.status === "failed" ? "Try again" : "Back to challenge"}
            </Button>
          </Link>
        </div>
      ) : (
        <Card>
          <p role="alert" className={styles.errorText}>
            Evaluation failed — no result was produced.
          </p>
          <div className={styles.retry}>
            <Link to={`/challenges/${submission.challenge_id}`}>
              <Button>Try again</Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}

export default SubmissionDetail;