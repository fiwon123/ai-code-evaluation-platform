import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import EmptyState from "../components/EmptyState/EmptyState.tsx";
import CodeBlock from "../components/CodeBlock/CodeBlock.tsx";
import ConfirmDialog from "../components/ConfirmDialog/ConfirmDialog.tsx";
import LanguageBadge from "../components/LanguageBadge/LanguageBadge.tsx";
import PageTitle from "../components/PageTitle/PageTitle.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi, modelsApi, submissionsApi } from "../services/api.ts";
import { COMPARE_POLL_MS, nextPollDelay } from "../constants/polling.ts";
import { useNow } from "../hooks/useNow.ts";
import type {
  Challenge,
  ChallengeDifficulty,
  ModelInfo,
  ProviderComparisonEntry,
} from "../types.ts";
import { extractError } from "../utils/errors.ts";
import { extensionForLanguage } from "../utils/language.ts";
import {
  formatDurationMs,
  formatElapsedMs,
  scoreVariant,
  SEVERE_DELAY_AFTER_MS,
  STALE_AFTER_MS,
} from "../utils/formatting.ts";
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
  {
    value: "gemini",
    name: "Gemini",
    description: "gemini-2.0-flash",
    requiresKey: true,
  },
  {
    value: "groq",
    name: "Groq",
    description: "openai/gpt-oss-20b",
    requiresKey: true,
  },
  {
    value: "ollama",
    name: "Ollama (local)",
    description: "qwen2.5-coder · no API key",
    requiresKey: false,
  },
];

const DIFFICULTY_VARIANT: Record<
  ChallengeDifficulty,
  "success" | "warning" | "danger"
