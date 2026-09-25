import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import PageTitle from "../components/PageTitle/PageTitle.tsx";
import ResultReport from "../components/ResultReport/ResultReport.tsx";
import ShareResult from "../components/ShareResult/ShareResult.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useSubmissionSocket } from "../hooks/useSubmissionSocket.ts";
import { useNow } from "../hooks/useNow.ts";
import { submissionsApi } from "../services/api.ts";
import { SUBMISSION_POLL_MS } from "../constants/polling.ts";
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

const DEFAULT_POLL_INTERVAL_MS = SUBMISSION_POLL_MS;

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

  // Merge live socket data into the displayed submission. A snapshot — and now
  // a terminal update, which carries the whole persisted record — replaces the
  // live state; a mid-pipeline status/phase update patches it in place.
  //
  // The REST fetch below is the safety net, not the happy path: it only fires
  // when the socket went terminal WITHOUT the record, i.e. a dropped or
  // partial message sequence, an older server, or a reconnect that missed the
  // terminal event. When the socket did deliver the record there is nothing to
  // fetch, and the user sees output without the extra round-trip.
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

  // Elapsed time measures from when evaluation actually began once the row is
  // processing (started_at), falling back to creation while still queued.
  const elapsedFrom =
    submission?.status === "processing" && submission?.started_at
      ? submission.started_at
      : submission?.created_at ?? "";

  // Human-readable phase label while processing ("generating" = LLM call in
  // flight, "testing" = code generated, tests running). Rows without a phase
  // (legacy data / PATCHed states) fall back to the generic wording.
  const phaseLabel =
    submission?.status === "processing"
      ? submission.phase === "generating"
        ? "Generating code…"
        : submission.phase === "testing"
          ? "Running tests…"
          : "Running your evaluation…"
      : null;

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
        <PageTitle className={styles.title}>Evaluation report</PageTitle>
        <Badge variant={statusVariant(submission.status)}>{submission.status}</Badge>
      </div>

      {inProgress ? (
        <Card>
          <p className={styles.progressText}>
            {submission.status === "pending"
              ? "Waiting in the evaluation queue…"
              : (phaseLabel ?? "Running your evaluation…")}
          </p>
          <p className={styles.estimate}>
            Elapsed: <strong>{formatElapsed(elapsedFrom, now)}</strong>
            {" · "}Most evaluations finish in{" "}
            {evaluationEstimate(submission.language)}. The page refreshes
            automatically.
          </p>
          {isDelayed(
            submission.status === "processing" && submission.started_at
              ? submission.started_at
              : submission.created_at,
            now,
          ) &&
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
            Queued at {new Date(submission.created_at).toLocaleString()}
            {submission.started_at &&
              ` · started at ${new Date(submission.started_at).toLocaleTimeString()}`}
            {" · "}provider: <code>{submission.provider ?? "demo"}</code>
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