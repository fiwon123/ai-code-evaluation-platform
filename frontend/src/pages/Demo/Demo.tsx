import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import CodeBlock from "../../components/CodeBlock/CodeBlock.tsx";
import { SelectInput } from "../../components/Input/Input.tsx";

import { useAuth } from "../../context/AuthContext.tsx";
import { useNow } from "../../hooks/useNow.ts";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion.ts";
import { useSubmissionSocket } from "../../hooks/useSubmissionSocket.ts";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import Reveal from "../../components/Reveal/Reveal.tsx";
import ScoreRing from "../../components/ScoreRing/ScoreRing.tsx";
import { challengesApi, submissionsApi } from "../../services/api.ts";
import type { Challenge, Submission } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
import { formatElapsed } from "../../utils/formatting.ts";
import {
  extensionForLanguage,
  LANGUAGES,
  languageLabel,
  languageMeta,
  runnerForLanguage,
} from "../../utils/language.ts";
import LanguageBadge from "../../components/LanguageBadge/LanguageBadge.tsx";
import styles from "./Demo.module.css";

const STEPS = [
  {
    icon: "📝",
    title: "Create a challenge",
    text: "Define an LLM prompt and a test suite in the language you want evaluated. Example: 'Write a function that returns the sum of a list.' with a few assertion tests.",
  },
  {
    icon: "🤖",
    title: "Submit for evaluation",
    text: "Pick a provider — OpenAI, Anthropic, Gemini, Groq, a local Ollama server, or the free demo model — and submit. The platform records your submission and kicks off generation.",
  },
  {
    icon: "⚙️",
    title: "Code is generated & tested",
    text: "The LLM writes a solution, which is written to an isolated temp workspace and executed against the challenge's test suite with a strict timeout.",
  },
  {
    icon: "📊",
    title: "Review the report",
    text: "See the generated code, passed/total test counts, a score, and the full execution logs — all in a single evaluation report.",
  },
];

const KEYWORD_CHIPS = ["two sum", "valid parentheses", "longest common prefix"];

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60000; // ~60s cap before we give up

/** How long each walkthrough step holds the rail before it advances. */
const STEP_CYCLE_MS = 2600;

/** The no-language-filtered case. Not a language: nothing is a filter state. */
const ALL_LANGUAGES = "all";

/**
 * A language's option text, symbol first.
 *
 * The symbol is the identity a closed dropdown cannot show for itself, and it
 * can only live in the text: a native `<select>` paints its own colour over the
 * selected option and its popup is rendered by the OS. The colour goes on the
 * control as a stripe instead, via `--lang-accent`.
 */
function languageOptionLabel(language: string): string {
  return languageMeta(language).label;
}

/**
 * A challenge's option text: title first, because that is what is being chosen,
 * with its language symbol behind it as the identity cue.
 */
function challengeOptionLabel(challenge: Challenge): string {
  return challenge.title;
}


