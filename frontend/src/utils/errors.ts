import { ApiError } from "../services/api.ts";

/** Field-keyed validation messages from a failed API request. */
export type FieldErrors = Record<string, string>;

/**
 * Extract a human-readable message from any caught error.
 *
 * - API errors use the server-provided detail (already human-readable).
 * - Network failures (fetch threw TypeError "Failed to fetch") get a
 *   clear, actionable message instead of a bare "Failed to fetch".
 * - Aborted requests (AbortController) are treated as silent cancellations.
 * - Everything else falls back to the error message or a generic string.
 */
export function extractError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.detail;
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return "Request cancelled.";
  }
  if (err instanceof TypeError && err.message === "Failed to fetch") {
    return "Unable to reach the server. Please check your connection and try again.";
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/** Extract field-level validation messages (Pydantic 422) from an error. */
export function extractFieldErrors(err: unknown): FieldErrors {
  if (err instanceof ApiError && err.validationErrors) {
    return err.validationErrors;
  }
  return {};
}