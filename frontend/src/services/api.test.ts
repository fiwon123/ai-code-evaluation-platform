import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  api,
  authApi,
  challengesApi,
  clearToken,
  setToken,
  submissionsApi,
} from "./api.ts";

const fetchMock = vi.fn();

describe("api service", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it("sends a JSON body on POST with content-type header", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await api.post("/api/challenges", { title: "X" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/challenges",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ title: "X" }),
      }),
    );
  });

  it("includes the bearer token when one is stored", async () => {
    setToken("secret-token");
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await api.get("/api/challenges");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/api/challenges",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
  });

  it("omits the bearer header when no token is stored", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await api.get("/api/challenges");

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(options.headers)).not.toContain("Authorization");
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const result = await api.del("/api/challenges/abc");
    expect(result).toBeUndefined();
  });

  it("throws an ApiError with the server detail on failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Challenge not found" }), { status: 404 }),
    );

    await expect(api.get("/api/challenges/missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      detail: "Challenge not found",
    });
  });

  it("parses Pydantic 422 validation errors into a readable message + field map", async () => {
    const detail = [
      {
        type: "string_too_short",
        loc: ["body", "password"],
        msg: "String should have at least 8 characters",
        input: "test123",
        ctx: { min_length: 8 },
      },
      {
        type: "string_pattern_mismatch",
        loc: ["body", "email"],
        msg: "String should match pattern",
        input: "nope",
      },
    ];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail }), { status: 422 }),
    );

    const err = await api
      .post("/api/auth/register", { email: "nope", password: "test123" })
      .then(
        () => {
          throw new Error("expected rejection");
        },
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(422);
    expect(apiErr.detail).toContain("password: String should have at least 8 characters");
    expect(apiErr.detail).toContain("email: String should match pattern");
    expect(apiErr.validationErrors).toEqual({
      password: "String should have at least 8 characters",
      email: "String should match pattern",
    });
  });

  it("falls back to status text when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500, statusText: "Internal Server Error" }));

    await expect(api.get("/api/challenges")).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.detail.includes("500"),
    );
  });
});

describe("authApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it("registers a user and parses the token response", async () => {
    const body = {
      access_token: "jwt",
      token_type: "bearer",
      user: { id: "1", email: "a@b.co", username: "alice", created_at: "2026-01-01T00:00:00Z" },
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), { status: 201, headers: { "Content-Type": "application/json" } }),
    );

    const result = await authApi.register({
      email: "a@b.co",
      username: "alice",
      password: "password123",
    });

    expect(result.access_token).toBe("jwt");
    expect(result.user.username).toBe("alice");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/register"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("logs in with an identifier and password", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ access_token: "t", token_type: "bearer", user: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await authApi.login({ identifier: "alice", password: "password123" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/login"),
      expect.objectContaining({ body: JSON.stringify({ identifier: "alice", password: "password123" }) }),
    );
  });
});

describe("challengesApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it("creates a challenge with a POST to /api/challenges", async () => {
    const challenge = {
      id: "c1",
      title: "Two Sum",
      description: "d",
      prompt: "p",
      test_code: "",
      language: "python",
      owner_id: "u1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(challenge), { status: 201, headers: { "Content-Type": "application/json" } }),
    );

    const result = await challengesApi.create({
      title: "Two Sum",
      description: "d",
      prompt: "p",
    });

    expect(result.id).toBe("c1");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/challenges"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("deletes a challenge with a DELETE request", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await challengesApi.remove("c1");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/challenges/c1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

it("lists challenges with pagination and search query params", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], total: 0, page: 1, page_size: 12, pages: 0 }),
        { status: 200 },
      ),
    );

    await challengesApi.list({ page: 2, page_size: 12, search: "fizz", language: "python" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/challenges?page=2&page_size=12&search=fizz&language=python",
      ),
      expect.anything(),
    );
  });

  it("skips empty/undefined query params when listing challenges", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], total: 0, page: 1, page_size: 20, pages: 0 }),
        { status: 200 },
      ),
    );

    await challengesApi.list({ page: 1, search: "" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/challenges?page=1"),
      expect.anything(),
    );
    expect(
      (fetchMock.mock.calls.at(-1) as [string])[0],
    ).not.toContain("search");
  });

  it("updates a challenge with a PATCH request", async () => {
    const challenge = {
      id: "c1",
      title: "Two Sum II",
      description: "d",
      prompt: "p",
      test_code: "",
      language: "python",
      owner_id: "u1",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(challenge), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await challengesApi.update("c1", { title: "Two Sum II" });

    expect(result.title).toBe("Two Sum II");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/challenges/c1"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});

describe("submissionsApi", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    clearToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearToken();
  });

  it("creates a submission with a POST to /api/submissions", async () => {
    const submission = {
      id: "s1",
      challenge_id: "c1",
      status: "pending",
      provider: "demo",
      code: null,
      score: null,
      evaluation_result: null,
      created_at: "2026-01-01T00:00:00Z",
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(submission), { status: 201, headers: { "Content-Type": "application/json" } }),
    );

    const result = await submissionsApi.create({ challenge_id: "c1", provider: "demo" });

    expect(result.id).toBe("s1");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/submissions"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ challenge_id: "c1", provider: "demo" }),
      }),
    );
  });

  it("lists submissions via GET /api/submissions", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await submissionsApi.list();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/submissions"),
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("lists submissions with status + challenge filter params", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [], total: 0, page: 1, page_size: 20, pages: 0 }),
        { status: 200 },
      ),
    );

    await submissionsApi.list({ status: "completed", challenge_id: "c1" });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/api/submissions?status=completed&challenge_id=c1",
      ),
      expect.anything(),
    );
  });

  it("fetches a single submission via GET /api/submissions/:id", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "s1" }), { status: 200 }));

    await submissionsApi.get("s1");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/submissions/s1"),
      expect.objectContaining({
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });
});