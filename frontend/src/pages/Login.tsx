import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import GithubOAuthButton from "../components/GithubOAuthButton.tsx";
import { Field, TextInput, useFieldId } from "../components/Input/Input.tsx";
import Logo from "../components/Logo/Logo.tsx";
import PageTitle from "../components/PageTitle/PageTitle.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { extractError, extractFieldErrors } from "../utils/errors.ts";
import styles from "./Login.module.css";

function Login() {
  const { user, initializing, login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const identifierId = useFieldId("identifier");
  const passwordId = useFieldId("password");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(identifier, password);
      navigate("/challenges");
    } catch (err) {
      setError(extractError(err));
      setFieldErrors(extractFieldErrors(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (initializing) {
    return <div className={styles.page} />;
  }

  if (user) {
    return <Navigate to="/challenges" replace />;
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Logo size="lg" />
          <PageTitle size="sm" className={styles.title}>Welcome back</PageTitle>
          <p className={styles.subtitle}>Log in to your account</p>
        </div>
        <GithubOAuthButton onError={setError} />
        <div className={styles.divider} role="separator">
          <span>or</span>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className={styles.form}>
          <Field label="Email or username" id={identifierId} error={fieldErrors.identifier}>
            <TextInput
              id={identifierId}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              placeholder="you@example.com"
              invalid={Boolean(fieldErrors.identifier)}
            />
          </Field>
          <Field label="Password" id={passwordId} error={fieldErrors.password}>
            <TextInput
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              invalid={Boolean(fieldErrors.password)}
            />
          </Field>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <Button
            type="submit"
            loading={submitting}
            loadingText="Logging in…"
            size="lg"
            className={styles.submit}
          >
            Log in
          </Button>
        </form>
        <p className={styles.footerText}>
          No account?{" "}
          <Link to="/register" className={styles.link}>
            Sign up
          </Link>
        </p>
      </Card>
    </div>
  );
}

export default Login;