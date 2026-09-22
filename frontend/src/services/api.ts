import type {
  AuthResponse,
  Challenge,
  ChallengeCreatePayload,
  ChallengeListParams,
  ChallengeUpdatePayload,
  ChangePasswordPayload,
  LoginPayload,
  PaginatedResponse,
  RegisterPayload,
  Submission,
  SubmissionCreatePayload,
  SubmissionListParams,
  User,
} from "../types.ts";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
const TOKEN_KEY = "access_token";

function buildQueryString(params?: object): string {
  if (!params) {
    return "";
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

/** Endpoints that legitimately return 401 for bad credentials (no redirect). */
const AUTH_CREDENTIAL_ENDPOINTS = new Set(["/api/auth/login", "/api/auth/register"]);

function isCredentialEndpoint(path: string): boolean {
  const basePath = path.split("?")[0];
  return AUTH_CREDENTIAL_ENDPOINTS.has(basePath);
}

/** Log the user out and send them to the login page when a session is rejected. */
function handleUnauthorized(path: string): void {
  // Login/register legitimately return 401 for wrong credentials; the page
  // shows the error inline instead of redirecting.
  if (isCredentialEndpoint(path)) {
    return;
  }
  clearToken();
  const isAlreadyOnLogin =
    typeof window !== "undefined" && window.location.pathname.startsWith("/login");
  if (!isAlreadyOnLogin) {
    window.location.assign("/login");
  }
}

export class ApiError extends Error {
  status: number;
  detail: string;
  /** Field-level validation messages (from Pydantic 422 responses). */
  validationErrors?: Record<string, string>;

  constructor(
    status: number,
    detail: string,
    validationErrors?: Record<string, string>,
  ) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.validationErrors = validationErrors;
  }
}

interface ValidationErrorItem {
  loc?: (string | number)[];
  msg?: string;
}

function parseValidationErrors(
  detail: unknown,
): { summary: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const messages: string[] = [];

  if (Array.isArray(detail)) {
    for (const item of detail) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const err = item as ValidationErrorItem;
      const field = Array.isArray(err.loc)
        ? String(err.loc[err.loc.length - 1] ?? "")
        : "";
      const msg =
        typeof err.msg === "string" ? err.msg : "Invalid value";
      if (field && field !== "body") {
        fieldErrors[field] = msg;
      }
      messages.push(field ? `${field}: ${msg}` : msg);
    }
  }

  return {
    summary: messages.length > 0 ? messages.join(". ") : "Invalid request",
    fieldErrors,
  };
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

async function fetchJson(path: string, options?: RequestInit): Promise<Response> {
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

  if (response.status === 401) {
    handleUnauthorized(path);
  }

  if (!response.ok) {
    let detail = `API error: ${response.status} ${response.statusText}`;
    let validationErrors: Record<string, string> | undefined;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (body.detail) {
        if (typeof body.detail === "string") {
          detail = body.detail;
        } else {
          const parsed = parseValidationErrors(body.detail);
          detail = parsed.summary;
          validationErrors = parsed.fieldErrors;
        }
      }
    } catch {
      // Non-JSON error body — fall back to the status text.
    }
    throw new ApiError(response.status, detail, validationErrors);
  }

  return response;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetchJson(path, options);
  return (await response.json()) as T;
}

async function requestNoContent(
  path: string,
  options?: RequestInit,
): Promise<void> {
  const response = await fetchJson(path, options);
  if (response.status !== 204) {
    // Drain any non-empty body (some implementations return 200 on DELETE).
    await response.json();
  }
}

export const api = {
  get: <T>(path: string, options?: RequestInit) => request<T>(path, options),
  post: <T>(path: string, body?: unknown, options?: RequestInit) =>
    request<T>(path, { ...options, method: "POST", body: JSON.stringify(body ?? {}) }),
  postNoContent: (path: string, body?: unknown, options?: RequestInit) =>
    requestNoContent(path, {
      ...options,
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  patch: <T>(path: string, body: unknown, options?: RequestInit) =>
    request<T>(path, { ...options, method: "PATCH", body: JSON.stringify(body) }),
  del: (path: string, options?: RequestInit) =>
    requestNoContent(path, { ...options, method: "DELETE" }),
};

export const authApi = {
  register: (payload: RegisterPayload) =>
    api.post<AuthResponse>("/api/auth/register", payload),
  login: (payload: LoginPayload) =>
    api.post<AuthResponse>("/api/auth/login", payload),
  me: () => api.get<User>("/api/auth/me"),
  changePassword: (payload: ChangePasswordPayload) =>
    api.postNoContent("/api/auth/change-password", payload),
};

export const challengesApi = {
  list: (params?: ChallengeListParams, options?: RequestInit) =>
    api.get<PaginatedResponse<Challenge>>(
      `/api/challenges${buildQueryString(params)}`,
      options,
    ),
  create: (payload: ChallengeCreatePayload) =>
    api.post<Challenge>("/api/challenges", payload),
  get: (id: string) => api.get<Challenge>(`/api/challenges/${id}`),
  update: (id: string, payload: ChallengeUpdatePayload) =>
    api.patch<Challenge>(`/api/challenges/${id}`, payload),
  remove: (id: string) => api.del(`/api/challenges/${id}`),
};

export const submissionsApi = {
  create: (payload: SubmissionCreatePayload) =>
    api.post<Submission>("/api/submissions", payload),
  list: (params?: SubmissionListParams, options?: RequestInit) =>
    api.get<PaginatedResponse<Submission>>(
      `/api/submissions${buildQueryString(params)}`,
      options,
    ),
  get: (id: string) => api.get<Submission>(`/api/submissions/${id}`),
};