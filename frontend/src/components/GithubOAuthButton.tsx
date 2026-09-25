import { useState } from "react";
import Button from "./Button/Button.tsx";
import { authApi } from "../services/api.ts";
import { extractError } from "../utils/errors.ts";
import styles from "./GithubOAuthButton.module.css";

interface GithubOAuthButtonProps {
  className?: string;
  /** Called with a human-readable message when authorization can't start. */
  onError?: (message: string) => void;
}

function GithubMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      className={styles.mark}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** "Continue with GitHub" — starts the backend OAuth authorize flow. */
function GithubOAuthButton({ className = "", onError }: GithubOAuthButtonProps) {
  const [starting, setStarting] = useState(false);

  async function handleClick() {
    setStarting(true);
    try {
      const { authorization_url } = await authApi.oauthAuthorize("github");
      window.location.assign(authorization_url);
    } catch (err) {
      setStarting(false);
      onError?.(extractError(err));
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className={`${styles.button} ${className}`}
      loading={starting}
      loadingText="Redirecting to GitHub…"
      onClick={() => void handleClick()}
    >
      <GithubMark />
      Continue with GitHub
    </Button>
  );
}

export default GithubOAuthButton;