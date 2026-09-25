import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import styles from "./CreateChallenge.module.css";
import { challengesApi } from "../services/api.ts";
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
import {
  LANGUAGES,
  examplesForLanguage,
  languageGuide,
  languageLabel,
} from "../utils/language.ts";
import { useToast } from "../components/Toast/ToastContext.tsx";
import type { ChallengeDifficulty } from "../types.ts";

export default function CreateChallenge() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [testCode, setTestCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [difficulty, setDifficulty] = useState<ChallengeDifficulty>("medium");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const guide = languageGuide(language);
  const examples = examplesForLanguage(language);
  const titleId = useFieldId("title");
  const languageId = useFieldId("language");
  const difficultyId = useFieldId("difficulty");
  const descriptionId = useFieldId("description");
  const promptId = useFieldId("prompt");
  const testCodeId = useFieldId("test-code");
  const exampleId = useFieldId("example");

  function applyExample(index: number) {
    const example = examples[index];
    if (!example) {
      return;
    }
    setTitle(example.title);
    setPrompt(example.prompt);
    setTestCode(example.testCode);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const challenge = await challengesApi.create({
        title,
        description,
        prompt,
        test_code: testCode,
        language,
        difficulty,
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
      <header className={styles.header}>
        <nav className={styles.crumbs} aria-label="Breadcrumb">
          <Link to="/challenges" className={styles.crumbLink}>
            Challenges
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">New challenge</span>
        </nav>
        <h1>Create a challenge</h1>
          <p className={styles.subtitle}>
            Define a coding task, the prompt your LLM will see, and the tests
            used to grade the generated solution.
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
                    {languageLabel(lang)}
                  </option>
                ))}
              </SelectInput>
            </Field>

            <Field id={difficultyId} label="Difficulty">
              <SelectInput
                id={difficultyId}
                value={difficulty}
                onChange={(e) =>
                  setDifficulty(e.target.value as ChallengeDifficulty)
                }
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </SelectInput>
            </Field>
          </div>

          <Field
            id={descriptionId}
            label="Description"
          >
            <TextAreaInput
              id={descriptionId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Given an array of integers, return the indices of the two numbers that add up to a target."
              rows={3}
            />
          </Field>

          <Field id={exampleId} label="Start from an example">
            <div className={styles.examples}>
              {examples.map((example, index) => (
                <Button
                  key={example.title}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => applyExample(index)}
                >
                  {example.title}
                </Button>
              ))}
            </div>
          </Field>

          <Field
            id={promptId}
            label="Prompt for the LLM"
          >
            <TextAreaInput
              id={promptId}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={guide.prompt}
              rows={5}
            />
          </Field>

          <Field
            id={testCodeId}
            label={guide.testLabel}
          >
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
            <Button type="submit" loading={submitting} loadingText="Creating…">
              Create challenge
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/challenges")}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
