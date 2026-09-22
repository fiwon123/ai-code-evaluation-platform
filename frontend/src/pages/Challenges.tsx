import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import { SelectInput, TextInput } from "../components/Input/Input.tsx";
import Pagination from "../components/Pagination/Pagination.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi } from "../services/api.ts";
import type { Challenge } from "../types.ts";
import { formatRelativeTime } from "../utils/formatting.ts";
import styles from "./Challenges.module.css";

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;

function Challenges() {
  const { user } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [language, setLanguage] = useState("all");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Reset to page 1 whenever search or language changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, language]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await challengesApi.list({
          page,
          page_size: PAGE_SIZE,
          search: debouncedSearch || undefined,
          language: language === "all" ? undefined : language,
        });
        if (!cancelled) {
          setChallenges(data.items);
          setPages(data.pages);
          setTotal(data.total);
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
  }, [page, debouncedSearch, language]);

  const languages = useMemo(() => {
    // Keep the language dropdown populated from the current page's results;
    // fall back to a small static set so the filter stays usable.
    const set = new Set(challenges.map((c) => c.language).filter(Boolean));
    return Array.from(set).sort();
  }, [challenges]);

  if (loading) {
    return (
      <div className={styles.grid} aria-label="Loading challenges" role="status">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className={styles.card}>
            <div className={styles.cardTop}>
              <Skeleton variant="text" width="4rem" height="1.25rem" />
              <Skeleton variant="text" width="5rem" height="0.75rem" />
            </div>
            <Skeleton variant="text" width="60%" height="1.25rem" />
            <Skeleton variant="text" width="100%" height="0.75rem" />
            <Skeleton variant="text" width="90%" height="0.75rem" />
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

      {challenges.length === 0 ? (
        total === 0 && !debouncedSearch && language === "all" ? (
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
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🔍</div>
            <h2 className={styles.emptyTitle}>No matching challenges</h2>
            <p className={styles.emptyText}>
              Try a different search term or language filter.
            </p>
          </div>
        )
      ) : (
        <>
          <div className={styles.grid}>
            {challenges.map((challenge) => (
              <Link
                key={challenge.id}
                to={`/challenges/${challenge.id}`}
                className={styles.cardLink}
              >
                <Card className={styles.card}>
                  <div className={styles.cardTop}>
                    <Badge variant="neutral">{challenge.language}</Badge>
                    <span className={styles.date}>{formatRelativeTime(challenge.created_at)}</span>
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
          <Pagination
            page={page}
            pages={pages}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

export default Challenges;