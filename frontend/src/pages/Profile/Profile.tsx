import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
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
import Tooltip from "../../components/Tooltip/Tooltip.tsx";
import { useToast } from "../../components/Toast/ToastContext.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useNow } from "../../hooks/useNow.ts";
import { useShareLink } from "../../hooks/useShareLink.ts";
import { authApi, challengesApi, submissionsApi } from "../../services/api.ts";
import { DIFFICULTY_VARIANT, difficultyLabel } from "../../utils/difficulty.ts";
import { extractError, extractFieldErrors } from "../../utils/errors.ts";
import { languageMeta } from "../../utils/language.ts";
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

/**
 * Whether a numeric field has no value at all — `null` *and* `undefined`.
 *
 * The API sends `null` for "no value", but a field that is simply absent — an
 * older cached response, a partial payload — says the same thing, and
 * `undefined !== null` is true, so a plain `!== null` check formats `undefined`
 * and printed "NaNs" on a card. Shared by the three cards below rather than
 * redeclared per card, because the bug it prevents is invisible in one card and
 * a copy in each is a copy that can drift.
 *
 * A type predicate, so `!blank(x)` narrows `x` for the formatters that take a
 * `number`. A plain `boolean` return leaves `number | null | undefined` in the
 * false branch and every caller has to cast.
 */
function blank(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined;
}

/** A percentage or the em dash for "not measured" (#347, #348). */
function percent(value: number | null | undefined): string {
  return blank(value) ? "—" : `${value}%`;
}

/**
 * A relative time that also states the date it is relative to.
 *
 * "2 months ago" is unverifiable on its own — it is true of a great many
 * instants, it does not survive a paste into a bug report, and a screen reader
 * reads the words rather than the number. `<time dateTime>` carries the exact
 * value alongside the human phrasing, which is what the element is for.
 *
 * It also makes the claim testable: asserting that the footer says "Last
 * evaluated" says nothing about *which* date, and a card that printed the
 * created date under that label passes such a test forever.
 */
function RelativeTime({ iso, prefix }: { iso: string; prefix?: string }) {
  return (
    <time className={styles.metaDate} dateTime={iso}>
      {prefix ? `${prefix} ` : ""}
      {formatRelativeTime(iso)}
    </time>
  );
}


/**
 * One "evaluations by challenge" card (issue #347).
 *
 * The old card was a title, a language badge, an average chip, a run line and a
 * date, all in default styling, and only the title was clickable. The redesign
 * asks for the language to be the card's identity, the three stats to read
 * side by side, the whole card to navigate, and a tooltip wherever text is
 * truncated.
 *
 * Three things are deliberate:
 *
 * - **The language is the accent, not a badge on top of a card.** The accent
 *   comes from `languageMeta(language).color` — the same single source the
 *   language badge, the filter bar and the code header use — so a reader learns
 *   "blue means Python" once and reads it in every place it appears.
 * - **The whole card is the link, via a stretched `::after` on the title link.**
 *   Making the card itself an `<a>` would give a screen reader an accessible
 *   name made of the title, the description and all four stats, which is a
 *   sentence nobody wants read aloud. The title stays the link, and its
 *   `::after` covers the card, so the click target is the whole thing and the
 *   accessible name is still just the challenge's name.
 * - **The description is truncated by CSS, not by JavaScript.** Cutting the
 *   string in the component would throw away the tail for everyone, including
 *   screen readers and anyone widening the window. The full text stays in the
 *   DOM behind a one-line clamp, and the tooltip carries it for anyone who
 *   wants it without hovering.
 */
