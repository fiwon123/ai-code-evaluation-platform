import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import ConfirmDialog from "../../components/ConfirmDialog/ConfirmDialog.tsx";
import { TextInput } from "../../components/Input/Input.tsx";
import LanguageBadge from "../../components/LanguageBadge/LanguageBadge.tsx";
import Pagination from "../../components/Pagination/Pagination.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import { useToast } from "../../components/Toast/ToastContext.tsx";
import { adminApi } from "../../services/api.ts";
import type { Challenge } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
import { formatRelativeTime } from "../../utils/formatting.ts";
import styles from "./Admin.module.css";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function AdminChallenges() {
  const { showToast } = useToast();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<Challenge | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await adminApi.listChallenges(
          {
            page,
            page_size: PAGE_SIZE,
            search: debouncedSearch || undefined,
          },
          { signal: controller.signal },
        );
        setChallenges(data.items);
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
  }, [page, debouncedSearch]);

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await adminApi.removeChallenge(pendingDelete.id);
      setChallenges((prev) => prev.filter((c) => c.id !== pendingDelete.id));
      setPendingDelete(null);
      showToast("Challenge deleted.", "success");
    } catch (err) {
      setError(extractError(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading challenges" className={styles.status}>
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
        <h1 className={styles.title}>Challenges</h1>
        <p className={styles.subtitle}>Review and remove challenges.</p>
      </div>

      <div className={styles.toolbar}>
        <TextInput
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or description…"
          aria-label="Search challenges"
          className={styles.searchInput}
        />
      </div>

      <Card className={styles.tableCard} padding="none">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Language</th>
                <th>Created</th>
                <th className={styles.actionsCol}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {challenges.map((challenge) => (
                <tr key={challenge.id}>
                  <td>
                    <Link to={`/challenges/${challenge.id}`} className={styles.cellLink}>
                      {challenge.title}
                    </Link>
                    <span className={styles.cellMuted}>{challenge.id}</span>
                  </td>
                  <td>
                    <LanguageBadge language={challenge.language} />
                  </td>
                  <td className={styles.cellMuted}>
                    {formatRelativeTime(challenge.created_at)}
                  </td>
                  <td className={styles.actionsCol}>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setPendingDelete(challenge)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {challenges.length === 0 && (
          <p className={styles.empty}>No challenges found.</p>
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
        title="Delete challenge?"
        confirmLabel="Delete"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        {pendingDelete
          ? `"${pendingDelete.title}" and its submissions will be permanently removed. This cannot be undone.`
          : ""}
      </ConfirmDialog>
    </div>
  );
}

export default AdminChallenges;