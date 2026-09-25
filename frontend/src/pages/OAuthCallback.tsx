import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import Card from "../components/Card/Card.tsx";
import Spinner from "../components/Spinner/Spinner.tsx";
import { useAuth } from "../context/AuthContext.tsx";
import { extractError } from "../utils/errors.ts";
import styles from "./OAuthCallback.module.css";

/**
 * OAuth callback destination — the browser lands here after GitHub
 * authorizes (redirect_uri from the backend /authorize response). It
 * exchanges the code+state for a JWT via the backend callback endpoint.
 */
function OAuthCallback() {
  const { user, initializing, loginWithOAuth } = useAuth();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function complete() {
      const code = searchParams.get("code");
      const state = searchParams.get("state");
      if (!code || !state) {
        setError("Missing authorization code — the OAuth flow was interrupted.");
        return;
      }
      try {
        await loginWithOAuth("github", code, state);
        // Navigate after successful auth below (user becomes non-null).
      } catch (err) {
        if (!cancelled) {
          setError(extractError(err));
        }
      }
    }

    void complete();
    return () => {
      cancelled = true;
    };
  }, [searchParams, loginWithOAuth]);

  if (initializing) {
    return <div className={styles.page} />;
  }

  if (user) {
    return <Navigate to="/challenges" replace />;
  }

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.body}>
          {error ? (
            <>
              <h1 className={styles.title}>Couldn’t log you in</h1>
              <p role="alert" className={styles.error}>
                {error}
              </p>
              <Link to="/login" className={styles.link}>
                Back to login
              </Link>
            </>
          ) : (
            <>
              <Spinner label="Signing you in" />
              <p className={styles.status}>Signing you in…</p>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

export default OAuthCallback;