function EvaluationCard({ item }: { item: ChallengeStatsItem }) {
  const language = languageMeta(item.language);
  const variant = item.avg_score !== null ? scoreVariant(item.avg_score) : null;
  const style = { "--card-accent": language.color } as CSSProperties;

  const duration = blank(item.last_duration_ms)
    ? "—"
    : formatDurationMs(item.last_duration_ms);

  // The description is the only truncated text on the card, so it is the only
  // thing that needs a bubble — and the card, not the description, is what
  // triggers it. The stretched `::after` over the title is a transparent box
  // covering this whole surface, so the pointer never reaches anything inside
  // the card: a tooltip hung on the description would open for a keyboard user
  // and never for a mouse. Hovering or focusing anywhere on the card opens it
  // instead, and Escape dismisses it until the pointer leaves (WCAG 1.4.13:
  // dismissible, hoverable, persistent).
  const [descVisible, setDescVisible] = useState(false);
  const [descDismissed, setDescDismissed] = useState(false);
  // Re-entering the card must NOT clear `descDismissed`. It did, and it made
  // Escape look broken in a real browser: closing the bubble changes which
  // element is under the pointer, the browser fires another mouseover at the
  // card, and the card reopened the bubble it had just dismissed. WCAG 1.4.13
  // wants the opposite — dismissed until the pointer leaves.
  const showDescription = () => setDescVisible(true);
  const leaveDescription = () => {
    setDescVisible(false);
    setDescDismissed(false);
  };
  const focusDescription = () => {
    setDescVisible(true);
    setDescDismissed(false);
  };

  return (
    <Card padding="compact" className={styles.statsItem} style={style}>
      {/* The hover and focus handlers live on an inner div rather than on
          `Card` itself: widening a shared primitive's props to carry this one
          card's behaviour is worse than one wrapper element. It spans the card's
          content, which is also the right area to react to — the padding is not
          text anyone is trying to read. */}
      <div
        className={styles.statsBody}
        onMouseEnter={showDescription}
        onMouseLeave={leaveDescription}
        onFocus={(event) => {
          // `:focus-visible` and not simply "was focused": a mouse press focuses
          // the title too, and popping a tooltip open under someone's cursor as
          // they click cancels the click — mousedown and mouseup then land on
          // different elements and the browser never fires a click at all, so the
          // card would silently stop working for the mouse.
          if ((event.target as HTMLElement).matches(":focus-visible")) {
            focusDescription();
          }
        }}
        onBlur={(event) => {
          // Only when focus has left the card, so tabbing between the title and
          // anything inside does not flicker the bubble closed.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            leaveDescription();
          }
        }}
      >
      <div className={styles.statsHead}>
        <LanguageBadge language={item.language} className={styles.statsBadge} />
        <Link
          to={`/challenges/${item.challenge_id}`}
          className={styles.statsTitle}
        >
          {item.challenge_title}
        </Link>
      </div>

      {item.description && (
        // Clipped to two lines by CSS, so the full text is still in the DOM and
        // still announced; the tooltip is for reading it, not for hearing it.
        <Tooltip
          label={item.description}
          placement="bottom"
          // Explanatory text, not actions: the bubble must not swallow the click
          // meant for the card underneath it.
          passThrough
          open={descVisible && !descDismissed}
          onOpenChange={(next) => {
            if (next) {
              showDescription();
            } else {
              // Escape, or the pointer leaving the description: keep it closed
              // until the pointer leaves the card and comes back.
              setDescDismissed(true);
            }
          }}
        >
          <p className={styles.statsDescription}>{item.description}</p>
        </Tooltip>
      )}

      <dl className={styles.listStatRow}>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Score</dt>
          <dd
            className={`${styles.statValue} ${variant ? styles[`chip${variant}`] : ""}`}
            // The em dash is "no value here", which is not 0% — a claim about
            // quality rather than an absence of one. Say which, for the same
            // reason the duration below does.
            {...(blank(item.avg_score)
              ? { "aria-label": "no completed runs yet" }
              : {})}
          >
            {percent(item.avg_score)}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Best</dt>
          {/* The old card printed "best 90%" in its meta line. A redesign that
              drops a field because it no longer fits the new layout is still a
              data loss, so Best is a stat of its own. */}
          <dd className={styles.statValue}>{percent(item.best_score)}</dd>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Runs</dt>
          {/* Completed of total, not the total alone: the old card said
              "3 runs" beside "1 failed" and left the reader to subtract, and an
              average over three completed runs means something different from an
              average over four attempted ones. */}
          <dd className={styles.statValue}>
            {item.completed_runs}/{item.total_runs}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Last run</dt>
          <dd
            className={styles.statValue}
            // "—" is the em dash for "not measured", which has to be said out
            // loud: on its own it reads as a missing value rather than a run that
            // never produced a result.
            {...(blank(item.last_duration_ms)
              ? { "aria-label": "last run: not measured" }
              : {})}
          >
            {duration}
          </dd>
        </div>
      </dl>

      <p className={styles.metaDate}>
        Last executed {formatRelativeTime(item.last_run_at)}
        {item.failed_runs > 0 && (
          <>
            {" · "}
            <span className={styles.failedRuns}>
              {item.failed_runs} failed
            </span>
          </>
        )}
      </p>
      </div>
    </Card>
  );
}

