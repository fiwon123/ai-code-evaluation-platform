import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Card from "../../components/Card/Card.tsx";
import Pagination from "../../components/Pagination/Pagination.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, submissionsApi } from "../../services/api.ts";
import { extractError } from "../../utils/errors.ts";
import type { Challenge, Submission } from "../../types.ts";
import { formatRelativeTime, statusVariant } from "../../utils/formatting.ts";
import styles from "./Profile.module.css";

const PAGE_SIZE = 10;

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
                {submissions.map((submission) => (
                  <Card key={submission.id} padding="compact" className={styles.submissionItem}>
                    <Link
                      to={`/submissions/${submission.id}`}
                      className={styles.submissionLink}
                    >
                      <span className={styles.submissionTop}>
                        <Badge variant={statusVariant(submission.status)}>
                          {submission.status}
                        </Badge>
                        <span className={styles.metaDate}>
                          {formatRelativeTime(submission.created_at)}
                        </span>
                      </span>
                      <span className={styles.submissionScore}>
                        {submission.score !== null
                          ? `${submission.score}%`
                          : "—"}
                      </span>
                    </Link>
                  </Card>
                ))}
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