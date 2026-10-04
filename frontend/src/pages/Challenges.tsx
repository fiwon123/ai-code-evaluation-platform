import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import BadgeSelect from "../components/BadgeSelect/BadgeSelect.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import EmptyState from "../components/EmptyState/EmptyState.tsx";
import LanguageBadge from "../components/LanguageBadge/LanguageBadge.tsx";
import { SelectInput, TextInput } from "../components/Input/Input.tsx";
import PageHeader from "../components/PageHeader/PageHeader.tsx";
import Pagination from "../components/Pagination/Pagination.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi } from "../services/api.ts";
import type { BadgeVariant } from "../components/Badge/Badge.tsx";
import type { Challenge, ChallengeDifficulty } from "../types.ts";
import { DIFFICULTIES, DIFFICULTY_VARIANT, difficultyLabel } from "../utils/difficulty.ts";
import { extractError } from "../utils/errors.ts";
import { formatRelativeTime } from "../utils/formatting.ts";
import { LANGUAGES, languageMeta } from "../utils/language.ts";
import styles from "./Challenges.module.css";

const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The difficulty filter's options, including the "no filter" case.
 *
 * `DIFFICULTIES` is the shared vocabulary and supplies the colour, so this
 * cannot drift from the badges on the cards or the chips in the form. "All" is
 * added here rather than to `DIFFICULTIES` because it is a *filter* state and
 * not a difficulty: a challenge is never "all", and putting it in the shared
 * list would mean every consumer had to filter it back out.
 */
const DIFFICULTY_FILTERS = [
  { value: "all", label: "All", variant: "neutral" },
  ...DIFFICULTIES,
] as const satisfies readonly {
  value: string;
  label: string;
  variant: BadgeVariant;
}[];

/**
 * A language's option text, symbol first.
 *
 * The symbol is the identity cue a plain dropdown cannot have — and it can only
 * be in the text at all, because a native `<select>` will not colour its own
 * options. Measured rather than assumed: with `style="color"` on an `<option>`,
 * `getComputedStyle` reports the colour, and the *closed control* still paints
 * its own `color`/`background-color` on the selected option's text, because
 * `select` colours its own text and inherits nothing from the option. The popup
 * is rendered by the OS and is not in the DOM to be styled. So the symbol goes
 * in the text, and the colour goes on the control via `--lang-accent` below.
 */
function languageFilterLabel(language: string): string {
  return languageMeta(language).label;
}

/** Sort options, each with a leading symbol for the same reason. */
const SORT_OPTIONS = [
  { value: "newest", label: "Newest first", symbol: "\u2193" },
  { value: "title", label: "Title A\u2013Z", symbol: "\u2191" },
] as const;

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
      <PageHeader
        title="Challenges"
        subtitle="Submit a challenge and let an LLM generate and evaluate a solution."
        actions={<Button to="/challenges/new">+ New challenge</Button>}
      />

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
        {/* Coloured difficulty options need something a `<select>` cannot be.
            Measured: an `<option>`'s own `color` is ignored by the closed
            control, and the popup is OS-rendered. So this is a radio group —
            real radios, one tab stop, arrow keys, and the same `DIFFICULTIES`
            colour the badges use. `legend` is the group's accessible name and
            replaces the `aria-label` the select had. */}
        <BadgeSelect
          legend="Filter by difficulty"
          name="difficulty"
          value={difficulty}
          onChange={setDifficulty}
          appearance="plain"
          className={styles.difficultyFilter}
          legendClassName={styles.difficultyLegend}
          options={DIFFICULTY_FILTERS.map((option) => ({
            value: option.value,
            children: <Badge variant={option.variant}>{option.label}</Badge>,
          }))}
        />
        {/* Stays a native `<select>`: 29 languages is far too many to lay out
            inline, and the platform listbox is the right control for that many.
            The identity it *can* carry is a symbol in the option text and a
            colour on the control. The accent is decoration, so it is not
            announced — the option text already names the language. */}
        <span
          className={styles.languageFilter}
          // Always set, including `transparent` for "all": the stripe's
          // visibility is then decided by the stylesheet alone, not by whether
          // React happened to omit a `style` attribute.
          style={
            {
              "--lang-accent":
                language === "all" ? "transparent" : languageMeta(language).color,
            } as React.CSSProperties
          }
        >
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
                {languageFilterLabel(lang)}
              </option>
            ))}
          </SelectInput>
        </span>
        <SelectInput
          id="challenge-sort"
          name="sort"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort challenges"
          className={styles.sortSelect}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.symbol} {option.label}
            </option>
          ))}
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
                        {difficultyLabel(challenge.difficulty)}
                      </Badge>
                    </div>
                  </div>
                  <h2 className={styles.cardTitle}>{challenge.title}</h2>
                  <p className={`${styles.cardDesc} lineClamp2`}>
                    {challenge.description}
                  </p>
                  {user?.id === challenge.owner_id && (
                    <span className={styles.ownerBadge}>You own this</span>
                  )}
                  <div className={styles.cardFooter}>
                    <span className={styles.date}>
                      {formatRelativeTime(challenge.created_at)}
                    </span>
                    <span className={styles.cardArrow}>View challenge →</span>
                  </div>
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