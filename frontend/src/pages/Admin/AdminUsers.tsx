import { useEffect, useState } from "react";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import ConfirmDialog from "../../components/ConfirmDialog/ConfirmDialog.tsx";
import { TextInput } from "../../components/Input/Input.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import Pagination from "../../components/Pagination/Pagination.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useToast } from "../../components/Toast/ToastContext.tsx";
import { adminApi } from "../../services/api.ts";
import type { User } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
import { formatRelativeTime } from "../../utils/formatting.ts";
import styles from "./Admin.module.css";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function AdminUsers() {
  const { user: currentUser } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
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
        const data = await adminApi.listUsers(
          {
            page,
            page_size: PAGE_SIZE,
            search: debouncedSearch || undefined,
          },
          { signal: controller.signal },
        );
        setUsers(data.items);
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

  async function toggleAdmin(user: User) {
    setUpdatingId(user.id);
    setError(null);
    try {
      const updated = await adminApi.updateUser(user.id, {
        is_admin: !user.is_admin,
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      showToast(
        `${updated.username} is ${updated.is_admin ? "now" : "no longer"} an admin.`,
        "success",
      );
    } catch (err) {
      setError(extractError(err));
    } finally {
      setUpdatingId(null);
    }
  }

  async function deactivate(user: User) {
    setUpdatingId(user.id);
    setError(null);
    try {
      const updated = await adminApi.deactivateUser(user.id);
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      showToast(`${updated.username} deactivated.`, "success");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setUpdatingId(null);
    }
  }

  async function reactivate(user: User) {
    setUpdatingId(user.id);
    setError(null);
    try {
      const updated = await adminApi.reactivateUser(user.id);
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u)),
      );
      showToast(`${updated.username} restored.`, "success");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setUpdatingId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await adminApi.deleteUser(pendingDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== pendingDelete.id));
      setPendingDelete(null);
      showToast(`${pendingDelete.username} deleted.`, "success");
    } catch (err) {
      setError(extractError(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading users" className={styles.status}>
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
        <PageTitle size="sm" className={styles.title}>Users</PageTitle>
        <p className={styles.subtitle}>
          Manage accounts: promote admins, deactivate or restore, and delete
          users.
        </p>
      </div>

      <div className={styles.toolbar}>
        <TextInput
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search email or username…"
          aria-label="Search users"
          className={styles.searchInput}
        />
      </div>

      <Card className={styles.tableCard} padding="none">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
                <th className={styles.actionsCol}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const own = currentUser?.id === user.id;
                return (
                  <tr key={user.id}>
                    <td>
                      <span className={styles.cellStrong}>{user.username}</span>
                      <span className={styles.cellMuted}>{user.email}</span>
                    </td>
                    <td>
                      {user.is_admin ? (
                        <Badge variant="primary">admin</Badge>
                      ) : (
                        <Badge variant="neutral">user</Badge>
                      )}
                    </td>
                    <td>
                      {user.is_active ? (
                        <Badge variant="success">active</Badge>
                      ) : (
                        <Badge variant="danger">deactivated</Badge>
                      )}
                    </td>
                    <td className={styles.cellMuted}>
                      {formatRelativeTime(user.created_at)}
                    </td>
                    <td className={styles.actionsCol}>
                      <div className={styles.rowActions}>
                        <Button
                          variant={user.is_admin ? "secondary" : "ghost"}
                          size="sm"
                          disabled={own || updatingId === user.id}
                          onClick={() => void toggleAdmin(user)}
                        >
                          {user.is_admin ? "Revoke admin" : "Make admin"}
                        </Button>
                        {user.is_active ? (
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={own || updatingId === user.id}
                            onClick={() => void deactivate(user)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={own || updatingId === user.id}
                            onClick={() => void reactivate(user)}
                          >
                            Restore
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={own || updatingId === user.id}
                          onClick={() => setPendingDelete(user)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {users.length === 0 && (
          <p className={styles.empty}>No users found.</p>
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
        title="Delete user?"
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        {pendingDelete
          ? `"${pendingDelete.username}" and their challenges, submissions, and results will be permanently removed. This cannot be undone.`
          : ""}
      </ConfirmDialog>
    </div>
  );
}

export default AdminUsers;