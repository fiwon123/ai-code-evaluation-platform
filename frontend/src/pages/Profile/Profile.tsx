import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import { Field, TextInput, useFieldId } from "../../components/Input/Input.tsx";
import Pagination from "../../components/Pagination/Pagination.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import { useToast } from "../../components/Toast/ToastContext.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useNow } from "../../hooks/useNow.ts";
import { authApi, challengesApi, submissionsApi } from "../../services/api.ts";
import { extractError, extractFieldErrors } from "../../utils/errors.ts";
import type { Challenge, Submission } from "../../types.ts";
import {
  formatDurationMs,
  formatElapsed,
  formatRelativeTime,
  isDelayed,
  isSeverelyDelayed,
  statusVariant,
} from "../../utils/formatting.ts";
import styles from "./Profile.module.css";

const PAGE_SIZE = 10;
// While any submission is still pending/processing, re-fetch the list on this
// interval so rows flip to their terminal state (e.g. the recovery sweep fails
// an abandoned pending row) without a manual page reload.
const SUBMISSIONS_POLL_INTERVAL_MS = 5_000;

function Profile() {
  const { user } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [challengesPages, setChallengesPages] = useState(0);
  const [challengesTotal, setChallengesTotal] = useState(0);
  const [challengePage, setChallengePage] = useState(1);

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsPages, setSubmissionsPages] = useState(0);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [submissionPage, setSubmissionPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live elapsed ticks only while at least one submission is still running.
  const hasInProgress = submissions.some(
    (s) => s.status === "pending" || s.status === "processing",
  );
  const now = useNow(hasInProgress);

  // Password change form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordFieldErrors, setPasswordFieldErrors] = useState<
    Record<string, string>
  >({});
  const [changingPassword, setChangingPassword] = useState(false);
  const { showToast } = useToast();
  const currentPasswordId = useFieldId("current-password");
  const newPasswordId = useFieldId("new-password");
  const confirmPasswordId = useFieldId("confirm-password");

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordFieldErrors({});

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setChangingPassword(true);
    try {
      await authApi.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Password updated successfully.", "success");
    } catch (err) {
      setPasswordError(extractError(err));
      setPasswordFieldErrors(extractFieldErrors(err));
    } finally {
      setChangingPassword(false);
    }
  }

  // Fetch challenges and submissions independently so paginating one list
  // never re-fetches (or resets) the other.
  useEffect(() => {
    if (!user) {
      return;
    }
    const userId = user.id;
    const controller = new AbortController();
    async function load() {
      try {
        const challengeResp = await challengesApi.list(
          {
            owner_id: userId,
            page: challengePage,
            page_size: PAGE_SIZE,
          },
          { signal: controller.signal },
        );
        setChallenges(challengeResp.items);
        setChallengesPages(challengeResp.pages);
        setChallengesTotal(challengeResp.total);
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
  }, [user, challengePage]);

  useEffect(() => {
    if (!user) {
      return;
    }
    const controller = new AbortController();
    async function load() {
      try {
        const submissionResp = await submissionsApi.list(
          {
            page: submissionPage,
            page_size: PAGE_SIZE,
          },
          { signal: controller.signal },
        );
        setSubmissions(submissionResp.items);
        setSubmissionsPages(submissionResp.pages);
        setSubmissionsTotal(submissionResp.total);
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
  }, [user, submissionPage]);

  // Light polling while any submission is still in progress: the recovery
  // sweep (Celery beat) fails abandoned pending rows in the background, but
  // the list is otherwise a one-shot fetch — without this, rows would keep
  // showing "pending … delayed" until a manual reload or page change.
  useEffect(() => {
    if (!user || !hasInProgress) {
      return;
    }
    let cancelled = false;
    let pollTimer: number | undefined;
    async function poll() {
      try {
        const submissionResp = await submissionsApi.list({
          page: submissionPage,
          page_size: PAGE_SIZE,
        });
        if (!cancelled) {
          setSubmissions(submissionResp.items);
        }
      } catch {
        // Transient poll errors keep the last known data; the next tick retries.
      } finally {
        if (!cancelled) {
          pollTimer = window.setTimeout(() => {
            pollTimer = undefined;
            void poll();
          }, SUBMISSIONS_POLL_INTERVAL_MS);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      if (pollTimer !== undefined) {
        window.clearTimeout(pollTimer);
      }
    };
  }, [user, submissionPage, hasInProgress]);

  const stats = useMemo(() => {
    const completed = submissions.filter((s) => s.status === "completed");
    const scores = completed
      .map((s) => s.score)
      .filter((score): score is number => score !== null);
    const avgScore =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
          10
        : 0;
    const completionRate =
      submissions.length > 0
        ? Math.round((completed.length / submissions.length) * 100)
        : 0;
    return {
      totalChallenges: challengesTotal,
      totalSubmissions: submissionsTotal,
      avgScore,
      completionRate,
    };
  }, [submissions, challengesTotal, submissionsTotal]);

  if (loading || !user) {
    return (
      <div className={styles.page} role="status" aria-label="Loading dashboard">
        <Skeleton variant="rect" width="100%" height="140px" />
        <Skeleton variant="rect" width="100%" height="220px" />
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
      <Card className={styles.profileCard}>
        <div className={styles.avatar}>{user.username.charAt(0).toUpperCase()}</div>
        <div className={styles.identity}>
          <h1 className={styles.name}>{user.username}</h1>
          <p className={styles.email}>{user.email}</p>
          <p className={styles.memberSince}>
            Member since{" "}
            {new Date(user.created_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
            })}
          </p>
        </div>
        <div className={styles.profileActions}>
          <Link to="/challenges/new">+ New challenge</Link>
        </div>
      </Card>

      <Card className={styles.passwordCard}>
        <div className={styles.passwordHeader}>
          <h2 className={styles.passwordTitle}>Change password</h2>
          <p className={styles.passwordSubtitle}>
            Use at least 8 characters. Your other sessions stay signed in.
          </p>
        </div>
        <form onSubmit={(e) => void handlePasswordChange(e)} className={styles.passwordForm}>
          <Field
            label="Current password"
            id={currentPasswordId}
            error={passwordFieldErrors.current_password}
          >
            <TextInput
              id={currentPasswordId}
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              invalid={Boolean(passwordFieldErrors.current_password)}
            />
          </Field>
          <Field
            label="New password"
            id={newPasswordId}
            error={passwordFieldErrors.new_password}
          >
            <TextInput
              id={newPasswordId}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              invalid={Boolean(passwordFieldErrors.new_password)}
            />
          </Field>
          <Field label="Confirm new password" id={confirmPasswordId}>
            <TextInput
              id={confirmPasswordId}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
            />
          </Field>
          {passwordError && (
            <p role="alert" className={styles.passwordError}>
              {passwordError}
            </p>
          )}
          <div className={styles.passwordActions}>
            <Button
              type="submit"
              loading={changingPassword}
              loadingText="Updating…"
            >
              Update password
            </Button>
          </div>
        </form>
      </Card>

      <div className={styles.statsRow}>
        <Card className={styles.statCard}>
          <span className={styles.statValue}>{stats.totalChallenges}</span>
          <span className={styles.statLabel}>Challenges created</span>
        </Card>
        <Card className={styles.statCard}>
          <span className={styles.statValue}>{stats.totalSubmissions}</span>
          <span className={styles.statLabel}>Evaluations run</span>
        </Card>
        <Card className={styles.statCard}>
          <span className={styles.statValue}>{stats.avgScore}%</span>
          <span className={styles.statLabel}>Average score</span>
        </Card>
        <Card className={styles.statCard}>
          <span className={styles.statValue}>{stats.completionRate}%</span>
          <span className={styles.statLabel}>Completion rate</span>
        </Card>
      </div>

      <div className={styles.columns}>
        <section className={styles.col}>
          <div className={styles.colHeader}>
            <h2 className={styles.colTitle}>My challenges</h2>
            <Link to="/challenges/new" className={styles.colAction}>
              New
            </Link>
          </div>
          {challenges.length === 0 ? (
            <Card className={styles.emptyCard}>
              <p className={styles.emptyText}>You haven't created any challenges yet.</p>
              <Link to="/challenges/new">Create your first challenge</Link>
            </Card>
          ) : (
            <>
              <div className={styles.challengeList}>
                {challenges.map((challenge) => (
                  <Card key={challenge.id} padding="compact" className={styles.challengeItem}>
                    <Link to={`/challenges/${challenge.id}`} className={styles.challengeTitle}>
                      {challenge.title}
                    </Link>
                    <div className={styles.challengeMeta}>
                      <Badge variant="neutral">{challenge.language}</Badge>
                      <span className={styles.metaDate}>
                        {formatRelativeTime(challenge.created_at)}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
              <Pagination
                page={challengePage}
                pages={challengesPages}
                total={challengesTotal}
                pageSize={PAGE_SIZE}
                onPageChange={setChallengePage}
              />
            </>
          )}
        </section>

        <section className={styles.col}>
          <div className={styles.colHeader}>
            <h2 className={styles.colTitle}>Recent submissions</h2>
          </div>
          {submissions.length === 0 ? (
            <Card className={styles.emptyCard}>
              <p className={styles.emptyText}>
                You haven't run any evaluations yet.
              </p>
              <Link to="/challenges">Browse challenges</Link>
            </Card>
          ) : (
            <>
              <div className={styles.submissionList}>
                {submissions.map((submission) => {
                  const inProgress =
                    submission.status === "pending" ||
                    submission.status === "processing";
                  const durationMs =
                    submission.evaluation_result?.metrics.duration_ms;
                  return (
                    <Card
                      key={submission.id}
                      padding="compact"
                      className={styles.submissionItem}
                    >
                      <Link
                        to={`/submissions/${submission.id}`}
                        className={styles.submissionLink}
                      >
                        <span className={styles.submissionTop}>
                          <Badge variant={statusVariant(submission.status)}>
                            {submission.status}
                          </Badge>
                          {inProgress ? (
                            <span className={styles.waitingText}>
                              waiting {formatElapsed(submission.created_at, now)}
                            </span>
                          ) : (
                            <span className={styles.metaDate}>
                              {formatRelativeTime(submission.created_at)}
                            </span>
                          )}
                          {inProgress && isDelayed(submission.created_at, now) && (
                            <span
                              className={
                                submission.status === "pending" &&
                                isSeverelyDelayed(submission.created_at, now)
                                  ? styles.stuckTag
                                  : styles.delayedTag
                              }
                            >
                              {submission.status === "pending" &&
                              isSeverelyDelayed(submission.created_at, now)
                                ? "stuck"
                                : "delayed"}
                            </span>
                          )}
                        </span>
                        <span className={styles.submissionScore}>
                          {submission.score !== null
                            ? `${submission.score}%`
                            : "—"}
                          {typeof durationMs === "number" && (
                            <span className={styles.durationText}>
                              {" "}
                              · {formatDurationMs(durationMs)}
                            </span>
                          )}
                        </span>
                      </Link>
                    </Card>
                  );
                })}
              </div>
              <Pagination
                page={submissionPage}
                pages={submissionsPages}
                total={submissionsTotal}
                pageSize={PAGE_SIZE}
                onPageChange={setSubmissionPage}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default Profile;