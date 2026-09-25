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

  it("merges the phase alongside a processing update", () => {
    const { result } = renderHook(() => useSubmissionSocket("s1"));

    act(() => FakeWebSocket.latest().open());
    act(() =>
      FakeWebSocket.latest().message({
        type: "snapshot",
        submission: submissionFixture({ status: "processing", phase: "generating" }),
      }),
    );
    act(() =>
      FakeWebSocket.latest().message({
        type: "update",
        status: "processing",
        phase: "testing",
      }),
    );

    expect(result.current.liveSubmission?.status).toBe("processing");
    expect(result.current.liveSubmission?.phase).toBe("testing");
  });

  it("ignores updates whose status is not a valid SubmissionStatus", () => {
    const { result } = renderHook(() => useSubmissionSocket("s1"));

    act(() => FakeWebSocket.latest().open());
    act(() =>
      FakeWebSocket.latest().message({
        type: "snapshot",
        submission: submissionFixture({ status: "processing", phase: "generating" }),
      }),
    );
    act(() =>
      FakeWebSocket.latest().message({ type: "update", status: "code_generated" }),
    );

    // The stray event must not corrupt the client state — a "code_generated"
    // status would previously blank the page into a false failure.
    expect(result.current.liveSubmission?.status).toBe("processing");
    expect(result.current.liveSubmission?.phase).toBe("generating");
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

/**
 * Socket base resolution (issue #185). `webSocketBase()` reads the build-time
 * env, so each variant re-imports the hook with the env stubbed in place.
 */
describe("useSubmissionSocket base URL", () => {
  beforeEach(() => {
    FakeWebSocket.reset();
    localStorage.setItem(TOKEN_KEY, "jwt-token");
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function socketUrlWith(
    env: Record<string, string | undefined>,
  ): Promise<string> {
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value as string);
    }
    const fresh = await import("./useSubmissionSocket.ts");
    renderHook(() => fresh.useSubmissionSocket("s1"));
    return FakeWebSocket.latest().url;
  }

  it("connects to the absolute dev origin when VITE_API_URL is unset", async () => {
    const url = await socketUrlWith({ VITE_API_URL: undefined });
    expect(url).toBe("ws://localhost:8000/api/ws/submissions/s1?token=jwt-token");
  });

  it("resolves a /api base against the page origin without duplicating the prefix", async () => {
    // The production image bakes VITE_API_URL=/api; the old scheme swap was a
    // no-op there, so the socket got a relative URL and never upgraded.
    const url = await socketUrlWith({ VITE_API_URL: "/api" });
    expect(url).toBe(`${window.location.origin.replace(/^http/, "ws")}/api/ws/submissions/s1?token=jwt-token`);
    expect(url).not.toContain("/api/api/");
  });

  it("rewrites an https base to wss", async () => {
    const url = await socketUrlWith({ VITE_API_URL: "https://api.example.com" });
    expect(url).toBe("wss://api.example.com/api/ws/submissions/s1?token=jwt-token");
  });

  it("honours an explicit VITE_WS_URL override", async () => {
    const url = await socketUrlWith({
      VITE_API_URL: "/api",
      VITE_WS_URL: "wss://sockets.example.com",
    });
    expect(url).toBe("wss://sockets.example.com/api/ws/submissions/s1?token=jwt-token");
  });
});
