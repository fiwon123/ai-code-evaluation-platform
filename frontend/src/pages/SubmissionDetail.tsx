import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import ResultReport from "../components/ResultReport/ResultReport.tsx";
import ShareResult from "../components/ShareResult/ShareResult.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useSubmissionSocket } from "../hooks/useSubmissionSocket.ts";
import { useNow } from "../hooks/useNow.ts";
import { submissionsApi } from "../services/api.ts";
import type { Submission } from "../types.ts";
import { extractError } from "../utils/errors.ts";
import {
  evaluationEstimate,
} from "../utils/language.ts";
import {
  formatElapsed,
  isDelayed,
  isSeverelyDelayed,
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
          <ResultReport
            result={result}
            code={submission.code}
            language={submission.language}
            status={submission.status}
          />

          <ShareResult submissionId={submission.id} />

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