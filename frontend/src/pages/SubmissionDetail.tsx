import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import CodeBlock from "../components/CodeBlock/CodeBlock.tsx";
import { submissionsApi, ApiError } from "../services/api.ts";
import type { Submission } from "../types.ts";
import styles from "./SubmissionDetail.module.css";

const POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_INTERVAL_MS = POLL_INTERVAL_MS;

function statusVariant(status: Submission["status"]): "primary" | "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    case "processing":
      return "warning";
    case "pending":
      return "primary";
    default:
      return "neutral";
  }
}

function SubmissionDetail({ pollIntervalMs = DEFAULT_POLL_INTERVAL_MS }: { pollIntervalMs?: number }) {
  const { id } = useParams<{ id: string }>();
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        if (data.status === "pending" || data.status === "processing") {
          pollTimer = window.setTimeout(() => void load(), pollIntervalMs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.detail : "Failed to load submission.",
          );
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
  }, [id]);

  if (loading) {
    return <p>Loading submission…</p>;
  }

  if (error || !submission) {
    return (
      <div>
        <p role="alert">{error ?? "Submission not found."}</p>
        <p>
          <Link to="/challenges">Back to challenges</Link>
        </p>
      </div>
    );
  }

  const result = submission.evaluation_result;
  const inProgress = submission.status === "pending" || submission.status === "processing";

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
            Your submission is being processed… the page refreshes
            automatically.
          </p>
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
          </div>

          <Card>
            <h2 className={styles.sectionTitle}>Generated code</h2>
            {submission.code ? (
              <CodeBlock code={submission.code} language="python" />
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