/**
 * One "my challenges" row (issue #348).
 *
 * The issue asks for language, difficulty, recency, run count, best score and
 * status. Five of those six exist in the data. The sixth — a status — does not:
 * `Challenge` has no status field, and none of the API responses carry one. So
 * rather than invent an "active"/"stale" label from a threshold of my own, this
 * card reports the two facts that are actually knowable — when the challenge was
 * created, and whether it has ever been evaluated — and the second of those is
 * the same signal a reader would call "stale" anyway.
 *
 * The run numbers come from `challengeStats`, which is a rollup over *all* of
 * the user's submissions rather than the visible page, so "best score" here
 * really is the best score and not the best score on page 3.
 *
 * Structure is deliberately identical to `SubmissionListCard` below — badges
 * and one prominent value, then a text line, then two named stats, then a meta
 * footer. See the alignment note on `.listCard` in the CSS module.
 */
function ChallengeListCard({
  challenge,
  stat,
}: {
  challenge: Challenge;
  stat: ChallengeStatsItem | undefined;
}) {
  const neverEvaluated = !stat || stat.total_runs === 0;
  const variant = stat?.best_score != null ? scoreVariant(stat.best_score) : null;

  return (
    <Card padding="compact" className={styles.listCard}>
      <div className={styles.listHead}>
        <span className={styles.listBadges}>
          <LanguageBadge language={challenge.language} />
          {/* `DIFFICULTY_VARIANT`/`difficultyLabel` rather than a second copy of
              the easy/medium/hard vocabulary: #346 moved those pills onto the
              `-strong` tokens for contrast, and a local mapping here would be
              one more place to forget that. Unknown values fall back to a
              neutral pill and their own label, never to a wrong colour. */}
          <Badge variant={DIFFICULTY_VARIANT[challenge.difficulty] ?? "neutral"}>
            {difficultyLabel(challenge.difficulty)}
          </Badge>
        </span>
        <span
          className={`${styles.listValue} ${variant ? styles[`chip${variant}`] : ""}`}
          {...(blank(stat?.best_score)
            ? { "aria-label": "no completed runs yet" }
            : {})}
        >
          {percent(stat?.best_score)}
        </span>
      </div>

      <Link
        to={`/challenges/${challenge.id}`}
        className={styles.listTitle}
      >
        {challenge.title}
      </Link>

      <dl className={styles.listStats}>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Runs</dt>
          {/* Completed of total, matching the #347 card: an average over three
              completed runs is a different claim from one over four attempts. */}
          <dd className={styles.statValue}>
            {stat ? `${stat.completed_runs}/${stat.total_runs}` : "—"}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Failed</dt>
          <dd
            className={styles.statValue}
            {...(blank(stat?.failed_runs) || (stat?.failed_runs ?? 0) === 0
              ? { "aria-label": "no failed runs" }
              : {})}
          >
            {blank(stat?.failed_runs) ? "—" : `${stat?.failed_runs}`}
          </dd>
        </div>
      </dl>

      <div className={styles.listFoot}>
        {neverEvaluated ? (
          <RelativeTime iso={challenge.created_at} prefix="Created" />
        ) : (
          <RelativeTime iso={stat.last_run_at} prefix="Last evaluated" />
        )}
        {neverEvaluated && (
          <span className={styles.neutralTag}>Not evaluated yet</span>
        )}
      </div>
    </Card>
  );
}

