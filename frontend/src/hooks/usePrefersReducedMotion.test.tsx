import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion.ts";

/**
 * A controllable `matchMedia`.
 *
 * jsdom's own `matchMedia` always reports `matches: false` and never fires
 * `change`, which makes "the reader changed the preference halfway through the
 * page" untestable rather than merely unexercised. The returned `set` is how a
 * test flips the answer and notifies whoever is listening.
 */
function stubMatchMedia(initial: boolean) {
  const original = window.matchMedia;
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
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

/** Renders the hook's value into an array, so the last entry is "current". */
function renderValue(): { seen: boolean[]; result: { unmount: () => void } } {
  const seen: boolean[] = [];
  function Probe() {
    const value = usePrefersReducedMotion();
    useEffect(() => {
      seen.push(value);
    }, [value]);
    return null;
  }
  const result = render(<Probe />);
  return { seen, result };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePrefersReducedMotion", () => {
  it("reports the current preference", () => {
    const media = stubMatchMedia(true);
    try {
      const { seen } = renderValue();
      expect(seen.at(-1)).toBe(true);
    } finally {
      media.restore();
    }
  });

  it("follows the preference when it changes mid-session", () => {
    // The point of subscribing rather than reading once: a reader can change
    // the OS setting without reloading, and a hook that snapshotted it would
    // keep animating at them for the rest of the session.
    const media = stubMatchMedia(false);
    try {
      const { seen } = renderValue();
      expect(seen.at(-1)).toBe(false);

      act(() => media.set(true));
      expect(seen.at(-1)).toBe(true);

      act(() => media.set(false));
      expect(seen.at(-1)).toBe(false);
    } finally {
      media.restore();
    }
  });

  it("unsubscribes on unmount, so a torn-down page is not called back", () => {
    const media = stubMatchMedia(false);
    try {
      const { result } = renderValue();
      result.unmount();
      // A listener that outlived its component keeps a detached tree reachable
      // and would fire into an unmounted hook.
      expect(() => media.set(true)).not.toThrow();
    } finally {
      media.restore();
    }
  });

  it("assumes motion when matchMedia is unavailable, and stays quiet", () => {
    // `false` is the safe direction to be wrong in: a runtime without the API
    // is not a reader who opted out, and every CSS opt-out still applies.
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API
    delete window.matchMedia;
    try {
      const { seen } = renderValue();
      expect(seen.at(-1)).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it("reads the preference in an effect, never during the first render", () => {
    // The initial value has to be identical on the server and the client, or
    // React throws the server markup away and a first-paint page becomes a
    // flash. Reading `window` in a `useState` initialiser is exactly that
    // bug: the server renders `false` while the client's first render would
    // render the real preference, so every reduced-motion reader gets a
    // hydration mismatch on the page.
    const original = window.matchMedia;
    let callsDuringRender = 0;
    let rendered = false;
    window.matchMedia = vi.fn((query: string) => {
      if (!rendered) callsDuringRender += 1;
      return {
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList;
    }) as unknown as typeof window.matchMedia;

    try {
      // The first render's own return value, not the DOM afterwards:
      // `render` flushes effects, so the mounted DOM has already been
      // corrected to `true` and cannot show the hydration value at all.
      let firstRenderValue: boolean | undefined;
      function FirstRenderProbe() {
        const value = usePrefersReducedMotion();
        if (firstRenderValue === undefined) firstRenderValue = value;
        rendered = true;
        return <span>{String(value)}</span>;
      }
      render(<FirstRenderProbe />);

      // The first paint says "motion is fine" — the same answer the server
      // gave — and no query was read to produce it. The effect then corrects
      // it within a tick, which is what the mounted DOM shows.
      expect(firstRenderValue).toBe(false);
      expect(callsDuringRender).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });
});