function Demo() {
  const { user, initializing } = useAuth();
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("");
  const { liveSubmission, state: socketState } = useSubmissionSocket(
    submissionId ?? undefined,
  );

  // The walkthrough rail. Starts on the first step and only advances for a
  // reader who has not asked for reduced motion — see the effect below.
  const [activeStep, setActiveStep] = useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  /**
   * The challenges the language filter admits.
   *
   * Only the languages that actually have a challenge behind them are offered,
   * so the control never presents a choice that would empty the page. `LANGUAGES`
   * is the full 20-language catalog and most of it has no demo challenge, so
   * listing all of it would make "All languages" the only useful option.
   */
  const filterableLanguages = useMemo(() => {
    const langs = new Set<string>();
    for (const c of challenges) {
      if (c.language) langs.add(c.language);
    }
    return Array.from(langs).sort((a, b) =>
      languageLabel(a).localeCompare(languageLabel(b)),
    );
  }, [challenges]);

  const visibleChallenges = useMemo(
    () => (language ? challenges.filter((c) => c.language === language) : challenges),
    [challenges, language],
  );

  /**
   * The challenge whose preview is on screen.
   *
   * A run's result outranks the picker: once something has been submitted, the
   * report must keep describing what was actually run, even if the reader has
   * since changed the filter. Only the picker is resolved through
   * `visibleChallenges`, and only because of the one-frame window below.
   */
  const resultChallenge = challenges.find((c) => c.id === result?.challenge_id);

  /**
   * The challenge the picker and the preview both describe.
   *
   * Narrowing the language can leave `selectedId` pointing at a challenge that
   * is no longer listed. Reading straight from state would then show a blank
   * `<select>` with a `value` matching none of its options, keep the preview on
   * the hidden challenge, and let the run button submit something the reader
   * cannot see selected.
   *
   * So the *rendered* selection is derived, not read: it falls back to the first
   * visible challenge in the same render that narrows the list. `selectedId` is
   * then reconciled to match in an effect, so a remount does not re-open on a
   * challenge the filter excludes.
   *
   * Deriving it is a one-frame improvement, not a testable one: `fireEvent`
   * wraps in `act`, which flushes the effect before any assertion, so a unit
   * test cannot see the intermediate frame either way (mutation-checked —
   * resolving from the unfiltered list passes the same suite). It is here
   * because a real browser does paint that frame, and it costs a fallback rather
   * than a second source of truth.
   */
  const selectedChallenge =
    resultChallenge ??
    visibleChallenges.find((c) => c.id === selectedId) ??
    visibleChallenges[0];
  const resultLanguage = selectedChallenge?.language ?? "python";
  const previewRunner = runnerForLanguage(resultLanguage);

  useEffect(() => {
    if (visibleChallenges.length === 0) {
      return;
    }
    if (!visibleChallenges.some((c) => c.id === selectedId)) {
      setSelectedId(visibleChallenges[0].id);
    }
  }, [selectedId, visibleChallenges]);

  /**
   * Advance the walkthrough rail, for readers who want motion.
   *
   * Gated on `prefers-reduced-motion` rather than neutralised in CSS, because
   * this is a JS timer: a CSS opt-out cannot stop a `setInterval` from moving
   * the highlight, and a highlight that keeps moving is the motion. Under
   * reduced motion the rail holds step one, which is also the honest resting
   * state — nothing has been run, so the first step is where a reader is.
   */
  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveStep((step) => (step + 1) % STEPS.length);
    }, STEP_CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion]);

  // Guests get the sign-in wall instead of the runner. `initializing` bars
  // the wall during the brief token check so it doesn't flash before the
  // session is known.
  const isGuestWallVisible = () => !initializing && !user;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await challengesApi.list({ page: 1, page_size: 50 });
        const items = data.items;
        if (!cancelled && items.length > 0) {
          setChallenges(items);
          // Start unfiltered - show all challenges
          setLanguage("");
          setSelectedId(items[0].id);
        }
      } catch {
        // Demo still renders; the runner will explain when challenges load fails.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function pickKeyword(keyword: string) {
    const match = challenges.find((c) =>
      `${c.title} ${c.description} ${c.prompt}`
        .toLowerCase()
        .includes(keyword.toLowerCase()),
    );
    if (match) {
      setSelectedId(match.id);
      // A chip is a shortcut to one specific challenge, so it has to be able to
      // reach it. Without this, clicking "two sum" while the Go filter is on
      // selects a Python challenge the reader cannot see, and the correction
      // effect below then immediately drags the selection to some unrelated Go
      // challenge — the chip would appear to do nothing. Widening to "all" is
      // the only outcome that matches what was clicked.
      if (match.language !== language) {
        setLanguage(match.language);
      }
    }
  }

  async function handleRun() {
    // Guests never reach this button (see the sign-in wall below), but a
    // session can expire while this page stays open — send a returning user
    // to login with the demo as the post-login destination, not a dead end.
    if (!user) {
      navigate("/login", { state: { from: "/demo" } });
      return;
    }
    if (!selectedId) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setSubmissionId(null);
    try {
      const submission = await submissionsApi.create({
        challenge_id: selectedId,
        provider: "demo",
      });
      setSubmissionId(submission.id);
    } catch (err) {
      setError(extractError(err));
      setRunning(false);
    }
  }

  // Fast path: the WebSocket streams status changes as they happen, and a
  // terminal update now carries the finished record, so the result is rendered
  // straight off the socket. The REST call is the fallback for the cases the
  // socket cannot cover: a reconnect that missed the terminal event, an older
  // server that only sends status, or a run started before the socket opened.
  useEffect(() => {
    if (!submissionId || !running) {
      return;
    }
    if (
      liveSubmission &&
      (liveSubmission.status === "completed" || liveSubmission.status === "failed")
    ) {
      const done = (full: Submission) => {
        setResult(full);
        setRunning(false);
        setSubmissionId(null);
      };
      if (liveSubmission.evaluation_result) {
        done(liveSubmission);
        return;
      }
      submissionsApi.get(liveSubmission.id).then(done).catch((err) => {
        setError(extractError(err));
        setRunning(false);
        setSubmissionId(null);
      });
    }
  }, [liveSubmission, running, submissionId]);

  // Fallback: poll while the socket is not open (e.g. no Redis, no auth token).
  useEffect(() => {
    if (!submissionId || !running || socketState === "open") {
      return;
    }
    const targetId: string = submissionId;
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      if (cancelled) {
        return;
      }
      try {
        const data = await submissionsApi.get(targetId);
        if (cancelled) {
          return;
        }
        if (data.status === "completed" || data.status === "failed") {
          setResult(data);
          setRunning(false);
          setSubmissionId(null);
          return;
        }
      } catch {
        // Transient failure — keep polling until the timeout fires.
      }
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [running, socketState, submissionId]);

  // Global safety net so the demo cannot run forever.
  useEffect(() => {
    if (!submissionId || !running) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setError(
        "The evaluation didn't finish in time — the server may be busy. " +
          "Please try again in a minute.",
      );
      setRunning(false);
      setSubmissionId(null);
    }, POLL_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [running, submissionId]);

  const inProgress = running && result === null;
  const now = useNow(inProgress);
  const phaseLabel =
    liveSubmission?.phase === "testing" ? "Running tests…" : "Generating code…";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {/* Decoration only. `aria-hidden` because it carries no information the
            heading does not, and `pointer-events` is off in CSS so it cannot
            take a click meant for the page. */}
        <div className={styles.ambientBackdrop} aria-hidden="true">
          <span className={styles.blobPrimary} />
          <span className={styles.blobAccent} />
        </div>
        <span className="eyebrow">Demo</span>
        <PageTitle size="lg" className={styles.title}>See how it works</PageTitle>
        <p className={styles.subtitle}>
          A guided walkthrough of the evaluation pipeline, plus a live demo you
          can try right now.
        </p>
      </header>

      <div className={styles.walkthrough}>
        {STEPS.map((step, index) => (
          <Reveal key={step.title} delayMs={index * 90}>
            <div
              className={`${styles.step} ${index === activeStep ? styles.stepActive : ""}`}
            >
              <div className={styles.stepIcon} aria-hidden="true">{step.icon}</div>
              <div>
                <h2 className={styles.stepTitle}>{step.title}</h2>
                <p className={styles.stepText}>{step.text}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <hr className="dividerRule" />

      <section className={styles.liveSection}>
        <Badge variant="primary">Live demo</Badge>
        <h2 className={styles.liveTitle}>Try it live</h2>
        <p className={styles.liveText}>
          Pick a challenge and run it through the <strong>demo provider</strong>{" "}
          — no API keys needed. The platform generates and evaluates a solution
          in seconds.
        </p>

        <div className={styles.runner}>
          {challenges.length > 0 ? (
            <>
            {isGuestWallVisible() ? (
              <div className={styles.guestWall}>
                <h3 className={styles.guestWallTitle}>
                  Sign in to run the live demo
                </h3>
                <p className={styles.guestWallText}>
                  Running an evaluation creates a submission on your account —
                  the demo provider is free and needs no API keys once
                  you’re in.
                </p>
                <div className={styles.guestWallActions}>
                  <Button to="/login" state={{ from: "/demo" }}>
                    Sign in
                  </Button>
                  <Button to="/register" variant="secondary">
                    Create account
                  </Button>
                </div>
              </div>
            ) : (
              <>
              <div className={styles.chips}>
                <span className={styles.chipsLabel}>Try a prompt:</span>
                {KEYWORD_CHIPS.map((keyword) => (
                  <button
                    key={keyword}
                    type="button"
                    className={styles.chip}
                    onClick={() => pickKeyword(keyword)}
                  >
                    {keyword}
                  </button>
                ))}
              </div>

              <div className={styles.filterRow}>
                {/* The language filter. `--lang-accent` is always set, including
                    `transparent` for "all", so whether the stripe is visible is
                    decided by the stylesheet alone rather than by whether React
                    happened to omit a `style` attribute. The accent is
                    decoration, so it is not announced — the option text already
                    names the language. */}
                <span
                  className={styles.languageFilter}
                  style={
                    {
                      "--lang-accent": languageMeta(language).color,
                    } as React.CSSProperties
                  }
                >
                  <SelectInput
                    id="demo-language"
                    name="language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    aria-label="Filter by language"
                    className={styles.languageSelect}
                  >
  
                    {filterableLanguages.map((lang) => (
                      <option key={lang} value={lang}>
                        {languageOptionLabel(lang)}
                      </option>
                    ))}
                  </SelectInput>
                </span>

              </div>

              <div className={styles.runnerRow}>
                <span
                  className={styles.challengeFilter}
                  style={
                    {
                      "--lang-accent": selectedChallenge
                        ? languageMeta(selectedChallenge.language).color
                        : "transparent",
                    } as React.CSSProperties
                  }
                >
                  <SelectInput
                    id="demo-challenge"
                    name="challenge"
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    aria-label="Demo challenge"
                    className={styles.challengeSelect}
                  >
                    {visibleChallenges.map((c) => (
                      <option key={c.id} value={c.id}>
                        {challengeOptionLabel(c)}
                      </option>
                    ))}
                  </SelectInput>
                </span>
                <Button
                  onClick={() => void handleRun()}
                  disabled={inProgress || initializing || !selectedId}
                >
                  {inProgress ? "Generating…" : "Generate & evaluate"}
                </Button>
              </div>
            </>
            )}

              {/* Feedback sits directly under the run controls, above the
                  preview, so a run's outcome is visible without scrolling. */}
              {error && (
                <p role="alert" className={styles.error}>
                  {error}
                </p>
              )}

              {inProgress && (
                <Card className={styles.resultCard}>
                  {liveSubmission?.started_at && (
                    <p className={styles.phaseText} role="status">
                      {phaseLabel}{" "}
                      · {formatElapsed(liveSubmission.started_at, now)} elapsed
                    </p>
                  )}
                  <p className={styles.progressText}>
                    ⏳ Generating code and running tests… usually takes 10–30
                    seconds. This page updates automatically.
                  </p>
                </Card>
              )}

              {result &&
                (result.status === "completed" ||
                  result.status === "failed") && (
                <Card className={styles.resultCard}>
                  <div className={styles.resultHeader}>
                    <h3 className={styles.resultTitle}>Demo result</h3>
                    <Badge
                      variant={
                        result.status === "completed" ? "success" : "danger"
                      }
                    >
                      {result.status}
                    </Badge>
                  </div>
                  {result.evaluation_result && (
                    <div className={styles.resultStats}>
                      <div className={styles.resultStat}>
                        <ScoreRing
                          value={result.evaluation_result.score}
                          label="Score"
                        />
                      </div>
                      <div className={styles.resultStat}>
                        <span className={styles.resultStatValue}>
                          {result.evaluation_result.passed_tests}/
                          {result.evaluation_result.total_tests}
                        </span>
                        <span className={styles.resultStatLabel}>
                          Tests passed
                        </span>
                      </div>
                    </div>
                  )}

                  {result.evaluation_result?.test_results?.length ? (
                    <ul
                      className={styles.testBreakdown}
                      aria-label="Per-test breakdown"
                    >
                      {result.evaluation_result.test_results.map((t, i) => (
                        <li
                          key={i}
                          className={
                            t.passed ? styles.testRowPass : styles.testRowFail
                          }
                        >
                          <span aria-hidden="true">
                            {t.passed ? "✓" : "✗"}
                          </span>
                          <span>{t.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {result.code && (
                    <div className={styles.resultCode}>
                      <p className={styles.resultCodeLabel}>Generated code</p>
                      <CodeBlock
                        code={result.code}
                        language={resultLanguage}
                        filename={`solution.${extensionForLanguage(resultLanguage)}`}
                      />
                    </div>
                  )}
                  <p className={styles.resultMeta}>
                    Submitted at{" "}
                    {new Date(result.created_at).toLocaleString()} · duration:{" "}
                    <code>
                      {formatElapsed(
                        result.created_at,
                        Date.parse(result.updated_at),
                      )}
                    </code>{" "}
                    · provider: <code>demo</code> · runs with{" "}
                    <code>{runnerForLanguage(resultLanguage)?.runner}</code>
                  </p>
                  <Button
                    to={`/submissions/${result.id}`}
                    variant="secondary"
                    size="sm"
                  >
                    View full report
                  </Button>
                </Card>
              )}

              {selectedChallenge && (
                <div className={styles.preview}>
                  <div className={styles.previewHeader}>
                    <h3 className={styles.previewTitle}>What will run</h3>
                    <LanguageBadge language={selectedChallenge.language} showLabel showSymbol />
                  </div>
                  {selectedChallenge.description && (
                    <p className={styles.previewDescription}>
                      {selectedChallenge.description}
                    </p>
                  )}
                  {/* Prompt and test suite side by side once there is room:
                      a program and its tests read as a pair, where two stacked
                      full-width panels read as a wall. */}
                  <div className={styles.previewCodeGrid}>
                  {selectedChallenge.prompt && (
                    <div className={styles.previewSection}>
                      <p className={styles.previewLabel}>Prompt</p>
                      <div className={styles.previewCode}>
                        <CodeBlock
                          code={selectedChallenge.prompt}
                          language="text"
                          filename="prompt.txt"
                        />
                      </div>
                    </div>
                  )}
                  <div className={styles.previewSection}>
                    <p className={styles.previewLabel}>Test suite</p>
                    {selectedChallenge.test_code ? (
                      <div className={styles.previewCode}>
                        <CodeBlock
                          code={selectedChallenge.test_code}
                          language={selectedChallenge.language ?? "python"}
                          filename={
                            previewRunner?.testFilename ??
                            `test_solution.${extensionForLanguage(
                              selectedChallenge.language ?? "python",
                            )}`
                          }
                        />
                      </div>
                    ) : (
                      <p className={styles.previewEmpty}>
                        No test code provided for this challenge.
                      </p>
                    )}
                  </div>
                  </div>
                  {previewRunner && (
                    <p className={styles.previewMeta}>
                      Runs with <code>{previewRunner.runner}</code> — executes{" "}
                      <code>{previewRunner.testFilename}</code> against your
                      solution in{" "}
                      <code>{previewRunner.solutionFilename}</code>.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className={styles.runnerEmpty}>
              No challenges available yet —{" "}
              <Link to="/challenges/new">create one</Link> to try the live demo.
            </p>
          )}

        </div>
      </section>

      <div className={styles.liveActions}>
        <Button to="/register" size="lg">Create account</Button>
        <Button
          to="/challenges"
          variant="secondary"
          size="lg"
        >
          Browse challenges
        </Button>
        <Button
          to="/challenges/new"
          variant="ghost"
          size="lg"
        >
          Create a challenge
        </Button>
      </div>
      <p className={styles.liveHint}>
        Tip: challenges whose prompt contains a keyword like{" "}
        <strong>"two sum"</strong>, <strong>"valid parentheses"</strong> or{" "}
        <strong>"longest common prefix"</strong> produce a matching solution
        instantly — the demo provider needs no API keys.
      </p>
    </div>
  );
}

export default Demo;