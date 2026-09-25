import { describe, expect, it } from "vitest";
import { joinApiUrl, toWebSocketBase } from "./apiUrl.ts";

describe("joinApiUrl", () => {
  it("returns the path untouched for an empty (same-origin) base", () => {
    expect(joinApiUrl("", "/api/challenges")).toBe("/api/challenges");
  });

  it("treats a bare slash as an empty base", () => {
    expect(joinApiUrl("/", "/api/challenges")).toBe("/api/challenges");
  });

  it("prepends an absolute origin", () => {
    expect(joinApiUrl("http://localhost:8000", "/api/challenges")).toBe(
      "http://localhost:8000/api/challenges",
    );
  });

  it("strips trailing slashes from the base", () => {
    expect(joinApiUrl("http://localhost:8000/", "/api/challenges")).toBe(
      "http://localhost:8000/api/challenges",
    );
    expect(joinApiUrl("/api/", "/api/challenges")).toBe("/api/challenges");
  });

  it("does not duplicate the prefix for a path-prefix base", () => {
    // The production image bakes VITE_API_URL=/api; naive concatenation
    // produced /api/api/... and every request 404'd.
    expect(joinApiUrl("/api", "/api/challenges")).toBe("/api/challenges");
    expect(joinApiUrl("/api", "/api/submissions/abc/share")).toBe(
      "/api/submissions/abc/share",
    );
  });

  it("still prepends the prefix for paths outside it", () => {
    expect(joinApiUrl("/api", "/health")).toBe("/api/health");
  });

  it("matches the prefix exactly as well as by segment", () => {
    expect(joinApiUrl("/api", "/api")).toBe("/api");
    // "/apix" is not a child of the "/api" prefix, so nothing is stripped.
    expect(joinApiUrl("/api", "/apix")).toBe("/api/apix");
  });

  it("keeps the origin and drops the repeat for an absolute prefixed base", () => {
    expect(joinApiUrl("https://api.example.com/api", "/api/challenges")).toBe(
      "https://api.example.com/api/challenges",
    );
  });

  it("preserves query strings and the websocket scheme", () => {
    expect(
      joinApiUrl("/api", "/api/submissions/comparison?challenge_id=c1"),
    ).toBe("/api/submissions/comparison?challenge_id=c1");
    expect(joinApiUrl("ws://host/api", "/api/ws/submissions/s1")).toBe(
      "ws://host/api/ws/submissions/s1",
    );
    expect(joinApiUrl("ws://host", "/api/ws/submissions/s1")).toBe(
      "ws://host/api/ws/submissions/s1",
    );
  });
});

describe("toWebSocketBase", () => {
  it("rewrites an absolute http origin to ws", () => {
    expect(toWebSocketBase("http://localhost:8000", "http://localhost:5173")).toBe(
      "ws://localhost:8000",
    );
  });

  it("rewrites an absolute https origin to wss", () => {
    expect(toWebSocketBase("https://api.example.com", "https://app.example.com")).toBe(
      "wss://api.example.com",
    );
  });

  it("leaves an already-websocket base untouched", () => {
    expect(toWebSocketBase("wss://api.example.com", "https://app.example.com")).toBe(
      "wss://api.example.com",
    );
  });

  it("resolves a path-prefix base against the page origin", () => {
    // The production image uses "/api" — a no-op scheme swap produced an
    // invalid socket URL, so live updates silently fell back to polling.
    expect(toWebSocketBase("/api", "https://app.example.com")).toBe(
      "wss://app.example.com/api",
    );
  });

  it("resolves an empty base to the page origin", () => {
    expect(toWebSocketBase("", "http://localhost:5173")).toBe("ws://localhost:5173");
  });

  it("strips trailing slashes on both inputs", () => {
    expect(toWebSocketBase("https://app.example.com/", "https://app.example.com")).toBe(
      "wss://app.example.com",
    );
  });
});
