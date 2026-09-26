import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import ScoreRing from "../../components/ScoreRing/ScoreRing.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import StatCard, { type StatAccent } from "../../components/StatCard/StatCard.tsx";
import { adminApi } from "../../services/api.ts";
import type { PlatformStats } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
import { scoreVariant } from "../../utils/formatting.ts";
import styles from "./Admin.module.css";

function AdminDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await adminApi.stats({ signal: controller.signal });
        setStats(data);
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
  }, []);

  if (loading) {
    return (
      <div className={styles.grid} role="status" aria-label="Loading stats">
        {/* Skeletons are the real StatCard with placeholder content, so the
            grid does not resize when the data lands and the accent rule is
            already in the right place. */}
        {Array.from({ length: 7 }, (_, i) => (
          <StatCard
            key={i}
            label="Loading"
            value={<Skeleton variant="text" width="40%" height="1.75rem" />}
            accent="primary"
          />
        ))}
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

  if (!stats) {
    return null;
  }

  // The three totals are identities — a count has no opinion about being good.
  // The three statuses are judgements, and the average score is a score: both
  // take the app-wide scale (`scoreVariant`), so an operator reads the same
  // colours here as everywhere else. `to` is present only where the stat
  // actually drills down.
  const cards: Array<{
    label: string;
    value: string | number;
    accent: StatAccent;
    to?: string;
  }> = [
    { label: "Users", value: stats.total_users, accent: "primary", to: "/admin/users" },
    {
      label: "Challenges",
      value: stats.total_challenges,
      accent: "teal",
      to: "/admin/challenges",
    },
    {
      label: "Submissions",
      value: stats.total_submissions,
      accent: "violet",
      to: "/admin/submissions",
    },
    { label: "Completed", value: stats.completed_submissions, accent: "success" },
    { label: "Failed", value: stats.failed_submissions, accent: "danger" },
    {
      label: "Pending / processing",
      value: stats.pending_submissions,
      // An empty queue is not a warning, so a zero wears the calm identity
      // rather than an alarm colour that would cry wolf every morning.
      accent: stats.pending_submissions > 0 ? "warning" : "primary",
    },
    {
      label: "Average score",
      value:
        stats.average_score !== null && stats.average_score !== undefined
          ? `${Math.round(stats.average_score)} / 100`
          : "—",
      accent:
        stats.average_score !== null && stats.average_score !== undefined
          ? scoreVariant(stats.average_score)
          : "primary",
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <PageTitle size="sm" className={styles.title}>Admin dashboard</PageTitle>
        <p className={styles.subtitle}>Platform-wide statistics and moderation.</p>
      </div>

      <div className={styles.grid}>
        {cards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            accent={card.accent}
            to={card.to}
          />
        ))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Submissions by status</h2>
        <ul className={styles.statusList} aria-label="Submissions by status">
          {stats.submissions_by_status.map((group) => {
            const max = Math.max(
              1,
              ...stats.submissions_by_status.map((g) => g.count),
            );
            return (
              <li key={group.status} className={styles.statusRow}>
                <span className={styles.statusLabel}>{group.status}</span>
                <span className={styles.statusBarTrack}>
                  <span
                    className={styles.statusBar}
                    style={{
                      width: `${Math.max(3, (group.count / max) * 100)}%`,
                    }}
                  />
                </span>
                <span className={styles.statusCount}>{group.count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Submissions by language</h2>
        <ul className={styles.statusList} aria-label="Submissions by language">
          {stats.submissions_by_language.map((group) => {
            const max = Math.max(
              1,
              ...stats.submissions_by_language.map((g) => g.count),
            );
            return (
              <li key={group.language} className={styles.statusRow}>
                <span className={styles.statusLabel}>{group.language}</span>
                <span className={styles.statusBarTrack}>
                  <span
                    className={styles.statusBar}
                    style={{
                      width: `${Math.max(3, (group.count / max) * 100)}%`,
                    }}
                  />
                </span>
                <span className={styles.statusCount}>{group.count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Submissions by provider</h2>
        <ul className={styles.statusList} aria-label="Submissions by provider">
          {stats.submissions_by_provider.map((group) => {
            const max = Math.max(
              1,
              ...stats.submissions_by_provider.map((g) => g.count),
            );
            return (
              <li key={group.provider} className={styles.statusRow}>
                <span className={styles.statusLabel}>{group.provider}</span>
                <span className={styles.statusBarTrack}>
                  <span
                    className={styles.statusBar}
                    style={{
                      width: `${Math.max(3, (group.count / max) * 100)}%`,
                    }}
                  />
                </span>
                <span className={styles.statusCount}>
                  {group.count} · avg{" "}
                  {group.avg_score !== null && group.avg_score !== undefined
                    ? `${Math.round(group.avg_score)}%`
                    : "—"}{" "}
                  · pass{" "}
                  {Math.round(group.pass_rate * 100)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Failed submissions by error type</h2>
        <ul className={styles.statusList} aria-label="Failed submissions by error type">
          {stats.submissions_by_error_type.map((group) => {
            const max = Math.max(
              1,
              ...stats.submissions_by_error_type.map((g) => g.count),
            );
            return (
              <li key={group.error_type} className={styles.statusRow}>
                <span className={styles.statusLabel}>{group.error_type}</span>
                <span className={styles.statusBarTrack}>
                  <span
                    className={styles.statusBarDanger}
                    style={{
                      width: `${Math.max(3, (group.count / max) * 100)}%`,
                    }}
                  />
                </span>
                <span className={styles.statusCount}>{group.count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Top challenges</h2>
        <ol className={styles.topList} aria-label="Top challenges by run count">
          {stats.top_challenges.map((challenge) => (
            <li key={challenge.challenge_id} className={styles.topRow}>
              <span className={styles.topTitle}>{challenge.title}</span>
              <span className={styles.topMeta}>
                {challenge.runs} run{challenge.runs === 1 ? "" : "s"} · avg{" "}
                {challenge.avg_score !== null && challenge.avg_score !== undefined
                  ? `${Math.round(challenge.avg_score)}%`
                  : "—"}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Submissions — last 14 days</h2>
        <div className={styles.dailyChart} role="img" aria-label="Submissions per day — last 14 days">
          {stats.submissions_last_14_days.map((day) => {
            const max = Math.max(
              1,
              ...stats.submissions_last_14_days.map((d) => d.count),
            );
            return (
              <div key={day.date} className={styles.dailyCol}>
                <span className={styles.dailyBarWrap}>
                  <span
                    className={styles.dailyBar}
                    style={{
                      height: `${Math.max(4, (day.count / max) * 100)}%`,
                    }}
                    title={`${day.date}: ${day.count}`}
                  />
                </span>
                <span className={styles.dailyLabel}>{day.date.slice(8)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Average score</h2>
        <ScoreRing
          value={stats.average_score ?? 0}
          size={88}
          label="Average score"
        />
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Quick actions</h2>
        <div className={styles.quickActions}>
          <Link to="/admin/users" className={styles.quickAction}>
            Manage users
          </Link>
          <Link to="/admin/challenges" className={styles.quickAction}>
            Review challenges
          </Link>
          <Link to="/admin/submissions" className={styles.quickAction}>
            View submissions
          </Link>
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
