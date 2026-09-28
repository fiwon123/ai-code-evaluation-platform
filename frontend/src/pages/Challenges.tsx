import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import EmptyState from "../components/EmptyState/EmptyState.tsx";
import LanguageBadge from "../components/LanguageBadge/LanguageBadge.tsx";
import { SelectInput, TextInput } from "../components/Input/Input.tsx";
import PageTitle from "../components/PageTitle/PageTitle.tsx";
import Pagination from "../components/Pagination/Pagination.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi } from "../services/api.ts";
import type { Challenge, ChallengeDifficulty } from "../types.ts";
import { extractError } from "../utils/errors.ts";
import { formatRelativeTime } from "../utils/formatting.ts";
import { LANGUAGES, languageLabel } from "../utils/language.ts";
import styles from "./Challenges.module.css";

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;

const DIFFICULTIES: ChallengeDifficulty[] = ["easy", "medium", "hard"];

const DIFFICULTY_VARIANT: Record<
  ChallengeDifficulty,
  "success" | "warning" | "danger"
> = {
  easy: "success",
  medium: "warning",
  hard: "danger",
};

function Challenges() {
  const { user } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [language, setLanguage] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Reset to page 1 whenever any filter or the sort changes.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, language, difficulty, sort]);

  // "/" anywhere on the page focuses the search field (unless typing in one).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await challengesApi.list(
          {
            page,
            page_size: PAGE_SIZE,
            search: debouncedSearch || undefined,
            language: language === "all" ? undefined : language,
            difficulty:
              difficulty === "all" ? undefined : (difficulty as ChallengeDifficulty),
            sort: sort as "newest" | "title",
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
  }, [page, debouncedSearch, language, difficulty, sort]);

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
          <PageTitle className={styles.title}>Challenges</PageTitle>
          <p className={styles.subtitle}>
            Submit a challenge and let an LLM generate and evaluate a solution.
          </p>
        </div>
        <Button to="/challenges/new">+ New challenge</Button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <TextInput
            ref={searchRef}
            id="challenge-search"
            name="challenge_search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search challenges…"
            aria-label="Search challenges"
            className={styles.searchInput}
          />
          <kbd className={styles.searchHint} aria-hidden="true">
            /
          </kbd>
        </div>
        <SelectInput
          id="challenge-filter-difficulty"
          name="difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
          aria-label="Filter by difficulty"
          className={styles.filterSelect}
        >
          <option value="all">All difficulties</option>
          {DIFFICULTIES.map((diff) => (
            <option key={diff} value={diff}>
              {diff.charAt(0).toUpperCase() + diff.slice(1)}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          id="challenge-filter-language"
          name="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          aria-label="Filter by language"
          className={styles.filterSelect}
        >
          <option value="all">All languages</option>
          {LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {languageLabel(lang)}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          id="challenge-sort"
          name="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort challenges"
          className={styles.sortSelect}
        >
          <option value="newest">Newest first</option>
          <option value="title">Title A–Z</option>
        </SelectInput>
      </div>

      {challenges.length === 0 ? (
        total === 0 && !debouncedSearch && language === "all" && difficulty === "all" ? (
          <EmptyState title="No challenges yet">
            <p>Create the first challenge and let AI solve it.</p>
            <Button to="/challenges/new">Create the first challenge</Button>
          </EmptyState>
        ) : (
          <EmptyState title="No matching challenges">
            <p>Try a different search term or clear a filter.</p>
          </EmptyState>
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
                    <div className={styles.cardBadges}>
                      <LanguageBadge language={challenge.language} />
                      <Badge variant={DIFFICULTY_VARIANT[challenge.difficulty]}>
                        {challenge.difficulty}
                      </Badge>
                    </div>
                    <span className={styles.date}>{formatRelativeTime(challenge.created_at)}</span>
                  </div>
                  <h2 className={styles.cardTitle}>{challenge.title}</h2>
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