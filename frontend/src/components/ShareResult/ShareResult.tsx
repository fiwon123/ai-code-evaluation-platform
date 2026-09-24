import { useState } from "react";
import Button from "../Button/Button.tsx";
import Card from "../Card/Card.tsx";
import { submissionsApi } from "../../services/api.ts";
import { extractError } from "../../utils/errors.ts";
import styles from "./ShareResult.module.css";

function shareUrl(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
  return `${origin}/results/${encodeURIComponent(token)}`;
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(textarea);
  return ok;
}

/** Share / revoke a public link to this completed evaluation report. */
function ShareResult({ submissionId }: { submissionId: string }) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleShare() {
    setBusy(true);
    setError(null);
    try {
      const result = await submissionsApi.share(submissionId);
      setShareToken(result.share_token);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    setError(null);
    try {
      await submissionsApi.revokeShare(submissionId);
      setShareToken(null);
      setCopied(false);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!shareToken) {
      return;
    }
    setCopied(await copyText(shareUrl(shareToken)));
  }

  const url = shareToken ? shareUrl(shareToken) : null;

  return (
    <Card>
      <h2 className={styles.title}>Share this report</h2>
      {shareToken ? (
        <>
          <p className={styles.muted}>
            Anyone with this link can view the report — no account needed.
          </p>
          <div className={styles.row}>
            <input
              readOnly
              value={url ?? ""}
              aria-label="Shareable result URL"
              onFocus={(event) => event.currentTarget.select()}
              className={styles.urlInput}
            />
            <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              loadingText="Revoking…"
              onClick={() => void handleRevoke()}
            >
              Revoke
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.muted}>
            Generate a public link so anyone can see this evaluation report.
          </p>
          <div className={styles.row}>
            <Button
              size="sm"
              loading={busy}
              loadingText="Creating…"
              onClick={() => void handleShare()}
            >
              Share result
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className={styles.errorText}>
          {error}
        </p>
      )}
    </Card>
  );
}

export default ShareResult;