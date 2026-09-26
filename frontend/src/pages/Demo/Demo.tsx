import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import CodeBlock from "../../components/CodeBlock/CodeBlock.tsx";
import { SelectInput } from "../../components/Input/Input.tsx";
import LanguageBadge from "../../components/LanguageBadge/LanguageBadge.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { useNow } from "../../hooks/useNow.ts";
import { useSubmissionSocket } from "../../hooks/useSubmissionSocket.ts";
import PageTitle from "../../components/PageTitle/PageTitle.tsx";
import ScoreRing from "../../components/ScoreRing/ScoreRing.tsx";
import { challengesApi, submissionsApi } from "../../services/api.ts";
import type { Challenge, Submission } from "../../types.ts";
import { extractError } from "../../utils/errors.ts";
import { formatElapsed } from "../../utils/formatting.ts";
import {
  extensionForLanguage,
  languageLabel,
  runnerForLanguage,
} from "../../utils/language.ts";
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
    text: "Pick a provider — OpenAI, Anthropic, Gemini, a local Ollama server, or the free demo model — and submit. The platform records your submission and kicks off generation.",
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

function Demo() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const { liveSubmission, state: socketState } = useSubmissionSocket(
    submissionId ?? undefined,
  );

  // The run result belongs to the challenge selected when it was submitted.
  const selectedChallenge = challenges.find(
    (c) => c.id === (result?.challenge_id ?? selectedId),
  );
  const resultLanguage = selectedChallenge?.language ?? "python";
  const previewRunner = runnerForLanguage(resultLanguage);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await challengesApi.list({ page: 1, page_size: 50 });
        const items = data.items;
        if (!cancelled && items.length > 0) {
          setChallenges(items);
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
    }
  }

  async function handleRun() {
    if (!user) {
      navigate("/register");
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
        <span className="eyebrow">Demo</span>
        <PageTitle size="lg" className={styles.pageTitle}>See how it works</PageTitle>
        <p className={styles.pageSubtitle}>
          A guided walkthrough of the evaluation pipeline, plus a live demo you
          can try right now.
        </p>
      </header>

      <div className={styles.walkthrough}>
        {STEPS.map((step) => (
          <div className={styles.step} key={step.title}>
            <div className={styles.stepIcon}>{step.icon}</div>
            <div>
              <h2 className={styles.stepTitle}>{step.title}</h2>
              <p className={styles.stepText}>{step.text}</p>
            </div>
          </div>
        ))}
      </div>

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

              <div className={styles.runnerRow}>
                <SelectInput
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  aria-label="Demo challenge"
                  className={styles.challengeSelect}
                >
                  {challenges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({languageLabel(c.language)})
                    </option>
                  ))}
                </SelectInput>
                <Button
                  onClick={() => void handleRun()}
                  disabled={inProgress}
                >
                  {inProgress ? "Generating…" : "Generate & evaluate"}
                </Button>
              </div>

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
                  <Link to={`/submissions/${result.id}`}>
                    <Button variant="secondary" size="sm">
                      View full report
                    </Button>
                  </Link>
                </Card>
              )}

              {selectedChallenge && (
                <div className={styles.preview}>
                  <div className={styles.previewHeader}>
                    <h3 className={styles.previewTitle}>What will run</h3>
                    <LanguageBadge language={selectedChallenge.language} />
                  </div>
                  {selectedChallenge.description && (
                    <p className={styles.previewDescription}>
                      {selectedChallenge.description}
                    </p>
                  )}
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

          {!user && challenges.length > 0 && (
            <p className={styles.loginNote}>
              You'll need a free account —{" "}
              <Link to="/register">sign up</Link> or{" "}
              <Link to="/login">log in</Link> to run the demo.
            </p>
          )}
        </div>
      </section>

      <div className={styles.liveActions}>
        <Link to="/register">
          <Button size="lg">Create account</Button>
        </Link>
        <Link to="/challenges">
          <Button variant="secondary" size="lg">
            Browse challenges
          </Button>
        </Link>
        <Link to="/challenges/new">
          <Button variant="ghost" size="lg">
            Create a challenge
          </Button>
        </Link>
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