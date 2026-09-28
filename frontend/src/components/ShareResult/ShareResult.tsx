import Button from "../Button/Button.tsx";
import Card from "../Card/Card.tsx";
import { useShareLink } from "../../hooks/useShareLink.ts";
import styles from "./ShareResult.module.css";

/** Share / revoke a public link to this completed evaluation report. */
function ShareResult({ submissionId }: { submissionId: string }) {
  const { shareToken, url, busy, copied, error, share, revoke, copy } =
    useShareLink(submissionId);

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
              id="share-result-url"
              name="share_url"
              readOnly
              value={url ?? ""}
              aria-label="Shareable result URL"
              onFocus={(event) => event.currentTarget.select()}
              className={styles.urlInput}
            />
            <Button variant="secondary" size="sm" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              loadingText="Revoking…"
              onClick={() => void revoke()}
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
              onClick={() => void share()}
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