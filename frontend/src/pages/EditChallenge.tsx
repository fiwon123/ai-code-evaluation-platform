import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styles from "./EditChallenge.module.css";
import { challengesApi } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import AmbientBackdrop from "../components/AmbientBackdrop/AmbientBackdrop.tsx";
import Card from "../components/Card/Card.tsx";
import PageTitle from "../components/PageTitle/PageTitle.tsx";
import Skeleton from "../components/Skeleton/Skeleton.tsx";
import {
  ChallengeFormActions,
  ChallengeFormFields,
  type ChallengeFormValue,
} from "../components/ChallengeForm/ChallengeFormFields.tsx";
import { extractError } from "../utils/errors.ts";
import { languageGuide } from "../utils/language.ts";
import { useToast } from "../components/Toast/ToastContext.tsx";
import type { ChallengeDifficulty } from "../types.ts";

export default function EditChallenge() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // The same shape `CreateChallenge` holds, because the same component renders
  // both. Edit is the only one of the two that starts empty and is then
  // filled from the API, so it is also the only one that has to override the
  // whole value at once.
  const [value, setValue] = useState<ChallengeFormValue>({
    title: "",
    description: "",
    prompt: "",
    testCode: "",
    language: "python",
    difficulty: "medium",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const guide = languageGuide(value.language);

  function onChange<K extends keyof ChallengeFormValue>(
    key: K,
    next: ChallengeFormValue[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  useEffect(() => {
    if (!id) {
      return;
    }
    const challengeId = id;
    let cancelled = false;
    async function load() {
      try {
        const challenge = await challengesApi.get(challengeId);
        if (cancelled) {
          return;
        }
        setValue({
          title: challenge.title,
          description: challenge.description ?? "",
          prompt: challenge.prompt,
          testCode: challenge.test_code ?? "",
          language: challenge.language ?? "python",
          difficulty: (challenge.difficulty ?? "medium") as ChallengeDifficulty,
        });
        setIsOwner(challenge.owner_id === user?.id);
      } catch (err) {
          if (!cancelled) {
            setLoadError(extractError(err));
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
  }, [id, user?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await challengesApi.update(id, {
        title: value.title,
        description: value.description,
        prompt: value.prompt,
        test_code: value.testCode,
        language: value.language,
        difficulty: value.difficulty,
      });
      showToast("Challenge updated successfully.", "success");
      navigate(`/challenges/${id}`);
    } catch (err) {
      setError(extractError(err));
    } finally {
      // Create had this and Edit did not: on success the button stayed in its
      // loading state for as long as the component stayed mounted, which is
      // any navigation that is slow or blocked.
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.page} role="status" aria-label="Loading challenge">
        <Skeleton variant="text" width="50%" height="2rem" />
        <Skeleton variant="rect" width="100%" height="360px" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.notFound}>
        <p role="alert">{loadError}</p>
        <p>
          <Link to="/challenges">Back to challenges</Link>
        </p>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className={styles.notFound}>
        <p role="alert">You can only edit challenges you created.</p>
        <p>
          <Link to="/challenges">Back to challenges</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <AmbientBackdrop />
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link to="/challenges" className={styles.crumbLink}>
            Challenges
          </Link>
          <span aria-hidden="true">/</span>
          <Link to={`/challenges/${id}`} className={styles.crumbLink}>
            Challenge
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Edit</span>
        </nav>
        <PageTitle className={styles.title}>Edit challenge</PageTitle>
        <p className={styles.subtitle}>
          Update the task description, the prompt your LLM will see, or the
          tests used to grade the generated solution.
        </p>
      </header>

      <Card className={styles.card}>
        <form onSubmit={(e) => void handleSubmit(e)}>
          {/* No example loader: every field is already filled, so a button
              that overwrites three of them is a way to lose work. */}
          <ChallengeFormFields value={value} onChange={onChange} guide={guide} />
          <ChallengeFormActions
            value={value}
            submitting={submitting}
            submitLabel="Save changes"
            loadingText="Saving…"
            onCancel={() => navigate(`/challenges/${id}`)}
            error={error}
          />
        </form>
      </Card>
    </div>
  );
}
