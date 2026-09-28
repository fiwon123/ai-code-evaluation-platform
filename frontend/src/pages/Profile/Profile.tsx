import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import { Field, TextInput, useFieldId } from "../../components/Input/Input.tsx";
import LanguageBadge from "../../components/LanguageBadge/LanguageBadge.tsx";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import Pagination from "../../components/Pagination/Pagination.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import StatCard from "../../components/StatCard/StatCard.tsx";
import { useToast } from "../../components/Toast/ToastContext.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useNow } from "../../hooks/useNow.ts";
import { useShareLink } from "../../hooks/useShareLink.ts";
import { authApi, challengesApi, submissionsApi } from "../../services/api.ts";
import { extractError, extractFieldErrors } from "../../utils/errors.ts";
import type {
  Challenge,
  ChallengeStatsItem,
  Submission,
  SubmissionStats,
} from "../../types.ts";
import {
  formatDurationMs,
  formatElapsed,
  formatRelativeTime,
  isDelayed,
  isSeverelyDelayed,
  scoreVariant,
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

  // Per-challenge evaluation stats (all pages, not just the visible one).
  const [challengeStats, setChallengeStats] = useState<ChallengeStatsItem[]>([]);

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

  // Per-challenge stats are computed server-side so the headline numbers
  // reflect every submission, not just the visible page.
  useEffect(() => {
    if (!user) {
      return;
    }
    const controller = new AbortController();
    submissionsApi
      .stats()
      .then((stats: SubmissionStats) => {
        if (!controller.signal.aborted) {
          setChallengeStats(stats.items);
        }
      })
      .catch(() => {
        // Non-fatal: the dashboard still works without per-challenge stats.
      });
    return () => controller.abort();
  }, [user]);

  const stats = useMemo(() => {
    const completed = submissions.filter((s) => s.status === "completed");
    const scores = completed
      .map((s) => s.score)
      .filter((score): score is number => score !== null);
    const pageAvg =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
          10
        : 0;
    const pageRate =
      submissions.length > 0
        ? Math.round((completed.length / submissions.length) * 100)
        : 0;

    const totalRuns = challengeStats.reduce((sum, item) => sum + item.total_runs, 0);
    const completedRuns = challengeStats.reduce(
      (sum, item) => sum + item.completed_runs,
      0,
    );
    const weightedScores = challengeStats.reduce(
      (sum, item) => sum + (item.avg_score ?? 0) * item.completed_runs,
      0,
    );
    return {
      totalChallenges: challengesTotal,
      totalSubmissions: submissionsTotal,
      avgScore:
        completedRuns > 0
          ? Math.round((weightedScores / completedRuns) * 10) / 10
          : pageAvg,
      completionRate:
        totalRuns > 0
          ? Math.round((completedRuns / totalRuns) * 100)
          : pageRate,
    };
  }, [submissions, challengesTotal, submissionsTotal, challengeStats]);

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
          <PageTitle size="sm" className={styles.name}>{user.username}</PageTitle>
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
        <StatCard
          label="Challenges created"
          value={stats.totalChallenges}
          accent="primary"
        />
        <StatCard
          label="Evaluations run"
          value={stats.totalSubmissions}
          accent="teal"
        />
        {/* Score and completion rate are judgements, not identities, so their
            colour comes from the value the same way the per-challenge chips
            below already do — one reader learns the scale once and reads it in
            both places. `scoreVariant` is the single source of that scale. */}
        <StatCard
          label="Average score"
          value={`${stats.avgScore}%`}
          accent={scoreVariant(stats.avgScore)}
        />
        <StatCard
          label="Completion rate"
          value={`${stats.completionRate}%`}
          accent={scoreVariant(stats.completionRate)}
        />
      </div>

      <section className={styles.section}>
        <div className={styles.colHeader}>
          <h2 className={styles.colTitle}>Evaluations by challenge</h2>
        </div>
        {challengeStats.length === 0 ? (
          <Card className={styles.emptyCard}>
            <p className={styles.emptyText}>
              You haven't evaluated any challenges yet.
            </p>
            <Link to="/challenges">Browse challenges</Link>
          </Card>
        ) : (
          <div className={styles.statsGrid}>
            {challengeStats.map((item) => {
              const variant =
                item.avg_score !== null ? scoreVariant(item.avg_score) : null;
              return (
                <Card
                  key={item.challenge_id}
                  padding="compact"
                  className={styles.statsItem}
                >
                  <Link
                    to={`/challenges/${item.challenge_id}`}
                    className={styles.statsTitle}
                  >
                    {item.challenge_title}
                  </Link>
                  <div className={styles.statsMeta}>
                    <LanguageBadge language={item.language} />
                    {item.avg_score !== null && (
                      <span
                        className={`${styles.scoreChip} ${variant ? styles[`chip${variant}`] : ""}`}
                      >
                        {item.avg_score}% avg
                      </span>
                    )}
                  </div>
                  <p className={styles.statsLine}>
                    {item.best_score !== null && (
                      <>
                        best <strong>{item.best_score}%</strong> ·{" "}
                      </>
                    )}
                    {item.total_runs} run{item.total_runs === 1 ? "" : "s"}
                    {item.failed_runs > 0 && ` · ${item.failed_runs} failed`}
                    {item.completed_runs === 0 && " · no completed runs"}
                  </p>
                  <p className={styles.metaDate}>
                    Last run {formatRelativeTime(item.last_run_at)}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </section>

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
                      <LanguageBadge language={challenge.language} />
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
              <Link to="/challenges" className={styles.browseLink}>
                Browse challenges
              </Link>
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
                      {submission.status === "completed" &&
                        submission.evaluation_result && (
                          <SubmissionShareActions
                            submissionId={submission.id}
                            initialToken={
                              submission.evaluation_result.share_token ?? null
                            }
                          />
                        )}
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

/** Compact share controls for one completed submission row. */
function SubmissionShareActions({
  submissionId,
  initialToken,
}: {
  submissionId: string;
  initialToken: string | null;
}) {
  const { shareToken, busy, copied, error, share, revoke, copy } = useShareLink(
    submissionId,
    initialToken,
  );
  return (
    <div className={styles.submissionActions}>
      {shareToken ? (
        <>
          <Badge variant="success">Shared</Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copy()}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            loadingText="…"
            onClick={() => void revoke()}
          >
            Revoke
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          loading={busy}
          loadingText="Sharing…"
          onClick={() => void share()}
        >
          Share
        </Button>
      )}
      {error && (
        <span role="alert" className={styles.actionsError}>
          {error}
        </span>
      )}
    </div>
  );
}

export default Profile;