import { useEffect, useRef, useState } from "react";
import { getToken } from "../services/api.ts";
import type { Submission, SubmissionPhase, SubmissionStatus } from "../types.ts";

const API_BASE: string = import.meta.env.VITE_API_URL || "http://localhost:8000";
const WS_BASE: string =
  import.meta.env.VITE_WS_URL || API_BASE.replace(/^http/, "ws");

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
      const socket = new WebSocket(
        `${WS_BASE}/api/ws/submissions/${encodeURIComponent(targetId)}` +
          `?token=${encodeURIComponent(authToken)}`,
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
          // Merge a status/phase pair. Ignore anything that is not a valid
          // SubmissionStatus so a stray event can never corrupt client state
          // (the server now maps events, but belt-and-braces).
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