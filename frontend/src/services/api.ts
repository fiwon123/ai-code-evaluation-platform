import type {
  AuthResponse,
  Challenge,
  ChallengeCreatePayload,
  LoginPayload,
  RegisterPayload,
  Submission,
  SubmissionCreatePayload,
  User,
} from "../types.ts";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const TOKEN_KEY = "access_token";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let detail = `API error: ${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (body.detail) {
        detail =
          typeof body.detail === "string"
            ? body.detail
            : JSON.stringify(body.detail);
      }
    } catch {
      // Non-JSON error body — fall back to the status text.
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export const authApi = {
  register: (payload: RegisterPayload) =>
    api.post<AuthResponse>("/api/auth/register", payload),
  login: (payload: LoginPayload) =>
    api.post<AuthResponse>("/api/auth/login", payload),
  me: () => api.get<User>("/api/auth/me"),
};

export const challengesApi = {
  list: () => api.get<Challenge[]>("/api/challenges"),
  create: (payload: ChallengeCreatePayload) =>
    api.post<Challenge>("/api/challenges", payload),
  get: (id: string) => api.get<Challenge>(`/api/challenges/${id}`),
  remove: (id: string) => api.del<void>(`/api/challenges/${id}`),
};

export const submissionsApi = {
  create: (payload: SubmissionCreatePayload) =>
    api.post<Submission>("/api/submissions", payload),
  list: () => api.get<Submission[]>("/api/submissions"),
  get: (id: string) => api.get<Submission>(`/api/submissions/${id}`),
};