/**
 * URL resolution for the API client and the live-updates socket.
 *
 * The app talks to the backend through one configurable base — the
 * `VITE_API_URL` build-time variable — while every request path in this
 * codebase already starts with `/api/...` (the router is mounted at `/api`).
 * That combination makes the base ambiguous:
 *
 * | `VITE_API_URL`              | meaning                                            |
 * |-----------------------------|----------------------------------------------------|
 * | unset                       | absolute dev origin `http://localhost:8000`        |
 * | `""` (empty)                | same-origin, browser resolves `/api/...`            |
 * | `"/api"`                    | same-origin path prefix (the production image)     |
 * | `"https://host"`            | absolute origin, requests go straight there         |
 * | `"https://host/api"`        | absolute origin that already carries the prefix    |
 *
 * Naive concatenation (`${base}${path}`) breaks the middle two cases — the
 * built SPA would request `/api/api/...` and every call would 404. These
 * helpers make the join idempotent: a prefix already present in the path is
 * never repeated.
 */

/** Absolute `scheme://authority` prefix of a base URL, or `""` when relative. */
const ORIGIN_RE = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i;
/** Bases that already carry a transport scheme we can use or rewrite. */
const ABSOLUTE_BASE_RE = /^(?:https?|wss?):\/\//i;

/** Strip surrounding whitespace and any trailing slashes (`/api/` -> `/api`). */
function trimBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

/**
 * Join an API base with an API path without ever duplicating the prefix.
 *
 * `path` is expected to be a root-relative API path (`/api/...`). When the base
 * is a path prefix and the path already starts with it, the prefix is dropped
 * (relative base) or the origin alone is prepended (absolute base). Otherwise
 * the base is prepended verbatim.
 */
export function joinApiUrl(base: string, path: string): string {
  const trimmed = trimBase(base);
  if (trimmed === "") {
    // Same-origin: let the browser resolve the path against the page.
    return path;
  }

  const match = ORIGIN_RE.exec(trimmed);
  const origin = match ? match[1] : "";
  const basePath = trimBase(match ? match[2] : trimmed);

  if (basePath !== "" && (path === basePath || path.startsWith(`${basePath}/`))) {
    // The path already includes the prefix — keep the origin, drop the repeat.
    return `${origin}${path}`;
  }

  return `${trimmed}${path}`;
}

/**
 * Derive the WebSocket base for a subscription socket.
 *
 * - absolute `http(s)://` base: rewrite the scheme (`ws://` / `wss://`);
 * - absolute `ws(s)://` base: used as-is;
 * - relative or empty base (the production `/api` form): resolve against the
 *   page origin with a WebSocket scheme, then keep the prefix.
 */
export function toWebSocketBase(base: string, pageOrigin: string): string {
  const trimmed = trimBase(base);
  if (ABSOLUTE_BASE_RE.test(trimmed)) {
    // `http` -> `ws`, `https` -> `wss`; already-ws bases stay untouched.
    return trimmed.replace(/^http/i, "ws");
  }
  const origin = trimBase(pageOrigin).replace(/^http/i, "ws");
  return `${origin}${trimmed}`;
}

/** The configured API base, or the Vite dev-server fallback when unset. */
export function getApiBase(): string {
  // `??` (not `||`) so an explicitly empty VITE_API_URL means "same-origin"
  // instead of silently falling back to the dev origin.
  return import.meta.env.VITE_API_URL ?? "http://localhost:8000";
}

/** Full URL for an API request, prefix-safe for every base form. */
export function apiUrl(path: string): string {
  return joinApiUrl(getApiBase(), path);
}

/** WebSocket base for live updates, prefix-safe for every base form. */
export function webSocketBase(pageOrigin: string): string {
  return import.meta.env.VITE_WS_URL || toWebSocketBase(getApiBase(), pageOrigin);
}
