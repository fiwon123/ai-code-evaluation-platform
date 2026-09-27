/**
 * Polling cadence for live submission status, in milliseconds.
 *
 * Single source of truth so every page that watches an in-flight evaluation
 * uses the same interval (SubmissionDetail, ChallengeDetail comparison) and
 * the heavier list refresh (Profile) stays at its own, slower cadence.
 */
export const SUBMISSION_POLL_MS = 1500;

/** Cadence for the challenge-page provider-comparison leaderboard. */
export const COMPARE_POLL_MS = SUBMISSION_POLL_MS;

/** Cadence for refreshing the profile's submissions list while rows run. */
export const PROFILE_LIST_POLL_MS = 5000;

/**
 * Ceiling for the growth of a long-lived poll's interval.
 *
 * A run that never completes keeps its poll alive for the whole severe-delay
 * window (10 min), and every tick of that window is a full request. At a flat
 * 1.5s that is ~400 requests returning identical data — measured, not
 * estimated; see #257. Doubling up to this cap brings the worst case to ~61.
 *
 * The cap is generous on purpose: the visible "running for 42s" counter is
 * client-side (`useNow`), so the cadence does not make the page *feel* live —
 * it only decides how long a finished result waits to appear in the
 * leaderboard, where ~10s of staleness is invisible. Raising the cap trades
 * request volume for that staleness; it is the only knob.
 */
export const POLL_MAX_INTERVAL_MS = 10_000;

/**
 * Next interval for a poll that has seen no progress: double the current one,
 * capped at {@link POLL_MAX_INTERVAL_MS}.
 *
 * Growth is driven by *absence of progress*, never by request outcome. A doomed
 * run's polls all return 200 with an unchanged leaderboard, so a
 * success-triggered reset would defeat the backoff entirely — the loop has to
 * grow precisely because the requests keep succeeding with nothing new.
 * Callers reset to the base interval when a run actually completes.
 */
export function nextPollDelay(currentMs: number, maxMs = POLL_MAX_INTERVAL_MS): number {
  return Math.min(currentMs * 2, maxMs);
}
