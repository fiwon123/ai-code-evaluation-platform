import { useEffect, useState } from "react";

/**
 * Returns the current epoch time, refreshed on an interval.
 *
 * Pass `enabled = false` to freeze the value and stop the timer — callers
 * tick only while they have in-progress (pending/processing) rows so list
 * pages don't re-render every second for terminal data.
 */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);

  return now;
}