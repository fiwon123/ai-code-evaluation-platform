import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Badge from "../../components/Badge/Badge.tsx";
import Button from "../../components/Button/Button.tsx";
import Card from "../../components/Card/Card.tsx";
import CodeBlock from "../../components/CodeBlock/CodeBlock.tsx";
import { SelectInput } from "../../components/Input/Input.tsx";
import { useAuth } from "../../context/AuthContext.tsx";
import { challengesApi, submissionsApi, ApiError } from "../../services/api.ts";
import type { Challenge, Submission } from "../../types.ts";
import styles from "./Demo.module.css";

const STEPS = [
  {
    icon: "📝",
    title: "Create a challenge",
    text: "Define an LLM prompt and a pytest test suite. Example: 'Write a function that returns the sum of a list.' with a few assertion tests.",
  },
  {
    icon: "🤖",
    title: "Submit for evaluation",
    text: "Pick a provider — OpenAI, Anthropic, or the free demo model — and submit. The platform records your submission and kicks off generation.",
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

const KEYWORD_CHIPS = ["two sum", "fizzbuzz", "fibonacci", "palindrome"];

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40; // ~60s cap before we give up

function Demo() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const submission = await submissionsApi.create({
        challenge_id: selectedId,
        provider: "demo",
      });
      const finished = await poll(submission.id);
      setResult(finished);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "Failed to run the demo.",
      );
    } finally {
      setRunning(false);
    }
  }

  async function poll(submissionId: string): Promise<Submission> {
    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
      const data = await submissionsApi.get(submissionId);
      if (data.status === "completed" || data.status === "failed") {
        return data;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(
      "Evaluation timed out after about 60 seconds — the Celery worker may " +
        "not be running. Check that the worker is up and resubmit.",
    );
  }

  const inProgress = running && result === null;

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>See how it works</h1>
      <p className={styles.pageSubtitle}>
        A guided walkthrough of the evaluation pipeline, plus a live demo you
        can try right now.
      </p>

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
                      {c.title} ({c.language})
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

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          {inProgress && (
            <Card className={styles.resultCard}>
              <p className={styles.progressText}>
                ⏳ Generating code and running tests… this page updates
                automatically.
              </p>
            </Card>
          )}

          {result &&
            (result.status === "completed" || result.status === "failed") && (
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
                    <span className={styles.resultStatValue}>
                      {result.evaluation_result.score}%
                    </span>
                    <span className={styles.resultStatLabel}>Score</span>
                  </div>
                  <div className={styles.resultStat}>
                    <span className={styles.resultStatValue}>
                      {result.evaluation_result.passed_tests}/
                      {result.evaluation_result.total_tests}
                    </span>
                    <span className={styles.resultStatLabel}>Tests passed</span>
                  </div>
                </div>
              )}
              {result.code && (
                <div className={styles.resultCode}>
                  <p className={styles.resultCodeLabel}>Generated code</p>
                  <CodeBlock code={result.code} language="python" />
                </div>
              )}
              <p className={styles.resultMeta}>
                Submitted at{" "}
                {new Date(result.created_at).toLocaleString()} · provider:{" "}
                <code>demo</code>
              </p>
              <Link to={`/submissions/${result.id}`}>
                <Button variant="secondary" size="sm">
                  View full report
                </Button>
              </Link>
            </Card>
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
        <strong>"two sum"</strong> or <strong>"fizzbuzz"</strong> produce a
        matching solution instantly — the demo provider needs no API keys.
      </p>
    </div>
  );
}

export default Demo;