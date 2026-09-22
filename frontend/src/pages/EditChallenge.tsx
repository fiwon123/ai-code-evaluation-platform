import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styles from "./EditChallenge.module.css";
import { challengesApi } from "../services/api.ts";
import { useAuth } from "../context/AuthContext.tsx";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import {
  Field,
  TextInput,
  SelectInput,
  TextAreaInput,
  useFieldId,
} from "../components/Input/Input.tsx";
import { extractError } from "../utils/errors.ts";
import { LANGUAGES, languageGuide } from "../utils/language.ts";

export default function EditChallenge() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [testCode, setTestCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const guide = languageGuide(language);
  const titleId = useFieldId("title");
  const languageId = useFieldId("language");
  const descriptionId = useFieldId("description");
  const promptId = useFieldId("prompt");
  const testCodeId = useFieldId("test-code");

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
        setTitle(challenge.title);
        setDescription(challenge.description ?? "");
        setPrompt(challenge.prompt);
        setTestCode(challenge.test_code ?? "");
        setLanguage(challenge.language ?? "python");
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
        title,
        description,
        prompt,
        test_code: testCode,
        language,
      });
      navigate(`/challenges/${id}`);
    } catch (err) {
      setError(extractError(err));
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className={styles.status}>Loading challenge…</p>;
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
        <h1>Edit challenge</h1>
        <p className={styles.subtitle}>
          Update the task description, the prompt your LLM will see, or the
          tests used to grade the generated solution.
        </p>
      </header>

      <Card className={styles.card}>
        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
          <div className={styles.row}>
            <Field id={titleId} label="Title">
              <TextInput
                id={titleId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Two Sum"
                required
                maxLength={120}
              />
            </Field>

            <Field id={languageId} label="Language">
              <SelectInput
                id={languageId}
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang.charAt(0).toUpperCase() + lang.slice(1)}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>

          <Field id={descriptionId} label="Description">
            <TextAreaInput
              id={descriptionId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Given an array of integers, return the indices of the two numbers that add up to a target."
              rows={3}
            />
          </Field>

          <Field id={promptId} label="Prompt for the LLM">
            <TextAreaInput
              id={promptId}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={guide.prompt}
              rows={5}
            />
          </Field>

          <Field id={testCodeId} label={guide.testLabel}>
            <TextAreaInput
              id={testCodeId}
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              placeholder={guide.testCode}
              rows={6}
            />
          </Field>

          {error && (
            <p className={styles.errorBanner} role="alert">
              {error}
            </p>
          )}

          <div className={styles.actions}>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(`/challenges/${id}`)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}