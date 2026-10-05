import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./CreateChallenge.module.css";
import { challengesApi } from "../services/api.ts";
import Card from "../components/Card/Card.tsx";
import {
  ChallengeFormActions,
  ChallengeFormFields,
  type ChallengeFormValue,
} from "../components/ChallengeForm/ChallengeFormFields.tsx";
import { extractError } from "../utils/errors.ts";
import { examplesForLanguage, languageGuide } from "../utils/language.ts";
import PageHeader from "../components/PageHeader/PageHeader.tsx";
import { useToast } from "../components/Toast/ToastContext.tsx";

export default function CreateChallenge() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // One object rather than six `useState` calls, because the field layout is
  // shared with Edit and is handed that object whole — six separate setters
  // would mean six chances for the two pages to order their props differently.
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
  const examples = examplesForLanguage(value.language);

  function onChange<K extends keyof ChallengeFormValue>(
    key: K,
    next: ChallengeFormValue[K],
  ) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  function applyExample(index: number) {
    const example = examples[index];
    if (!example) {
      return;
    }
    setValue((current) => ({
      ...current,
      title: example.title,
      prompt: example.prompt,
      testCode: example.testCode,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const challenge = await challengesApi.create({
        title: value.title,
        description: value.description,
        prompt: value.prompt,
        test_code: value.testCode,
        language: value.language,
        difficulty: value.difficulty,
      });
      showToast("Challenge created successfully.", "success");
      navigate(`/challenges/${challenge.id}`);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      {/* The 760px measure belongs to the form below it, so it stays on this
          page: the header is shared, its measure is not. */}
      <PageHeader
        className={styles.narrow}
        animate
        breadcrumb={[{ label: "Challenges", to: "/challenges" }, { label: "New challenge" }]}
        title="Create a challenge"
        subtitle="Define a coding task, the prompt your LLM will see, and the tests used to grade the generated solution."
      />

      <Card className={styles.card}>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <ChallengeFormFields
            value={value}
            onChange={onChange}
            guide={guide}
            examples={examples}
            onApplyExample={applyExample}
          />
          <ChallengeFormActions
            value={value}
            submitting={submitting}
            submitLabel="Create challenge"
            loadingText="Creating…"
            onCancel={() => navigate("/challenges")}
            error={error}
          />
        </form>
      </Card>
    </div>
  );
}
