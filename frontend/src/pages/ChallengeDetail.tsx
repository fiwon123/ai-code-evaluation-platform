import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import CodeBlock from "../components/CodeBlock/CodeBlock.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi, submissionsApi } from "../services/api.ts";
import type { Challenge } from "../types.ts";
import { extractError } from "../utils/errors.ts";
import { extensionForLanguage } from "../utils/language.ts";
import styles from "./ChallengeDetail.module.css";

const PROVIDERS = [
  {
    value: "demo",
    name: "Demo",
    description: "Free · no API key",
  },
  {
    value: "openai",
    name: "OpenAI",
    description: "gpt-4o-mini",
  },
  {
    value: "anthropic",
    name: "Anthropic",
    description: "claude-3-5-haiku",
  },
];

function ChallengeDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [provider, setProvider] = useState("demo");
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    if (!challenge || !confirm(`Delete challenge "${challenge.title}"?`)) {
      return;
    }
    setDeleting(true);
    try {
      await challengesApi.remove(challenge.id);
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
    setSubmitting(true);
    setSubmitError(null);
    try {
      const submission = await submissionsApi.create({
        challenge_id: challenge.id,
        provider,
      });
      navigate(`/submissions/${submission.id}`);
    } catch (err) {
      setSubmitError(extractError(err));
      setSubmitting(false);
    }
  }

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
                        onChange={() => setProvider(p.value)}
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
                  keywords like "two sum" or "fizzbuzz".
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
                  onClick={() => void handleDelete()}
                  loading={deleting}
                  loadingText="Deleting…"
                >
                  Delete challenge
                </Button>
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

export default ChallengeDetail;