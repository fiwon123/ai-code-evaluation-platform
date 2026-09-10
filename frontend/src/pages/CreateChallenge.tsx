import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { challengesApi, ApiError } from "../services/api.ts";

function CreateChallenge() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [testCode, setTestCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
      });
      navigate(`/challenges/${challenge.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : "Failed to create challenge. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Create challenge</h1>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div>
          <label htmlFor="title">
            Title
            <input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={255}
            />
          </label>
        </div>
        <div>
          <label htmlFor="language">
            Language
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="python">Python</option>
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="java">Java</option>
              <option value="go">Go</option>
            </select>
          </label>
        </div>
        <div>
          <label htmlFor="description">
            Description
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
            />
          </label>
        </div>
        <div>
          <label htmlFor="prompt">
            Prompt for the LLM
            <textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
              rows={6}
            />
          </label>
        </div>
        <div>
          <label htmlFor="testCode">
            Test code (pytest)
            <textarea
              id="testCode"
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              rows={6}
              placeholder="def test_example():&#10;    assert True"
            />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create challenge"}
        </button>
      </form>
    </div>
  );
}

export default CreateChallenge;