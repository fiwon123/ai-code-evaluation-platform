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
  isDelayed,
  statusVariant,
} from "../utils/formatting.ts";
import styles from "./SubmissionDetail.module.css";

const POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_INTERVAL_MS = POLL_INTERVAL_MS;

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
          {isDelayed(submission.created_at, now) && (
            <p role="status" className={styles.delayed}>
              This is taking longer than usual — the worker may be busy or
              down. Check back in a minute.
            </p>
          )}
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
              <p className={styles.statValue}>{result.score}%</p>
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
            <ul className={styles.metrics}>
              {Object.entries(result.metrics).map(([key, value]) => (
                <li key={key}>
                  <span className={styles.metricKey}>{key}</span>{" "}
                  <code>{String(value)}</code>
                </li>
              ))}
            </ul>
          </Card>

          <Link to={`/challenges/${submission.challenge_id}`}>
            <Button variant="secondary">Back to challenge</Button>
          </Link>
        </div>
      ) : (
        <Card>
          <p role="alert" className={styles.errorText}>
            Evaluation failed — no result was produced.
          </p>
        </Card>
      )}
    </div>
  );
}

export default SubmissionDetail;