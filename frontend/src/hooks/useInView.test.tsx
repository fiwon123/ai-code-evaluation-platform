import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreMatchMedia, stubMatchMedia } from "../test/matchMedia.ts";
import { useInView } from "./useInView.ts";

/**
 * Records the elements it observes and lets a test drive intersection by hand,
 * which jsdom cannot do. The real thing has no such control, so this stands in
 * for the browser's callback.
 */
function mockObserver() {
  const observed = new Set<Element>();
  const callbacks = new Map<Element, IntersectionObserverCallback>();
  let disconnects = 0;

  class FakeObserver {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      observed.add(el);
      callbacks.set(el, this.cb);
    }
    disconnect() {
      // A real disconnect stops delivery. Counting them (rather than leaving a
      // stale map entry behind) is what lets the sticky test below prove the
      // hook stopped listening instead of merely ignoring what it still hears.
      disconnects += 1;
      observed.clear();
    }
    unobserve(el: Element) {
      observed.delete(el);
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  return {
    get disconnects() {
      return disconnects;
    },
    /** Delivers an intersection, but only if the observer is still listening. */
    deliver(el: Element, isIntersecting: boolean) {
      const cb = callbacks.get(el);
      if (!cb || !observed.has(el)) return false;
      act(() =>
        cb(
          [{ isIntersecting, target: el } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
      return true;
    },
  };
}

function Probe({ initiallyVisible }: { initiallyVisible?: boolean }) {
  const { ref, inView } = useInView<HTMLDivElement>({
    threshold: 0.15,
    initiallyVisible,
  });
  return (
    <div ref={ref} data-testid="probe">
      {inView ? "in" : "out"}
    </div>
  );
}

describe("useInView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreMatchMedia();
  });

  it("starts out of view and switches when the element intersects", () => {
    stubMatchMedia(false);
    const io = mockObserver();
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("out");
    expect(io.deliver(screen.getByTestId("probe"), true)).toBe(true);
    expect(screen.getByTestId("probe").textContent).toBe("in");
  });

  it("reports visible immediately for a reduced-motion reader", () => {
    // There is no sweep to defer, so gating it would only delay a value that
    // is already static.
    stubMatchMedia(true);
    mockObserver();
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("in");
  });

  it("reports visible when IntersectionObserver is unavailable", () => {
    stubMatchMedia(false);
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("in");
  });

  it("stops observing once seen, so the sweep cannot restart", () => {
    // One-way by design. The hook disconnects on the first intersection; if it
    // kept listening, scrolling back up and down would re-fire the gate and a
    // settled count-up would run again.
    stubMatchMedia(false);
    const io = mockObserver();
    const { rerender } = render(<Probe />);
    const el = screen.getByTestId("probe");
    expect(io.deliver(el, true)).toBe(true);
    expect(el.textContent).toBe("in");
    expect(io.disconnects, "the observer was never disconnected").toBe(1);
    // Delivery is refused from here on — the observer is genuinely detached.
    expect(io.deliver(el, false), "a detached observer still delivered").toBe(false);
    rerender(<Probe />);
    expect(el.textContent).toBe("in");
  });
});
