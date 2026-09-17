import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSubmissionSocket } from "./useSubmissionSocket.ts";

const TOKEN_KEY = "access_token";

interface FakeMessageEvent {
  data: string;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: FakeMessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  closeFromServer() {
    this.onclose?.();
  }

  close() {
    this.onclose?.();
  }

  static reset() {
    FakeWebSocket.instances = [];
  }

  static latest(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
}

function submissionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    challenge_id: "c1",
    status: "pending",
    provider: "demo",
    code: null,
    score: null,
    evaluation_result: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useSubmissionSocket", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    localStorage.setItem(TOKEN_KEY, "jwt-token");
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.useRealTimers();
  });

  it("does not connect without a submission id", () => {
    const { result } = renderHook(() => useSubmissionSocket(undefined));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.state).toBe("closed");
    expect(result.current.liveSubmission).toBeNull();
  });

  it("does not connect without a stored token", () => {
    localStorage.removeItem(TOKEN_KEY);
    const { result } = renderHook(() => useSubmissionSocket("s1"));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.state).toBe("closed");
  });

  it("connects with the JWT as a query parameter and reports state", () => {
    const { result } = renderHook(() => useSubmissionSocket("s1"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.latest().url).toContain(
      "/api/ws/submissions/s1?token=jwt-token",
    );

    act(() => FakeWebSocket.latest().open());
    expect(result.current.state).toBe("open");
  });

  it("applies the snapshot message", () => {
    const { result } = renderHook(() => useSubmissionSocket("s1"));
    const snapshot = submissionFixture({ status: "processing" });

    act(() => FakeWebSocket.latest().open());
    act(() => FakeWebSocket.latest().message({ type: "snapshot", submission: snapshot }));

    expect(result.current.liveSubmission).toEqual(snapshot);
    expect(result.current.state).toBe("open");
  });

  it("merges status updates into the live submission", () => {
    const { result } = renderHook(() => useSubmissionSocket("s1"));

    act(() => FakeWebSocket.latest().open());
    act(() =>
      FakeWebSocket.latest().message({
        type: "snapshot",
        submission: submissionFixture({ status: "pending" }),
      }),
    );
    act(() => FakeWebSocket.latest().message({ type: "update", status: "completed" }));

    expect(result.current.liveSubmission?.status).toBe("completed");
    expect(result.current.liveSubmission?.id).toBe("s1");
    expect(result.current.liveSubmission?.provider).toBe("demo");
  });

  it("reconnects with capped exponential backoff after an unexpected close", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSubmissionSocket("s1"));
    act(() => FakeWebSocket.latest().open());
    expect(result.current.state).toBe("open");

    act(() => FakeWebSocket.latest().closeFromServer());
    expect(result.current.state).toBe("closed");
    expect(FakeWebSocket.instances).toHaveLength(1);

    // First reconnect after 1s.
    act(() => vi.advanceTimersByTime(1000));
    expect(FakeWebSocket.instances).toHaveLength(2);

    // Backoff doubles: the next reconnect is delayed by 2s.
    act(() => FakeWebSocket.latest().closeFromServer());
    act(() => vi.advanceTimersByTime(1500));
    expect(FakeWebSocket.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(500));
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after the hook unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useSubmissionSocket("s1"));
    act(() => FakeWebSocket.latest().open());

    unmount();
    act(() => FakeWebSocket.latest().closeFromServer());
    act(() => vi.advanceTimersByTime(30000));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});