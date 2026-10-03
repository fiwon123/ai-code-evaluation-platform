import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useCountUp } from "./useCountUp.ts";

describe("useCountUp", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts at 0 and reaches the target", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountUp(100, 1000));

    expect(result.current).toBe(0);

    // Advance in chunks to let the interval-based fallback fire.
    for (let i = 0; i < 80; i++) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    expect(result.current).toBe(100);
  });

  it("returns the target immediately under reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    const { result } = renderHook(() => useCountUp(42, 500));
    expect(result.current).toBe(42);
  });

  it("counts up from `from` rather than from zero", () => {
    // The Home hero's ring climbs 33 → 67 → 100 without rewinding, so the
    // second count starts where the first one stopped. Getting this wrong is
    // invisible in isolation and obvious in the panel: 33 → 0 → 67.
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ target, from }: { target: number; from: number }) =>
        useCountUp(target, 1000, 0, from),
      { initialProps: { target: 67, from: 33 } },
    );

    expect(result.current, "it starts at the number already on screen").toBe(33);
    for (let i = 0; i < 80; i++) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
    }
    expect(result.current).toBe(67);

    // And it never passes through zero on the way, whatever the size of the jump.
    rerender({ target: 100, from: 67 });
    const seen: number[] = [result.current];
    for (let i = 0; i < 80; i++) {
      act(() => {
        vi.advanceTimersByTime(16);
      });
      seen.push(result.current);
    }
    expect(result.current).toBe(100);
    expect(Math.min(...seen)).toBeGreaterThan(60);
  });

  it("holds `from` through the start delay, then counts", () => {
    // The ring's shake is a delay, and the number has to sit at the value it
    // already showed for its duration. Restarting from zero here would put the
    // digits back to the start of the scale mid-beat.
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountUp(100, 500, 300, 40));

    expect(result.current).toBe(40);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current, "still holding through the shake").toBe(40);
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(result.current, "moving once the shake is over").toBeGreaterThan(40);
  });

  it("returns the target after a start delay", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCountUp(10, 300, 200));
    expect(result.current).toBe(0);

    // Before the delay elapses the value should still be 0.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(0);
  });
});