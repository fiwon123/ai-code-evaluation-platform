import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow } from "./useNow.ts";

const BASE_TIME = Date.parse("2026-01-01T00:00:00Z");

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current time immediately", () => {
    const { result } = renderHook(() => useNow(true, 50));
    expect(result.current).toBe(BASE_TIME);
  });

  it("updates on the interval while enabled", () => {
    const { result } = renderHook(() => useNow(true, 50));
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(BASE_TIME + 100);
  });

  it("stops updating once disabled", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useNow(enabled, 50),
      { initialProps: { enabled: true } },
    );
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(BASE_TIME + 100);

    rerender({ enabled: false });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe(BASE_TIME + 100);
  });

  it("cleans up the interval on unmount", () => {
    const { unmount } = renderHook(() => useNow(true, 50));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});