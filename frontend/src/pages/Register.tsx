import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import Button from "../components/Button/Button.tsx";
import Card from "../components/Card/Card.tsx";
import GithubOAuthButton from "../components/GithubOAuthButton.tsx";
import { Field, TextInput, useFieldId } from "../components/Input/Input.tsx";
import Logo from "../components/Logo/Logo.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { extractError, extractFieldErrors } from "../utils/errors.ts";
import { useToast } from "../components/Toast/ToastContext.tsx";
import styles from "./Register.module.css";

function Register() {
  const { user, initializing, register } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const emailId = useFieldId("email");
  const usernameId = useFieldId("username");
  const passwordId = useFieldId("password");
  const passwordValid = password.length >= 8;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register(email, username, password);
      showToast("Account created. Welcome!", "success");
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
          <h1 className={styles.title}>Create your account</h1>
          <p className={styles.subtitle}>
            Start generating and evaluating AI code in minutes.
          </p>
        </div>
        <GithubOAuthButton onError={setError} />
        <div className={styles.divider} role="separator">
          <span>or</span>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className={styles.form}>
          <Field label="Email" id={emailId} error={fieldErrors.email}>
            <TextInput
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              invalid={Boolean(fieldErrors.email)}
            />
          </Field>
          <Field label="Username" id={usernameId} error={fieldErrors.username}>
            <TextInput
              id={usernameId}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={50}
              autoComplete="username"
              placeholder="johndoe"
              invalid={Boolean(fieldErrors.username)}
            />
          </Field>
          <Field label="Password" id={passwordId} error={fieldErrors.password}>
            <TextInput
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              invalid={Boolean(fieldErrors.password)}
            />
            <div className={styles.passwordHint}>
              <span
                className={`${styles.hintBar} ${password ? (passwordValid ? styles.hintBarOk : styles.hintBarWeak) : ""}`}
              />
              <span className={styles.hintText}>
                {password
                  ? passwordValid
                    ? "Password looks good"
                    : "Use at least 8 characters"
                  : "Minimum 8 characters"}
              </span>
            </div>
          </Field>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <Button
            type="submit"
            loading={submitting}
            loadingText="Creating account…"
            size="lg"
            className={styles.submit}
          >
            Create account
          </Button>
        </form>
        <p className={styles.footerText}>
          Already have an account?{" "}
          <Link to="/login" className={styles.link}>
            Log in
          </Link>
        </p>
      </Card>
    </div>
  );
}

export default Register;