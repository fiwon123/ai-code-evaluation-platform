import { useState } from "react";
import { submissionsApi } from "../services/api.ts";
import { extractError } from "../utils/errors.ts";

export function shareUrlFor(token: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
  return `${origin}/results/${encodeURIComponent(token)}`;
}

/** Share-link state + actions for one submission. */
export function useShareLink(submissionId: string, initialToken: string | null = null) {
  const [shareToken, setShareToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function share() {
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

  async function revoke() {
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

  async function copy() {
    if (!shareToken) {
      return;
    }
    const url = shareUrlFor(shareToken);
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch {
        // Fall through to the legacy path below.
      }
    }
    if (!ok) {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      ok = document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(ok);
  }

  return {
    shareToken,
    url: shareToken ? shareUrlFor(shareToken) : null,
    busy,
    copied,
    error,
    share,
    revoke,
    copy,
  };
}