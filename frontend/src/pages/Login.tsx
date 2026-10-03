import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout/AuthLayout.tsx";
import Button from "../components/Button/Button.tsx";
import GithubOAuthButton from "../components/GithubOAuthButton.tsx";
import { Field, TextInput, useFieldId } from "../components/Input/Input.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { extractError, extractFieldErrors } from "../utils/errors.ts";
import styles from "./Login.module.css";

/**
 * The path a signed-out visitor came from (e.g. the Demo page sends
 * `{ from: "/demo" }` with its sign-in CTA). Only an internal path is
 * honored; anything external, empty or a credential page itself is treated
 * as "no return target" (the /login -> /login loop is a hang, not a
 * feature).
 */
function returnTarget(state: unknown): string | null {
  const from = (state as { from?: unknown } | null)?.from;
  if (typeof from !== "string") return null;
  if (!from.startsWith("/") || from.startsWith("//")) return null;
  if (from === "/login" || from === "/register") return null;
  return from;
}

function Login() {
  const { user, initializing, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = returnTarget(location.state);
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
      navigate(from ?? "/challenges");
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
    return <Navigate to={from ?? "/challenges"} replace />;
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your account"
      footer={
        <p className={styles.footerText}>
          No account?{" "}
          <Link to="/register" className={styles.link}>
            Sign up
          </Link>
        </p>
      }
    >
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
    </AuthLayout>
  );
}

export default Login;