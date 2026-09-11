import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import { Field, TextInput, useFieldId } from "../components/Input/Input.tsx";
import Logo from "../components/Logo/Logo.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { ApiError } from "../services/api.ts";
import styles from "./Login.module.css";

function Login() {
  const { user, initializing, login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const identifierId = useFieldId("identifier");
  const passwordId = useFieldId("password");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier, password);
      navigate("/challenges");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.detail : "Login failed. Please try again.",
      );
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
          <h1 className={styles.title}>Welcome back</h1>
          <p className={styles.subtitle}>Log in to your account</p>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className={styles.form}>
          <Field label="Email or username" id={identifierId}>
            <TextInput
              id={identifierId}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password" id={passwordId}>
            <TextInput
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="••••••••"
            />
          </Field>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} size="lg" className={styles.submit}>
            {submitting ? "Logging in…" : "Log in"}
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