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