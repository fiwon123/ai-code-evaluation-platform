import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Card from "../../components/Card/Card.tsx";
import { SelectInput } from "../../components/Input/Input.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import Pagination from "../../components/Pagination/Pagination.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import { adminApi } from "../../services/api.ts";
import type { AdminSubmission, SubmissionStatus } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
import { formatRelativeTime, statusVariant } from "../../utils/formatting.ts";
import styles from "./Admin.module.css";

const PAGE_SIZE = 20;

function AdminSubmissions() {
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubmissionStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setPage(1);
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await adminApi.listSubmissions(
          {
            page,
            page_size: PAGE_SIZE,
            status: status === "all" ? undefined : status,
          },
          { signal: controller.signal },
        );
        setSubmissions(data.items);
        setPages(data.pages);
        setTotal(data.total);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(extractError(err));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [page, status]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading submissions" className={styles.status}>
        <Card className={styles.tableCard}>
          <Skeleton variant="rect" width="100%" height="280px" />
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className={styles.status}>
        {error}
      </p>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageTitle size="sm" className={styles.title}>Submissions</PageTitle>
        <p className={styles.subtitle}>Every evaluation run across the platform.</p>
      </div>

      <div className={styles.toolbar}>
        <SelectInput
          id="admin-submission-status"
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as SubmissionStatus | "all")}
          aria-label="Filter by status"
          className={styles.filterSelect}
        >
          <option value="all">All statuses</option>
          <option value="pending">pending</option>
          <option value="processing">processing</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
        </SelectInput>
      </div>

      <Card className={styles.tableCard} padding="none">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Submission</th>
                <th>User</th>
                <th>Challenge</th>
                <th>Status</th>
                <th>Provider</th>
                <th>Score</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id}>
                  <td>
                    <Link
                      to={`/submissions/${submission.id}`}
                      className={styles.cellLink}
                    >
                      {submission.id}
                    </Link>
                  </td>
                  <td>
                    <span className={styles.cellStrong}>
                      {submission.username}
                    </span>
                  </td>
                  <td>
                    <Link
                      to={`/challenges/${submission.challenge_id}`}
                      className={styles.cellStrong}
                    >
                      {submission.challenge_title}
                    </Link>
                    <span className={styles.cellMuted}>
                      {submission.challenge_id}
                    </span>
                  </td>
                  <td>
                    <Badge variant={statusVariant(submission.status)}>
                      {submission.status}
                    </Badge>
                  </td>
                  <td className={styles.cellMuted}>
                    {submission.provider ?? "—"}
                  </td>
                  <td className={styles.cellStrong}>
                    {submission.score !== null ? `${submission.score}%` : "—"}
                  </td>
                  <td className={styles.cellMuted}>
                    {formatRelativeTime(submission.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {submissions.length === 0 && (
          <p className={styles.empty}>No submissions found.</p>
        )}
      </Card>

      <Pagination
        page={page}
        pages={pages}
        total={total}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

export default AdminSubmissions;