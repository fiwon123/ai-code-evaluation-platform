import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import { SelectInput, TextInput } from "../components/Input/Input.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi } from "../services/api.ts";
import type { Challenge } from "../types.ts";
import styles from "./Challenges.module.css";

function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function Challenges() {
  const { user } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await challengesApi.list();
        if (!cancelled) {
          setChallenges(data);
        }
      } catch {
        if (!cancelled) {
          setError("Failed to load challenges.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const languages = useMemo(() => {
    const set = new Set(challenges.map((c) => c.language).filter(Boolean));
    return Array.from(set).sort();
  }, [challenges]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return challenges.filter((c) => {
      const matchesSearch =
        query === "" ||
        c.title.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query);
      const matchesLanguage = language === "all" || c.language === language;
      return matchesSearch && matchesLanguage;
    });
  }, [challenges, search, language]);

  if (loading) {
    return <p className={styles.status}>Loading challenges…</p>;
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
        <div>
          <h1 className={styles.title}>Challenges</h1>
          <p className={styles.subtitle}>
            Submit a challenge and let an LLM generate and evaluate a solution.
          </p>
        </div>
        <Link to="/challenges/new">
          <Button>+ New challenge</Button>
        </Link>
      </div>

      {challenges.length > 0 && (
        <div className={styles.toolbar}>
          <TextInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search challenges…"
            aria-label="Search challenges"
            className={styles.searchInput}
          />
          <SelectInput
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label="Filter by language"
            className={styles.filterSelect}
          >
            <option value="all">All languages</option>
            {languages.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </SelectInput>
        </div>
      )}

      {challenges.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🧩</div>
          <h2 className={styles.emptyTitle}>No challenges yet</h2>
          <p className={styles.emptyText}>
            Create the first challenge and let AI solve it.
          </p>
          <Link to="/challenges/new">
            <Button>Create the first challenge</Button>
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>🔍</div>
          <h2 className={styles.emptyTitle}>No matching challenges</h2>
          <p className={styles.emptyText}>
            Try a different search term or language filter.
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {filtered.map((challenge) => (
            <Link
              key={challenge.id}
              to={`/challenges/${challenge.id}`}
              className={styles.cardLink}
            >
              <Card className={styles.card}>
                <div className={styles.cardTop}>
                  <Badge variant="neutral">{challenge.language}</Badge>
                  <span className={styles.date}>{formatDate(challenge.created_at)}</span>
                </div>
                <h3 className={styles.cardTitle}>{challenge.title}</h3>
                <p className={`${styles.cardDesc} lineClamp2`}>
                  {challenge.description}
                </p>
                {user?.id === challenge.owner_id && (
                  <span className={styles.ownerBadge}>You own this</span>
                )}
                <span className={styles.cardArrow}>View challenge →</span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default Challenges;