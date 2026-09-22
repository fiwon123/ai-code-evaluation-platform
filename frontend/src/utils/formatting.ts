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
    case "processing":
      return "warning";
    case "pending":
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