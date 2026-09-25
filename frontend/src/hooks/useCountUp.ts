import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from 0 to `target` over `durationMs`.
 *
 * - Honors `prefers-reduced-motion`: returns the target immediately.
 * - Uses requestAnimationFrame with an ease-out curve when available,
 *   falling back to a timer-based step otherwise (test environments).
 *
 * Returns the current animated value.
 */
export function useCountUp(
  target: number,
  durationMs = 800,
  startDelayMs = 0,
): number {
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [value, setValue] = useState<number>(reduced ? target : 0);
  const rafRef = useRef<number>(0);
  const timeoutRef = useRef<number>(0);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }

    let start: number | null = null;
    let intervalId = 0;

    const step = (now: number) => {
      if (start === null) {
        start = now;
      }
      const progress = Math.min(1, (now - start) / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
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
        setValue(Math.round(target * eased));
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
  }, [target, durationMs, startDelayMs, reduced]);

  return value;
}