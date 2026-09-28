/**
 * The field layout shared by the Create and Edit challenge forms.
 *
 * These two pages are the same form with a different verb: Create submits
 * `challengesApi.create` and offers an example loader, Edit loads an existing
 * challenge and submits `challengesApi.update`. Everything between the header
 * and the action bar was duplicated — and duplicated by hand, which is how the
 * two copies drifted. The layout now lives here, once.
 *
 * What stays in the pages: the page shell, the breadcrumbs, the fetch, the
 * submit call, and the words on the buttons. Those genuinely differ, and a
 * shared component that grew knobs for all of them would be worse than the
 * duplication it replaced.
 *
 * A note on the locked strings. `CreateChallenge.test.tsx` and
 * `EditChallenge.test.tsx` must keep passing unchanged, and they reach into
 * this markup by name: `getByLabelText(/Prompt for the LLM/)`,
 * `getByText("Test code (pytest)")`, `getByLabelText(/Language/)` on a real
 * `<select>`, and `getByRole("button", { name: "Valid Parentheses" })` for the
 * example titles. So the labels stay exactly as they were and anything extra —
 * the character counter, the runner hint — is deliberately placed *outside*
 * the `<label>`, because `getByText` matches an element's whole text content
 * and a counter inside the label would change "Test code (pytest)" into
 * something that no longer matches.
 */
import type { ReactNode } from "react";

import Button from "../Button/Button.tsx";
import {
  Field,
  FieldGroup,
  SelectInput,
  TextAreaInput,
  TextInput,
  useFieldId,
} from "../Input/Input.tsx";
import type { ChallengeDifficulty } from "../../types.ts";
import {
  LANGUAGES,
  evaluationEstimate,
  languageLabel,
  runnerForLanguage,
  type LanguageExample,
  type LanguageGuide,
} from "../../utils/language.ts";
import styles from "./challenge-form.module.css";

/** Everything the form edits, in one object so the two pages cannot disagree. */
export interface ChallengeFormValue {
  title: string;
  description: string;
  prompt: string;
  testCode: string;
  language: string;
  difficulty: ChallengeDifficulty;
}

export const DIFFICULTIES: ReadonlyArray<{
  value: ChallengeDifficulty;
  label: string;
}> = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

/**
 * Difficulty as a segmented control over a native radio group.
 *
 * A `<select>` was three tab stops and no way to see the options without
 * opening it. A `fieldset`/`legend` radio group is one tab stop, arrow keys
 * move between the options, and the legend names the group for a screen
 * reader without inventing a `role` — and the radios keep the `name`/`value`
 * semantics a form posts with.
 */
