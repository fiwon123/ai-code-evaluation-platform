import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import CodeBlock from "../components/CodeBlock/CodeBlock.tsx";
import ConfirmDialog from "../components/ConfirmDialog/ConfirmDialog.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi, submissionsApi } from "../services/api.ts";
import type { Challenge, ProviderComparisonEntry } from "../types.ts";
import { extractError } from "../utils/errors.ts";
import { extensionForLanguage } from "../utils/language.ts";
import { formatDurationMs, scoreVariant } from "../utils/formatting.ts";
import { useToast } from "../components/Toast/ToastContext.tsx";
import styles from "./ChallengeDetail.module.css";

// Provider list mirrors KEY_REQUIRED_PROVIDERS in
// backend/src/app/schemas/submission.py — keep in sync.
const PROVIDERS = [
  {
    value: "demo",
    name: "Demo",
    description: "Free · no API key",
    requiresKey: false,
  },
  {
    value: "openai",
    name: "OpenAI",
    description: "gpt-4o-mini",
    requiresKey: true,
  },
  {
    value: "anthropic",
    name: "Anthropic",
    description: "claude-3-5-haiku",
    requiresKey: true,
  },
];

const COMPARE_POLL_MS = 1500;

function ChallengeDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [provider, setProvider] = useState("demo");
  const [apiKey, setApiKey] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Provider comparison (leaderboard of the user's runs for this challenge).
  const [comparison, setComparison] = useState<ProviderComparisonEntry[] | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  // provider → run count observed at submit time; cleared once a newer run
  // shows up in the comparison (meaning the new evaluation completed).
  const [runningMap, setRunningMap] = useState<Record<string, number>>({});
  // Optional API keys entered directly in the comparison panel.
  const [runnerKeys, setRunnerKeys] = useState<Record<string, string>>({});

  const selectedProvider = PROVIDERS.find((p) => p.value === provider);
  const requiresKey = selectedProvider?.requiresKey ?? false;
  const runningCount = Object.keys(runningMap).length;

  // Load + poll the comparison while any provider run is in flight.
  useEffect(() => {
    if (!user || !challenge) {
      return;
    }
    const challengeId = challenge.id;
    let cancelled = false;
    let timer: number | undefined;

    async function refresh() {
      try {
        const data = await submissionsApi.comparison(challengeId);
        if (cancelled) {
          return;
        }
        setComparison(data.entries);
        setComparisonError(null);

        // Drop providers whose run count advanced since we submitted.
        const next: Record<string, number> = {};
        for (const provider of Object.keys(runningMap)) {
          const entry = data.entries.find((e) => e.provider === provider);
          if (!entry || entry.runs <= runningMap[provider]) {
            next[provider] = runningMap[provider];
          }
        }
        setRunningMap(next);
        if (Object.keys(next).length > 0 && !cancelled) {
          timer = window.setTimeout(() => void refresh(), COMPARE_POLL_MS);
        }
      } catch (err) {
        if (!cancelled) {
          setComparisonError(extractError(err));
        }
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
    // Poll cadence is driven by runningMap; re-scheduling on every runningMap
    // change could double-poll, so refresh only when its non-empty state flips.
  }, [user, challenge?.id, runningCount > 0]);

  useEffect(() => {
    if (!id) {
      return;
    }
    const challengeId = id;
    let cancelled = false;
    async function load() {
      try {
        const data = await challengesApi.get(challengeId);
        if (!cancelled) {
          setChallenge(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(extractError(err));
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
  }, [id]);

  const isOwner = challenge != null && user?.id === challenge.owner_id;

  async function handleDelete() {
    if (!challenge) {
      return;
    }
    setDeleting(true);
    setConfirmDeleteOpen(false);
    try {
      await challengesApi.remove(challenge.id);
      showToast("Challenge deleted.", "success");
      navigate("/challenges");
    } catch (err) {
      setError(extractError(err));
      setDeleting(false);
    }
  }

  async function handleSubmit() {
    if (!challenge) {
      return;
    }
    // Client-side gate for key-required providers; the API enforces the same
    // rule server-side (422), so this is just for a snappy inline message.
    if (requiresKey && !apiKey.trim()) {
      setSubmitError(
        `Enter your ${selectedProvider?.name ?? "provider"} API key to run this evaluation.`,
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const submission = await submissionsApi.create({
        challenge_id: challenge.id,
        provider,
        ...(requiresKey ? { api_key: apiKey.trim() } : {}),
      });
      navigate(`/submissions/${submission.id}`);
    } catch (err) {
      setSubmitError(extractError(err));
      setSubmitting(false);
    }
  }

  async function runProvider(providerValue: string) {
    if (!challenge) {
      return;
    }
    const providerInfo = PROVIDERS.find((p) => p.value === providerValue);
    const key = runnerKeys[providerValue]?.trim();
    if (providerInfo?.requiresKey && !key) {
      setComparisonError(
        `Enter your ${providerInfo.name} API key to add it to the comparison.`,
      );
      return;
    }
    setComparisonError(null);
    const runsBefore =
      comparison?.find((e) => e.provider === providerValue)?.runs ?? 0;
    try {
      await submissionsApi.create({
        challenge_id: challenge.id,
        provider: providerValue,
        ...(key ? { api_key: key } : {}),
      });
      setRunningMap((prev) => ({ ...prev, [providerValue]: runsBefore }));
      showToast(`${providerInfo?.name ?? providerValue} evaluation started.`, "success");
    } catch (err) {
      setComparisonError(extractError(err));
    }
  }

  async function handleRunAll() {
    setComparisonError(null);
    const toRun = PROVIDERS.filter((p) => !runningMap[p.value]);
    await Promise.all(toRun.map((p) => runProvider(p.value)));
  }

  const bestScore = comparison
    ? Math.max(0, ...comparison.filter((e) => e.runs > 0).map((e) => e.score))
    : 0;

  if (loading) {
    return (
      <div className={styles.page} role="status" aria-label="Loading challenge">
        <Skeleton variant="text" width="40%" height="2rem" />
        <Skeleton variant="rect" width="100%" height="180px" />
        <Skeleton variant="rect" width="100%" height="120px" />
      </div>
    );
  }

  if (error || !challenge) {
    return (
      <div className={styles.notFound}>
        <p role="alert">{error ?? "Challenge not found."}</p>
        <p>
          <Link to="/challenges">Back to challenges</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <p className={styles.back}>
        <Link to="/challenges">← Back to challenges</Link>
      </p>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{challenge.title}</h1>
        </div>
        <Badge variant="neutral">{challenge.language}</Badge>
      </div>

      <div className={styles.layout}>
        <div className={styles.mainCol}>
          <Card>
            <h2 className={styles.sectionTitle}>Description</h2>
            <p className={styles.description}>{challenge.description}</p>
          </Card>

          <Card>
            <h2 className={styles.sectionTitle}>Prompt</h2>
            <CodeBlock
              code={challenge.prompt}
              language="text"
              filename="prompt.txt"
            />
          </Card>

          <Card>
            <h2 className={styles.sectionTitle}>Test code</h2>
            {challenge.test_code ? (
              <CodeBlock
                code={challenge.test_code}
                language={challenge.language ?? "python"}
                filename={`test_solution.${extensionForLanguage(challenge.language ?? "python")}`}
              />
            ) : (
              <p className={styles.muted}>No test code provided.</p>
            )}
          </Card>
        </div>

        <aside className={styles.sideCol}>
          <Card className={styles.evalCard}>
            <h2 className={styles.sectionTitle}>Run evaluation</h2>
            {user ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                <fieldset className={styles.providerGroup}>
                  <legend className={styles.providerLegend}>Provider</legend>
                  {PROVIDERS.map((p) => (
                    <label
                      key={p.value}
                      className={`${styles.providerOption} ${
                        provider === p.value ? styles.providerSelected : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="provider"
                        value={p.value}
                        checked={provider === p.value}
                        onChange={() => {
                          setProvider(p.value);
                          if (!p.requiresKey) {
                            setApiKey("");
                          }
                        }}
                        className={styles.providerRadio}
                      />
                      <span className={styles.providerInfo}>
                        <span className={styles.providerName}>{p.name}</span>
                        <span className={styles.providerDesc}>{p.description}</span>
                      </span>
                      {p.value === "demo" && (
                        <Badge variant="success">Free</Badge>
                      )}
                    </label>
                  ))}
                </fieldset>

                {requiresKey && (
                  <div className={styles.apiKeyGroup}>
                    <label htmlFor="api-key" className={styles.apiKeyLabel}>
                      API key
                    </label>
                    <input
                      id="api-key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={`Your ${selectedProvider?.name ?? "provider"} API key`}
                      autoComplete="off"
                      spellCheck={false}
                      className={styles.apiKeyInput}
                    />
                    <p className={styles.apiKeyHint}>
                      Used only for this single evaluation — never stored or
                      logged.
                    </p>
                  </div>
                )}

                {submitError && (
                  <p role="alert" className={styles.errorText}>
                    {submitError}
                  </p>
                )}
                <Button
                  type="submit"
                  loading={submitting}
                  loadingText="Submitting…"
                  className={styles.submitButton}
                >
                  Generate & evaluate
                </Button>
                <p className={styles.hint}>
                  Tip: the demo provider works instantly with prompts containing
                  keywords like "two sum", "valid parentheses" or "longest
                  common prefix".
                </p>
              </form>
            ) : (
              <div className={styles.loginPrompt}>
                <p className={styles.muted}>
                  Log in to submit this challenge for evaluation.
                </p>
                <Link to="/login">
                  <Button variant="secondary" className={styles.submitButton}>
                    Log in
                  </Button>
                </Link>
              </div>
            )}

            {isOwner && (
              <div className={styles.ownerActions}>
                <Link
                  to={`/challenges/${challenge.id}/edit`}
                  className={styles.editLink}
                >
                  <Button variant="secondary" className={styles.submitButton}>
                    Edit challenge
                  </Button>
                </Link>
                <Button
                  type="button"
                  variant="danger"
                  className={styles.deleteButton}
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={deleting}
                >
                  Delete challenge
                </Button>
              </div>
            )}
          </Card>
        </aside>
      </div>

      {user && (
        <Card className={styles.comparison}>
          <div className={styles.comparisonHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Compare providers</h2>
              <p className={styles.muted}>
                Side-by-side results of every evaluation you&apos;ve run for
                this challenge.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={runningCount > 0}
              loadingText="Running…"
              onClick={() => void handleRunAll()}
            >
              Run all providers
            </Button>
          </div>

          {comparisonError && (
            <p role="alert" className={styles.errorText}>
              {comparisonError}
            </p>
          )}

          <div className={styles.leaderboard}>
            {PROVIDERS.map((p) => {
              const entry = comparison?.find((e) => e.provider === p.value);
                const running = Boolean(runningMap[p.value]);
                const isBest =
                  entry != null && entry.runs > 0 && entry.score === bestScore;
                return (
                  <div
                    key={p.value}
                    className={`${styles.providerCard} ${
                      running ? styles.providerRunning : ""
                    }`}
                  >
                    <div className={styles.providerCardHeader}>
                      <span className={styles.providerCardName}>{p.name}</span>
                      {isBest && <Badge variant="success">Best</Badge>}
                      {running && <Badge variant="primary">Running…</Badge>}
                    </div>
                    <p className={styles.providerCardDesc}>{p.description}</p>

                    {entry ? (
                      <div className={styles.providerCardStats}>
                        <span className={`${styles.providerScore} ${styles[`score${scoreVariant(entry.score)}`]}`}>
                          {entry.score}%
                        </span>
                        <span className={styles.providerStatLabel}>
                          avg over {entry.runs} run{entry.runs === 1 ? "" : "s"}
                        </span>
                        <span className={styles.providerStatDetail}>
                          {entry.passed_tests}/{entry.total_tests} tests ·{" "}
                          {formatDurationMs(entry.duration_ms)}
                        </span>
                      </div>
                    ) : (
                      <p className={styles.muted}>No runs yet.</p>
                    )}

                    {p.requiresKey && (
                      <input
                        type="password"
                        className={styles.runnerKeyInput}
                        placeholder="API key (optional)"
                        aria-label={`${p.name} API key for comparison`}
                        autoComplete="off"
                        spellCheck={false}
                        value={runnerKeys[p.value] ?? ""}
                        onChange={(event) =>
                          setRunnerKeys((prev) => ({
                            ...prev,
                            [p.value]: event.target.value,
                          }))
                        }
                      />
                    )}

                    <Button
                      variant={entry ? "ghost" : "secondary"}
                      size="sm"
                      disabled={running}
                      loading={running}
                      loadingText="Queued…"
                      onClick={() => void runProvider(p.value)}
                    >
                      {entry ? "Re-run" : "Run"}
                    </Button>
                  </div>
                );
              })}
            </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete challenge?"
        variant="danger"
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      >
        <p>
          This will permanently delete{" "}
          <strong>{challenge?.title ?? "this challenge"}</strong> and cannot be
          undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}

export default ChallengeDetail;