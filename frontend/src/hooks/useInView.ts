import { useEffect, useRef, useState } from "react";

/**
 * Reports whether an element has entered the viewport.
 *
 * The point of this hook is to *not* start work while nobody can see it. The
 * Home page's stat sweep (#354) used to begin on mount, four `requestAnimationFrame`
 * loops running against the terminal animation in the hero a screen above — work
 * no visitor could see, competing with one they could. Beyond the wasted frames
 * it was measurable: it made the terminal-story e2e spec fail intermittently,
 * because that spec asserts on a real, timed animation and the two were
 * fighting over the same main thread.
 *
 * Deferring the sweep until the section arrives also reads better. A count-up
 * that finishes before the viewport reaches it is an animation nobody watched.
 *
 * Falls back to "in view" when `IntersectionObserver` is unavailable, and
 * respects a reduced-motion preference by reporting visible immediately — in
 * that case there is no sweep to defer.
 */
export function useInView<T extends HTMLElement = HTMLElement>(options?: {
  /** Fraction of the element that must be visible. */
  threshold?: number;
  /** Skip observation entirely (reduced motion, tests). */
  initiallyVisible?: boolean;
}): { ref: React.RefObject<T | null>; inView: boolean } {
  // Generic in the element type, so the ref is assignable to a concrete JSX
  // attribute. A `RefObject<HTMLElement>` cannot go on a `<div>`: the types are
  // checked structurally, and `HTMLElement` is missing `HTMLDivElement`'s
  // properties.
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(options?.initiallyVisible ?? false);

  useEffect(() => {
    const node = ref.current;
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced || options?.initiallyVisible) {
      setInView(true);
      return;
    }
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            // One-way: the sweep runs once. Leaving the observer attached would
            // re-fire on every scroll back into view and restart nothing, but
            // would keep the observer alive for the page's lifetime.
            observer.disconnect();
            return;
          }
        }
      },
      { threshold: options?.threshold ?? 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // `initiallyVisible` is a mount-time decision, not a live input; depending on
    // it would tear down and rebuild the observer if a caller passed a fresh
    // literal on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options?.threshold]);

  return { ref, inView };
}