> = {
  easy: "success",
  medium: "warning",
  hard: "danger",
};

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
  // LLM model catalog (GET /api/models) plus the user's pick. An empty
  // selection means "provider default".
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");

  // Provider comparison (leaderboard of the user's runs for this challenge).
  const [comparison, setComparison] = useState<ProviderComparisonEntry[] | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  // provider → run count observed at submit time; cleared once a newer run
  // shows up in the comparison (meaning the new evaluation completed).
  const [runningMap, setRunningMap] = useState<Record<string, number>>({});
  // provider → wall-clock ms when its run was submitted (ref: read from the
  // poll loop without re-running effects or capturing stale closures).
  const runningSinceRef = useRef<Record<string, number>>({});
  // The poll effect keys on `runningCount > 0` so a map change cannot
  // double-poll, which leaves its closure holding a *snapshot* of runningMap
  // from whenever it last ran. A provider started while the loop is already
  // alive would be invisible to it: the loop would drop that provider, compute
  // an empty in-flight set, stop polling and clear the "running" indicator
  // while the evaluation was still going (#258). Both write sites below update
  // this ref, so the loop always reads the live set.
  const runningMapRef = useRef<Record<string, number>>({});
  // Providers whose run never produced a result and exceeded the severe-delay
  // window — they are dropped from runningMap so the poll terminates and the
  // card shows a "no result" state instead of spinning forever.
  const [gaveUpMap, setGaveUpMap] = useState<Record<string, boolean>>({});
  // Optional API keys entered directly in the comparison panel.
  const [runnerKeys, setRunnerKeys] = useState<Record<string, string>>({});

  const selectedProvider = PROVIDERS.find((p) => p.value === provider);
  const requiresKey = selectedProvider?.requiresKey ?? false;
  const runningCount = Object.keys(runningMap).length;
  // Catalog entries for the currently selected provider, default first — plus
  // the provider's default id for the "Provider default" placeholder.
  const providerModels =
    models?.filter((m) => m.provider === provider) ?? null;
  const providerDefaultModel =
    providerModels?.find((m) => m.is_default)?.id ?? null;

  // Load + poll the comparison while any provider run is in flight.
  useEffect(() => {
    if (!user || !challenge) {
      return;
    }
    const challengeId = challenge.id;
    let cancelled = false;
    let timer: number | undefined;
    // Current interval for this loop. Grows while nothing completes and resets
    // the moment a run does — see nextPollDelay (#257).
    let delayMs = COMPARE_POLL_MS;

    function schedule() {
      timer = window.setTimeout(() => void refresh(), delayMs);
      delayMs = nextPollDelay(delayMs);
    }

    async function refresh() {
      try {
        const data = await submissionsApi.comparison(challengeId);
        if (cancelled) {
          return;
        }
        setComparison(data.entries);
        setComparisonError(null);

        // Drop providers whose run count advanced since we submitted. Any
        // provider still in flight beyond the severe-delay window has almost
        // certainly failed (the worker auto-fails stale rows server-side) —
        // mark it as such and stop polling it so the leaderboard can't poll
        // forever on a silently lost evaluation.
        const pastSevereDelay = Date.now() - SEVERE_DELAY_AFTER_MS;
        const inFlight = runningMapRef.current;
        const next: Record<string, number> = {};
        let madeProgress = false;
        for (const provider of Object.keys(inFlight)) {
          const entry = data.entries.find((e) => e.provider === provider);
          if (!entry || entry.runs <= inFlight[provider]) {
            const sinceMs = runningSinceRef.current[provider];
            if (sinceMs !== undefined && sinceMs < pastSevereDelay) {
              setGaveUpMap((prev) => ({ ...prev, [provider]: true }));
              delete runningSinceRef.current[provider];
              continue;
            }
            next[provider] = inFlight[provider];
          } else {
            delete runningSinceRef.current[provider];
            madeProgress = true;
          }
        }
        // A run landing is the only news worth an immediate re-check, so it is
        // the only thing that restores the fast cadence. Growing on elapsed
        // time alone would make the last provider of a slow round wait out the
        // backoff it no longer needs.
        if (madeProgress) {
          delayMs = COMPARE_POLL_MS;
        }
        runningMapRef.current = next;
        setRunningMap(next);
        if (Object.keys(next).length > 0 && !cancelled) {
          schedule();
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        setComparisonError(extractError(err));
        // Keep polling. A blip used to end the loop for good: the give-up
        // check below only runs on a *successful* poll, so one 500 stranded the
        // card on "Running…" with no result state and no recovery until a
        // reload (#257). The error stays on screen until a poll succeeds.
        if (Object.keys(runningMapRef.current).length > 0) {
          schedule();
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

  // Tick elapsed time while any provider run is in flight so the leaderboard
  // can show a live "running for 42s" counter + stuck warnings.
  const nowMs = useNow(runningCount > 0);

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

  // Load the model catalog once (public endpoint). Failures degrade
  // gracefully — the selector is simply hidden and the provider default is
  // used.
  useEffect(() => {
    let cancelled = false;
    modelsApi
      .list()
      .then((data) => {
        if (!cancelled) {
          setModels(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setModelsFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
        ...(selectedModel ? { model: selectedModel } : {}),
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
      runningMapRef.current = { ...runningMapRef.current, [providerValue]: runsBefore };
      runningSinceRef.current[providerValue] = Date.now();
      setGaveUpMap((prev) => {
        if (!prev[providerValue]) {
          return prev;
        }
        const next = { ...prev };
        delete next[providerValue];
        return next;
      });
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
          <PageTitle className={styles.title}>{challenge.title}</PageTitle>
        </div>
        <div className={styles.headerBadges}>
          <LanguageBadge language={challenge.language} />
          <Badge variant={DIFFICULTY_VARIANT[challenge.difficulty]}>
            {challenge.difficulty}
          </Badge>
        </div>
      </div>
      <hr className="dividerRule" />

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
                          // Model ids are provider-scoped — reset any pick to
                          // the new provider's default.
                          setSelectedModel("");
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

                {providerModels && providerModels.length > 0 && (
                  <div className={styles.apiKeyGroup}>
                    <label htmlFor="model" className={styles.apiKeyLabel}>
                      Model
                    </label>
                    <select
                      id="model"
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                      className={styles.apiKeyInput}
                    >
                      <option value="">
                        Provider default
                        {providerDefaultModel ? ` — ${providerDefaultModel}` : ""}
                      </option>
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label} — {m.id}
                          {m.is_default ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                    <p className={styles.apiKeyHint}>
                      Leave on default to use the provider's standard model.
                    </p>
                  </div>
                )}
                {modelsFailed && (
                  <p className={styles.apiKeyHint}>
                    Model list unavailable — using the provider default.
                  </p>
                )}

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
                <Button
                  to="/login"
                  variant="secondary"
                  className={styles.submitButton}
                >
                  Log in
                </Button>
              </div>
            )}

            {isOwner && (
              <div className={styles.ownerActions}>
                <Button
                  to={`/challenges/${challenge.id}/edit`}
                  variant="secondary"
                  className={`${styles.editLink} ${styles.submitButton}`}
                >
                  Edit challenge
                </Button>
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
                const gaveUp = Boolean(gaveUpMap[p.value]);
                const isBest =
                  entry != null && entry.runs > 0 && entry.score === bestScore;
                const runningSince = runningSinceRef.current[p.value];
                const runningElapsed =
                  running && runningSince !== undefined
                    ? formatElapsedMs(nowMs - runningSince)
                    : null;
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
                      {gaveUp && <Badge variant="danger">No result</Badge>}
                    </div>
                    <p className={styles.providerCardDesc}>{p.description}</p>

                    {gaveUp ? (
                      <p className={styles.noResultText}>
                        Took too long — no result was produced. Re-run to try
                        again.
                      </p>
                    ) : entry ? (
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
                      <EmptyState
                        as="p"
                        title="No runs yet."
                        className={styles.emptySlot}
                      />
                    )}

                    {running && runningElapsed && (
                      <p className={styles.runningMeta}>
                        {runningElapsed}
                        {runningSince !== undefined &&
                          nowMs - runningSince > STALE_AFTER_MS &&
                          " · taking longer than expected"}
                      </p>
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