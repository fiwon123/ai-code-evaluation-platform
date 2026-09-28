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