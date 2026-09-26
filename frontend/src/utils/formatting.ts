import type { SubmissionStatus } from "../types.ts";

/** Badge variants used to render each submission status. */
export type StatusVariant =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "neutral";

/** Map a submission status to the matching Badge variant. */
export function statusVariant(status: SubmissionStatus): StatusVariant {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "danger";
    // pending = waiting in the queue (yellow/orange), processing = actively
    // running (blue).
    case "pending":
      return "warning";
    case "processing":
      return "primary";
    default:
      return "neutral";
  }
}

/**
 * Format an ISO timestamp as a short relative time ("just now", "5m ago",
 * "3h ago", "2d ago"), falling back to a locale date for older values.
 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Format an elapsed duration as a live counter, e.g. "12s", "2m 05s", "1h 04m". */
export function formatElapsedMs(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

/**
 * Format how long it has been since an ISO timestamp, e.g. "12s" or "2m 05s".
 * Pass a ticking `nowMs` (see `useNow`) so the value stays live.
 */
export function formatElapsed(iso: string, nowMs = Date.now()): string {
  return formatElapsedMs(nowMs - Date.parse(iso));
}

/** Format a recorded duration in milliseconds, e.g. "850ms", "4.2s", "1m 30s". */
export function formatDurationMs(ms: number): string {
  const rounded = Math.abs(Math.round(ms));
  const totalSeconds = Math.floor(rounded / 1000);
  if (totalSeconds >= 60) {
    const seconds = totalSeconds % 60;
    return `${Math.floor(totalSeconds / 60)}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (rounded < 1000) {
    return `${rounded}ms`;
  }
  return `${(rounded / 1000).toFixed(1)}s`;
}

/**
 * After this much time an in-progress submission is considered stuck: the
 * worst realistic path is a 60s LLM call plus 90s of Go test execution, so
 * anything beyond ~2 minutes deserves a "taking longer than usual" warning.
 */
export const STALE_AFTER_MS = 120_000;

/** True when more than STALE_AFTER_MS have elapsed since an ISO timestamp. */
export function isDelayed(iso: string, nowMs = Date.now()): boolean {
  return nowMs - Date.parse(iso) > STALE_AFTER_MS;
}

/**
 * After this much time a *pending* submission is considered severely delayed:
 * the backend's recovery sweep re-dispatches pending rows after "10 minutes
 * stale" (PENDING_STALE_MINUTES) and abandons — marks failed — any row that
 * never started within 60 minutes of creation (PENDING_MAX_MINUTES, the "kill
 * switch"). So a row stuck this long means the worker/queue is likely down and
 * the UI should escalate the message rather than keep saying "taking longer
 * than usual". Mirrors the backend's 10-minute stale re-dispatch cadence
 * (600_000 ms = 10 min), well before the 60-minute kill switch, so users get a
 * heads-up before the auto-fail.
 */
export const SEVERE_DELAY_AFTER_MS = 600_000;

/** True when more than SEVERE_DELAY_AFTER_MS have elapsed since an ISO timestamp. */
export function isSeverelyDelayed(iso: string, nowMs = Date.now()): boolean {
  return nowMs - Date.parse(iso) > SEVERE_DELAY_AFTER_MS;
}

/** Score buckets drive the report's ring/badge color. */
export type ScoreVariant = "success" | "warning" | "danger";

/**
 * Map an evaluation score (0–100) to a color variant:
 * ≥80 success (green), 60–79 warning (amber), <60 danger (red).
 */
export function scoreVariant(score: number): ScoreVariant {
  if (score >= 80) {
    return "success";
  }
  if (score >= 60) {
    return "warning";
  }
  return "danger";
}

const METRIC_LABELS: Record<string, string> = {
  backend: "Backend",
  duration_ms: "Duration (ms)",
  image: "Image",
  language: "Language",
  returncode: "Return code",
  error: "Error",
  fallback_used: "Fallback used",
  fallback_provider: "Fallback provider",
  fallback_model: "Fallback model",
  primary_error: "Primary provider error",
};

/**
 * Provenance of a run whose code came from the fallback provider instead of the
 * requested one (see backend `services/llm_fallback.py`). Null for a normal run
 * — the metrics are absent, not falsy — so a report only calls attention to
 * itself when the user would otherwise be misled about which model was used.
 */
export interface FallbackInfo {
  provider: string;
  model: string | null;
  primaryError: string | null;
}

export function fallbackInfo(metrics: Record<string, unknown>): FallbackInfo | null {
  if (!metrics || metrics.fallback_used !== true) {
    return null;
  }
  const provider = typeof metrics.fallback_provider === "string" ? metrics.fallback_provider : null;
  const model = typeof metrics.fallback_model === "string" ? metrics.fallback_model : null;
  const primaryError =
    typeof metrics.primary_error === "string" ? metrics.primary_error : null;
  return { provider: provider ?? "a fallback provider", model, primaryError };
}

/**
 * Turn a raw metric key into a readable label: known keys get a curated
 * label, anything else falls back to sentence case (`llm_latency_ms` →
 * "Llm Latency Ms" — pass a nicer key in `METRIC_LABELS` for polish).
 */
export function humanizeMetricKey(key: string): string {
  const label = METRIC_LABELS[key];
  if (label) {
    return label;
  }
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}