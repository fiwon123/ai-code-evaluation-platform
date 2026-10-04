import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import ConfirmDialog from "../../components/ConfirmDialog/ConfirmDialog.tsx";
import { SelectInput } from "../../components/Input/Input.tsx";
import PageHeader from "../../components/PageHeader/PageHeader.tsx";
import Pagination from "../../components/Pagination/Pagination.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import { useToast } from "../../components/Toast/ToastContext.tsx";
import { adminApi } from "../../services/api.ts";
import type { Submission, SubmissionStatus } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
import { formatElapsed, statusVariant } from "../../utils/formatting.ts";
import styles from "./Admin.module.css";

const PAGE_SIZE = 20;

function AdminSubmissions() {
  const { showToast } = useToast();
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubmissionStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<AdminSubmission | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await adminApi.removeSubmission(pendingDelete.id);
      setSubmissions((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      setTotal((prev) => Math.max(0, prev - 1));
      setPendingDelete(null);
      showToast("Submission deleted.", "success");
    } catch (err) {
      setError(extractError(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

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
      <PageHeader
        tone="app"
        title="Submissions"
        subtitle="Every evaluation run across the platform."
      />

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
                <th className={styles.actionsCol}>Actions</th>
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
                  <td className={styles.actionsCol}>
                    <div className={styles.rowActions}>
                      <Button
                        to={`/submissions/${submission.id}`}
                        variant="secondary"
                        size="sm"
                      >
                        View report
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setPendingDelete(submission)}
                      >
                        Delete
                      </Button>
                    </div>
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

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete submission?"
        confirmLabel="Delete"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        {pendingDelete
          ? "This evaluation and its logs will be permanently removed. This cannot be undone."
          : ""}
      </ConfirmDialog>
    </div>
  );
}

export default AdminSubmissions;