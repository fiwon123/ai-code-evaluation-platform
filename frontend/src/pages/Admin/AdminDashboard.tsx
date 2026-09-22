import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Card from "../../components/Card/Card.tsx";
import Skeleton from "../../components/Skeleton/Skeleton.tsx";
import { adminApi } from "../../services/api.ts";
import type { PlatformStats } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
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
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className={styles.statCard}>
            <Skeleton variant="text" width="40%" height="1.75rem" />
            <Skeleton variant="text" width="70%" height="0.75rem" />
          </Card>
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

  const cards = [
    { label: "Users", value: stats.total_users, to: "/admin/users" },
    { label: "Challenges", value: stats.total_challenges, to: "/admin/challenges" },
    { label: "Submissions", value: stats.total_submissions, to: "/admin/submissions" },
    { label: "Completed", value: stats.completed_submissions },
    { label: "Failed", value: stats.failed_submissions },
    { label: "Pending / processing", value: stats.pending_submissions },
    {
      label: "Average score",
      value:
        stats.average_score !== null && stats.average_score !== undefined
          ? `${Math.round(stats.average_score)}%`
          : "—",
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Admin dashboard</h1>
        <p className={styles.subtitle}>Platform-wide statistics and moderation.</p>
      </div>

      <div className={styles.grid}>
        {cards.map((card) => {
          const content = (
            <Card className={styles.statCard}>
              <span className={styles.statValue}>{card.value}</span>
              <span className={styles.statLabel}>{card.label}</span>
            </Card>
          );
          return card.to ? (
            <Link key={card.label} to={card.to} className={styles.statLink}>
              {content}
            </Link>
          ) : (
            <div key={card.label}>{content}</div>
          );
        })}
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