/**
 * The longer text a submission's test summary stands in for.
 *
 * `logs_summary` is the runner's own digest of which tests failed and why, and it
 * exists precisely so a row can explain itself without opening the report. It is
 * empty on rows written before summaries existed, hence the counts first: they
 * are always there, and the digest is the bonus.
 */
function runDetail(submission: Submission): string | null {
  const result = submission.evaluation_result;
  if (!result) {
    return null;
  }
  const counts = `${result.passed_tests} of ${result.total_tests} tests passed`;
  const summary = result.logs_summary?.trim();
  return summary ? `${counts}. ${summary}` : counts;
}

/**
 * One "recent submissions" row (issue #348).
 *
 * Everything the old row showed is still here — status pill, score, duration,
 * relative time (or a live "waiting" count for an in-flight run), the delayed
 * and stuck escalations, and the share controls — because a redesign that drops
 * a field because it stopped fitting is data loss, not design. On top of that:
 * the language, a real pass/fail test count, and the provider and model that
 * produced the run.
 *
 * The tooltip is on the test count and nowhere else, because that is the only
 * number here whose full story is longer than the number. It is not on the card,
 * because the card already has a link and three buttons and a bubble over those
 * is the #347 bug all over again — `Tooltip` takes a `tabIndex` on its own
 * wrapper when the trigger cannot hold focus, so wrapping a `<dd>` still leaves
 * this reachable from the keyboard in one tab stop.
 */
