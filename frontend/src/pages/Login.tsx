import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.tsx";
import { ApiError } from "../services/api.ts";

function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <div>
      <h1>Log in</h1>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div>
          <label htmlFor="identifier">
            Email or username
            <input
              id="identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
        </div>
        <div>
          <label htmlFor="password">
            Password
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}

export default Login;