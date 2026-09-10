import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Badge from "../components/Badge/Badge.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import { Field, SelectInput, useFieldId } from "../components/Input/Input.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { challengesApi, submissionsApi, ApiError } from "../services/api.ts";
import type { Challenge } from "../types.ts";
import styles from "./ChallengeDetail.module.css";

const PROVIDERS = [
  { value: "demo", label: "Demo (free, no API key)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
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
  const providerFieldId = useFieldId("provider");

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
          setError(
            err instanceof ApiError ? err.detail : "Failed to load challenge.",
          );
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
      setError(
        err instanceof ApiError ? err.detail : "Failed to delete challenge.",
      );
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
      setSubmitError(
        err instanceof ApiError ? err.detail : "Failed to submit evaluation.",
      );
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p>Loading challenge…</p>;
  }

  if (error || !challenge) {
    return (
      <div>
        <p role="alert">{error ?? "Challenge not found."}</p>
        <p>
          <Link to="/challenges">Back to challenges</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <p>
        <Link to="/challenges">← Back to challenges</Link>
      </p>

      <div className={styles.header}>
        <h1 className={styles.title}>{challenge.title}</h1>
        <Badge variant="neutral">{challenge.language}</Badge>
      </div>

      <div className={styles.sections}>
        <Card>
          <h2 className={styles.sectionTitle}>Description</h2>
          <p>{challenge.description}</p>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Prompt</h2>
          <pre className={styles.pre}>{challenge.prompt}</pre>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Test code</h2>
          <pre className={styles.pre}>{challenge.test_code || "(none)"}</pre>
        </Card>

        <Card>
          <h2 className={styles.sectionTitle}>Run evaluation</h2>
          {user ? (
            <form
              className={styles.submitForm}
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit();
              }}
            >
              <Field label="Provider" id={providerFieldId}>
                <SelectInput
                  id={providerFieldId}
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              {submitError && (
                <p role="alert" className={styles.errorText}>
                  {submitError}
                </p>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Generate & evaluate"}
              </Button>
              <p className={styles.hint}>
                Tip: the demo provider works instantly with prompts containing
                keywords like "two sum" or "fizzbuzz".
              </p>
            </form>
          ) : (
            <p>
              <Link to="/login">Log in</Link> to submit this challenge for
              evaluation.
            </p>
          )}
        </Card>

        {isOwner && (
          <button type="button" onClick={() => void handleDelete()} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete challenge"}
          </button>
        )}
      </div>
    </div>
  );
}

export default ChallengeDetail;