function SubmissionListCard({
  submission,
  now,
}: {
  submission: Submission;
  /**
   * The page's shared clock (`useNow`), not `Date.now()`.
   *
   * `useNow` ticks once a second and only while something is in flight, which is
   * what keeps "waiting 1m 20s" alive without re-rendering the page for terminal
   * rows. Calling `Date.now()` inside the card instead is a frozen clock: the
   * value is sampled once per render, and the card only re-renders when the page
   * does — so if nothing else ticks, the elapsed time never moves.
   */
  now: number;
}) {
  const inProgress =
    submission.status === "pending" || submission.status === "processing";
  const delayed = inProgress && isDelayed(submission.created_at, now);
  const stuck =
    submission.status === "pending" && isSeverelyDelayed(submission.created_at, now);
  const result = submission.evaluation_result;
  const durationMs = result?.metrics.duration_ms;
  const variant = submission.score != null ? scoreVariant(submission.score) : null;
  const detail = runDetail(submission);

  // What ran the code, when the submission does not say. `provider`/`model` are
  // nullable and a row written before the model column existed has no model, so
  // this degrades to the provider. Only a row with neither says so out loud,
  // rather than leaving the second line blank.
  const runner = [submission.provider, submission.model]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  return (
    <Card padding="compact" className={styles.listCard}>
      {/* Row 1 and row 2 are the link, as before: the row was clickable and
          nothing about this issue says it should stop being. Rows 3 and 4 sit
          outside it — a `<button>` may not live inside an `<a>`, and the share
          controls and the tooltip's tab stop both have to be real controls. */}
      <Link
        to={`/submissions/${submission.id}`}
        className={styles.listLink}
        // The link wraps the badges, the score and the runner, so its name from
        // content is that concatenation — "completed Python 100% Two Sum demo ·
        // demo" — which names no challenge in a list of links. Say what the row
        // *is* instead; the numbers stay in the card for browse mode.
        aria-label={`${submission.challenge_title} — ${submission.status}`}
      >
        <span className={styles.listHead}>
          <span className={styles.listBadges}>
            <Badge variant={statusVariant(submission.status)}>
              {submission.status}
            </Badge>
            <LanguageBadge language={submission.language} />
            {(stuck || delayed) && (
              <span className={stuck ? styles.stuckTag : styles.delayedTag}>
                {stuck ? "stuck" : "delayed"}
              </span>
            )}
          </span>
          <span
            className={`${styles.listValue} ${variant ? styles[`chip${variant}`] : ""}`}
            {...(blank(submission.score)
              ? { "aria-label": "no score yet" }
              : {})}
          >
            {percent(submission.score)}
          </span>
        </span>
        {/* Row 2 is the challenge's name (#361). It used to be `provider ·
            model`, falling back to the challenge id, so a card could not be
            named by the thing it was a run *of* — and an in-flight row showed
            "waiting 4s" for every challenge in the list. Two children, not one
            string, because `.listBody` clamps at two lines: the heading takes
            one and the runner takes the second the block had already reserved,
            so the card keeps its height. Each child is a `block` in the CSS for
            the same reason — Chromium reports the parent's `-webkit-box` as
            `flow-root`, which is not "the children are blocks", and as inline
            spans they ran together on one line. */}
        <span className={styles.listBody}>
          <span className={styles.listHeading}>{submission.challenge_title}</span>
          <span className={styles.listRunner}>
            {inProgress
              ? `waiting ${formatElapsed(submission.created_at, now)}`
              : runner || "no runner recorded"}
          </span>
        </span>
      </Link>

      <dl className={styles.listStats}>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Tests</dt>
          <dd className={styles.statValue}>
            {detail ? (
              <Tooltip label={detail} placement="top" passThrough>
                <span className={styles.statMore}>{result!.passed_tests}/{result!.total_tests}</span>
              </Tooltip>
            ) : (
              <span aria-label="no test results yet">—</span>
            )}
          </dd>
        </div>
        <div className={styles.stat}>
          <dt className={styles.statLabel}>Duration</dt>
          <dd
            className={styles.statValue}
            {...(typeof durationMs !== "number"
              ? { "aria-label": "not measured" }
              : {})}
          >
            {typeof durationMs === "number" ? formatDurationMs(durationMs) : "—"}
          </dd>
        </div>
      </dl>

      <div className={styles.listFoot}>
        <RelativeTime iso={submission.created_at} />
        {submission.status === "completed" && result && (
          <span className={styles.listShare}>
            <SubmissionShareActions
              submissionId={submission.id}
              initialToken={result.share_token ?? null}
            />
          </span>
        )}
      </div>
    </Card>
  );
}

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

  // Per-challenge rollup keyed by id, for the "My challenges" cards (#348). It is
  // a separate fetch that is deliberately non-fatal above, so this map is
  // legitimately empty whenever `/api/submissions/stats` failed — which is why
  // every card treats a missing entry as "not evaluated" rather than as an
  // error, and why no card renders a zero where a rollup would have been.
  const statsByChallenge = useMemo(
    () => new Map(challengeStats.map((item) => [item.challenge_id, item])),
    [challengeStats],
  );

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
          <PageTitle size="md" className={styles.name}>{user.username}</PageTitle>
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
          label="Challenges"
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
          <ul className={styles.statsGrid}>
            {challengeStats.map((item) => (
              // No class on the `<li>`: it is the grid *item*, and the `Card`
              // inside it is the grid *cell's content*. Styling both put the
              // accent bar and the language wash on each, so both rendered
              // twice — which is exactly what the first version of this did.
              <li key={item.challenge_id}>
                <EvaluationCard item={item} />
              </li>
            ))}
          </ul>
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
                  <ChallengeListCard
                    key={challenge.id}
                    challenge={challenge}
                    stat={statsByChallenge.get(challenge.id)}
                  />
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
                {submissions.map((submission) => (
                  <SubmissionListCard
                    key={submission.id}
                    submission={submission}
                    now={now}
                  />
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