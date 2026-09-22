import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./AuthContext.tsx";

const fetchMock = vi.fn();

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("starts unauthenticated with no stored token", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("registers a user, stores the token, and sets the user", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "jwt-token",
          token_type: "bearer",
          user: { id: "u1", email: "a@b.co", username: "alice", is_admin: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.register("a@b.co", "alice", "password123");
    });

    expect(result.current.token).toBe("jwt-token");
    expect(result.current.user?.username).toBe("alice");
    expect(localStorage.getItem("access_token")).toBe("jwt-token");
  });

  it("logs out and clears the stored token", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "jwt-token",
          token_type: "bearer",
          user: { id: "u1", email: "a@b.co", username: "alice", is_admin: false, is_active: true, created_at: "2026-01-01T00:00:00Z" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.login("alice", "password123");
    });
    expect(result.current.token).toBe("jwt-token");

    act(() => {
      result.current.logout();
    });
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem("access_token")).toBeNull();
  });

  it("hydrates the user from a stored token on mount", async () => {
    localStorage.setItem("access_token", "stored-jwt");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ id: "u1", email: "a@b.co", username: "alice", is_admin: false, is_active: true, created_at: "2026-01-01T00:00:00Z" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.username).toBe("alice"));
    expect(result.current.token).toBe("stored-jwt");
  });

  it("clears an invalid stored token during hydration", async () => {
    localStorage.setItem("access_token", "expired-jwt");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: "Invalid token" }), { status: 401 }));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(localStorage.getItem("access_token")).toBeNull();
  });
});