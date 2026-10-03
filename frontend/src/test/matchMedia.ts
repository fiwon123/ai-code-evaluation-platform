import { vi } from "vitest";

/**
 * A `window.matchMedia` stub, and a handle to drive the answer.
 *
 * jsdom does not implement `matchMedia` at all, so `usePrefersReducedMotion`
 * sees `typeof window.matchMedia !== "function"` and answers `false` for the
 * whole run. That default is deliberate in the hook — motion is the safe answer
 * when the query cannot be asked — but it means a component test that renders
 * something *choreographed* sees only its first frame, forever.
 *
 * Three suites now need the other answer:
 *
 * - `landing.test.tsx` / `homeAmbient.test.tsx` assert the landing copy and the
 *   sample report's content. Those assertions are about what the panel says, not
 *   about when it says it, and the choreography has its own tests (the
 *   `useTerminalStory` suite) and its own e2e. Reading the *final* state here is
 *   what lets them stay plain assertions instead of timer dances.
 * - `useTerminalStory.test.ts` needs both answers, and the transition between
 *   them, to prove the preference is tracked live.
 *
 * So this is a shared helper rather than three private copies: a per-file copy
 * is how one suite ends up matching `prefers-reduced-motion` and the other two
 * matching a typo, and the failure is a green test for the wrong reason.
 *
 * It notifies its listeners, so a test can flip the preference mid-run and assert
 * that a mounted component follows — which is the only way to check that a hook
 * subscribed rather than read the query once.
 */
export function stubMatchMedia(initial: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let matches = initial;

  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("prefers-reduced-motion") ? matches : false;
    },
    media: query,
    onchange: null,
    addEventListener: (
      _type: string,
      listener: (event: { matches: boolean }) => void,
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: { matches: boolean }) => void,
    ) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;

  return {
    /** Flip the answer and notify, as a real preference change would. */
    set(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

const ORIGINAL_MATCH_MEDIA = window.matchMedia;

/** Restore whatever `matchMedia` was before a suite stubbed it. */
export function restoreMatchMedia() {
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
}
