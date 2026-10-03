import { useEffect, useState } from "react";

/**
 * Whether the reader has asked for reduced motion, tracked live.
 *
 * A primitive rather than a third inline `matchMedia(...).matches` read.
 * `Reveal` and `useCountUp` each carry a private copy; this exists so new
 * motion does not add a fourth. Those two are left as they are on purpose —
 * changing them is a refactor of already-shipped behaviour, and this is a
 * feature branch.
 *
 * Subscribes to the media query rather than reading it once during render.
 * A one-shot read cannot answer "what if the reader turned it on mid-session",
 * which is a real thing on macOS and a real preference: someone can watch a
 * page with motion, find it uncomfortable, and switch it on without reloading.
 * Reading it in an effect (rather than in `useState`'s initialiser) is what
 * makes the first render honest too — the initial value has to be the same on
 * the server and the client or this is a hydration mismatch.
 *
 * `false` when `matchMedia` is missing, which is the jsdom case: a caller must
 * get *some* answer, and `false` is the one that keeps the page rendering
 * rather than freezing it.
 */
export function usePrefersReducedMotion(): boolean {
  // `false` initially, always — the same value on the server and on the client's
  // first render, which is what keeps this from being a hydration mismatch. A
  // reduced-motion reader therefore gets motion for exactly one frame, and the
  // effect below removes it. Seeding the initialiser from `matchMedia` instead
  // would answer correctly on the client and wrongly on the server, so React
  // would discard the server markup and the page would flash.
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    setReduced(query.matches);
    // `addEventListener` on a MediaQueryList is the modern form; the deprecated
    // `addListener` is the only one older Safari has, and this app supports it.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);

  return reduced;
}
