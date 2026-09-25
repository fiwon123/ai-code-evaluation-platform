import { useEffect, useRef, useState } from "react";
import { getToken } from "../services/api.ts";
import { joinApiUrl, webSocketBase } from "../services/apiUrl.ts";
import type { Submission, SubmissionPhase, SubmissionStatus } from "../types.ts";


const INITIAL_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 15000;

export type SocketState = "connecting" | "open" | "closed";

/** Client-safe statuses that can arrive in an update (the server maps
 *  ephemeral worker events like "code_generated" to these). */
const VALID_STATUSES = new Set<SubmissionStatus>([
  "pending",
  "processing",
  "completed",
  "failed",
]);

interface SocketMessage {
  type?: string;
  submission?: Submission;
  status?: SubmissionStatus;
  phase?: SubmissionPhase | null;
}

/**
 * Live submission updates over a WebSocket.
 *
 * Connects to `/api/ws/submissions/{id}` using the stored JWT as a query
 * parameter (browsers cannot set headers on WebSocket handshakes), applies
 * the initial `snapshot` and merges `update` statuses into the live
 * submission, and reconnects with capped exponential backoff on unexpected
 * drops. Returns `null`/`closed` when no token is available.
 *
 * Output (code, logs, evaluation result) arrives on the socket: a terminal
 * `update` carries the complete persisted record, so the UI no longer waits for
 * a second REST round-trip after the status flips. The REST path in the pages
 * stays as the fallback for mount, reconnects and the shared-result view.
 */
export function useSubmissionSocket(submissionId: string | undefined): {
  liveSubmission: Submission | null;
  state: SocketState;
} {
  const [liveSubmission, setLiveSubmission] = useState<Submission | null>(null);
  const [state, setState] = useState<SocketState>("closed");
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_MS);
  const reconnectTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!submissionId) {
      return;
    }
    const token = getToken();
    if (!token) {
      return;
    }
    const targetId: string = submissionId;
    const authToken: string = token;

    let cancelled = false;
    let intentionallyClosed = false;

    function connect() {
      if (cancelled) {
        return;
      }
      // Built at connect time (not module scope) so the socket always reflects
      // the current page origin, and the join never repeats the `/api` prefix.
      const socket = new WebSocket(
        joinApiUrl(
          webSocketBase(window.location.origin),
          `/api/ws/submissions/${encodeURIComponent(targetId)}`,
        ) + `?token=${encodeURIComponent(authToken)}`,
      );
      socketRef.current = socket;
      setState("connecting");

      socket.onopen = () => {
        if (cancelled) {
          socket.close();
          return;
        }
        reconnectDelayRef.current = INITIAL_RECONNECT_MS;
        setState("open");
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        if (cancelled) {
          return;
        }
        let message: SocketMessage;
        try {
          message = JSON.parse(event.data) as SocketMessage;
        } catch {
          return;
        }
        if (message.type === "snapshot" && message.submission) {
          setLiveSubmission(message.submission);
        } else if (message.type === "update") {
          // A terminal update carries the whole persisted record — code, logs
          // and the evaluation result — so REPLACE rather than merge. The
          // record is self-contained, which is what makes a replay safe: a
          // duplicate after a reconnect, or an update that races the snapshot,
          // lands on identical state instead of re-applying a patch over
          // output that is already there.
          if (message.submission) {
            setLiveSubmission(message.submission);
            return;
          }
          // Older servers (and mid-pipeline events, which have no output yet)
          // send only a status/phase pair — patch those in place. Ignore
          // anything that is not a valid SubmissionStatus so a stray event can
          // never corrupt client state (the server now maps events, but
          // belt-and-braces).
          if (message.status && !VALID_STATUSES.has(message.status)) {
            return;
          }
          setLiveSubmission((prev) => {
            if (!prev) {
              return prev;
            }
            const next: Submission = { ...prev };
            if (message.status && VALID_STATUSES.has(message.status)) {
              next.status = message.status;
            }
            if (typeof message.phase !== "undefined") {
              next.phase = message.phase;
            }
            return next;
          });
        }
      };

      socket.onerror = () => {
        socket.close();
      };

      socket.onclose = () => {
        if (cancelled || intentionallyClosed) {
          return;
        }
        setState("closed");
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_MS);
        reconnectTimerRef.current = window.setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      intentionallyClosed = true;
      if (reconnectTimerRef.current !== undefined) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      socketRef.current?.close();
    };
  }, [submissionId]);

  return { liveSubmission, state };
}