export function DifficultyChips({
  value,
  onChange,
}: {
  value: ChallengeDifficulty;
  onChange: (next: ChallengeDifficulty) => void;
}) {
  return (
    <fieldset className={styles.difficulty}>
      <legend className={styles.difficultyLegend}>Difficulty</legend>
      <div className={styles.chips}>
        {DIFFICULTIES.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={`${styles.chip} ${selected ? styles.chipSelected : ""}`}
            >
              <input
                type="radio"
                name="difficulty"
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Live size of a text field: words and characters. */
function countText(text: string): { words: number; characters: number } {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    characters: text.length,
  };
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export interface ChallengeFormFieldsProps {
  value: ChallengeFormValue;
  onChange: <K extends keyof ChallengeFormValue>(
    key: K,
    next: ChallengeFormValue[K],
  ) => void;
  /** Per-language placeholder and label text, from `languageGuide`. */
  guide: LanguageGuide;
  /** Create-only: the example loader is useless when editing a filled form. */
  examples?: readonly LanguageExample[];
  onApplyExample?: (index: number) => void;
}

export function ChallengeFormFields({
  value,
  onChange,
  guide,
  examples,
  onApplyExample,
}: ChallengeFormFieldsProps) {
  // The ids live here rather than in each page: the labels cannot be wired up
  // correctly by a caller that forgets one, which is exactly the failure the
  // form-field audit exists to catch.
  const titleId = useFieldId("title");
  const languageId = useFieldId("language");
  const descriptionId = useFieldId("description");
  const promptId = useFieldId("prompt");
  const testCodeId = useFieldId("test-code");
  const examplesId = useFieldId("examples");

  const runner = runnerForLanguage(value.language);
  const promptSize = countText(value.prompt);

  return (
    <div className={styles.form}>
      <Section title="Challenge basics">
        <div className={styles.grid}>
          <Field id={titleId} label="Title">
            <TextInput
              id={titleId}
              value={value.title}
              onChange={(e) => onChange("title", e.target.value)}
              placeholder="Two Sum"
              required
              maxLength={120}
            />
          </Field>

          <Field id={languageId} label="Language">
            <SelectInput
              id={languageId}
              value={value.language}
              onChange={(e) => onChange("language", e.target.value)}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {languageLabel(lang)}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>

        <DifficultyChips
          value={value.difficulty}
          onChange={(next) => onChange("difficulty", next)}
        />

        <Field id={descriptionId} label="Description">
          <TextAreaInput
            id={descriptionId}
            value={value.description}
            onChange={(e) => onChange("description", e.target.value)}
            placeholder="Given an array of integers, return the indices of the two numbers that add up to a target."
            rows={3}
          />
        </Field>
      </Section>

      <Section
        title="Prompt"
        // Outside the `<label>` on purpose — see the note at the top of the file.
        aside={
          <span className={styles.counter}>
            {promptSize.words} {promptSize.words === 1 ? "word" : "words"} ·{" "}
            {promptSize.characters}{" "}
            {promptSize.characters === 1 ? "character" : "characters"}
          </span>
        }
      >
        <Field id={promptId} label="Prompt for the LLM">
          <TextAreaInput
            id={promptId}
            value={value.prompt}
            onChange={(e) => onChange("prompt", e.target.value)}
            placeholder={guide.prompt}
            rows={5}
          />
        </Field>
        <p className={styles.sectionHint}>
          Write it like a real interview task: say what to build, what to return,
          and what to do at the edges. Anything you leave out is a decision the
          model gets to make for you.
        </p>
      </Section>

      <Section
        title="Tests"
        aside={
          <span className={styles.sectionHint}>
            {runner
              ? `Runs with ${runner.runner}`
              : "No runner wired up yet"}
          </span>
        }
      >
        <Field id={testCodeId} label={guide.testLabel}>
          <TextAreaInput
            id={testCodeId}
            value={value.testCode}
            onChange={(e) => onChange("testCode", e.target.value)}
            placeholder={guide.testCode}
            rows={6}
            className={styles.editor}
          />
        </Field>

        {examples && examples.length > 0 && onApplyExample && (
          <FieldGroup id={examplesId} label="Start from an example">
            <div className={styles.examples}>
              {examples.map((example, index) => (
                <Button
                  key={example.title}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onApplyExample(index)}
                >
                  {example.title}
                </Button>
              ))}
            </div>
          </FieldGroup>
        )}

        <p className={styles.sectionHint}>
          {runner ? (
            <>
              The sandbox writes your suite to{" "}
              <code>{runner.testFilename}</code> and the generated solution to{" "}
              <code>{runner.solutionFilename}</code>, so the tests import from
              that filename. An evaluation takes{" "}
              {evaluationEstimate(value.language)}.
            </>
          ) : (
            <>
              This language is selectable and seeded, but no sandbox runtime
              exists for it yet — an evaluation will report that it is not
              supported.
            </>
          )}
        </p>
      </Section>

      <details className={styles.guide}>
        <summary className={styles.guideSummary}>
          Guide and example solution for {languageLabel(value.language)}
        </summary>
        <div className={styles.guideBody}>
          <dl className={styles.guideFacts}>
            <dt>Test runner</dt>
            <dd>{runner ? runner.runner : "none yet"}</dd>
            <dt>Solution file</dt>
            <dd>
              <code>{runner ? runner.solutionFilename : `solution.${guide.extension}`}</code>
            </dd>
            <dt>Test file</dt>
            <dd>
              <code>
                {runner ? runner.testFilename : `test_solution.${guide.extension}`}
              </code>
            </dd>
            <dt>Evaluation time</dt>
            <dd>{evaluationEstimate(value.language)}</dd>
          </dl>
          <p className={styles.sectionHint}>
            The prompt the field above suggests for this language, so you can see
            what a good one looks like before writing your own.
          </p>
          <pre className={styles.guidePre}>{guide.prompt}</pre>
          <p className={styles.sectionHint}>
            And a starter suite for the same task.
          </p>
          <pre className={styles.guidePre}>{guide.testCode}</pre>
        </div>
      </details>
    </div>
  );
}

export interface ChallengeFormActionsProps {
  value: ChallengeFormValue;
  submitting: boolean;
  submitLabel: string;
  loadingText: string;
  onCancel: () => void;
  /** Rendered as an alert above the bar, so it sits next to the action that failed. */
  error?: string | null;
}

export function ChallengeFormActions({
  value,
  submitting,
  submitLabel,
  loadingText,
  onCancel,
  error,
}: ChallengeFormActionsProps) {
  const difficulty = DIFFICULTIES.find((d) => d.value === value.difficulty);

  return (
    <>
      {error && (
        <p className={styles.errorBanner} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <div className={styles.summary}>
          <span className={styles.summaryTitle}>
            {value.title.trim() || "Untitled challenge"}
          </span>
          <span className={styles.summaryMeta}>
            {languageLabel(value.language)} · {difficulty?.label ?? value.difficulty}{" "}
            difficulty
          </span>
        </div>
        <div className={styles.actionButtons}>
          <Button
            type="submit"
            loading={submitting}
            loadingText={loadingText}
          >
            {submitLabel}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </>
  );
}
