import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from `from` to `target` over `durationMs`.
 *
 * - Honors `prefers-reduced-motion`: returns the target immediately.
 * - Uses requestAnimationFrame with an ease-out curve when available,
 *   falling back to a timer-based step otherwise (test environments).
 * - `startDelayMs: null` *waits*: the count-up does not start until a later
 *   render supplies a real delay. Callers use it to defer an off-screen
 *   animation until it is scrolled into view (see `useInView`), rather than
 *   restarting from zero when the gate opens — the count-up is a single run
 *   with a start offset, not a restartable one.
 *
 * ## Why `from` is a parameter rather than "wherever the number happens to be"
 *
 * Because the caller has to be able to say where the count starts *before* it
 * starts, for two reasons. A delay stands between the change and the motion, so
 * whatever the hook remembered would have moved on by the time the first frame
 * ran; and the ring's arc is drawn by CSS from a custom property, which cannot
 * read a value out of a hook. Both halves of the Home hero's score ring climb
 * from 33 to 67 at the same instant, so the 33 has to be a fact in the data and
 * not a side effect of animation order.
 *
 * The default of 0 keeps every other consumer counting up from nothing, which is
 * what all of them want.
 *
 * Returns the current animated value.
 */
export function useCountUp(
  target: number,
  durationMs = 800,
  startDelayMs: number | null = 0,
  from = 0,
): number {
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [value, setValue] = useState<number>(reduced ? target : from);
  const rafRef = useRef<number>(0);
  const timeoutRef = useRef<number>(0);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    // Deferred: nothing scheduled, and the value stays where it is until the
    // gate opens. Not an early `return target` — that would snap the value to
    // its target and then count back down to zero when the gate opens.
    if (startDelayMs === null) {
      return;
    }

    let start: number | null = null;
    let intervalId = 0;
    // Latched rather than recomputed per frame: `from` is the number the caller
    // said was on screen when this run started, and the run has to keep counting
    // from there even as the component re-renders under it.
    const startValue = from;

    const step = (now: number) => {
      if (start === null) {
        start = now;
      }
      const progress = Math.min(1, (now - start) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(startValue + (target - startValue) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };

    const hasRaf = typeof requestAnimationFrame === "function";
    timeoutRef.current = window.setTimeout(() => {
      if (hasRaf) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      // Fallback for environments without rAF (e.g. some test setups).
      const startedAt = Date.now();
      intervalId = window.setInterval(() => {
        const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        setValue(Math.round(startValue + (target - startValue) * eased));
        if (progress >= 1) {
          window.clearInterval(intervalId);
        }
      }, 16);
    }, startDelayMs);

    return () => {
      window.clearTimeout(timeoutRef.current);
      window.clearInterval(intervalId);
      cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, startDelayMs, from, reduced]);

  return value;
}