import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;

/**
 * Playwright e2e configuration.
 *
 * - `webServer` boots the Vite dev server on :5173 (vite.config.ts pins
 *   port/host) and reuses an already-running server locally.
 * - The frontend talks to `http://localhost:8000/api/**`; those requests are
 *   intercepted in each spec via `mockApi` (see `e2e/data.ts`) so the suite
 *   runs fully offline without a backend.
 * - Two projects: desktop Chromium and an Android device profile (the AC
 *   requirement). Both share the `chromium` browser binary.
 * - The browser itself is baked into the dev image (see `Dockerfile`), so the
 *   suite runs via `make test-e2e` inside the sandbox. Nothing here downloads
 *   anything — the runtime user is non-root with no sudo and cannot install
 *   Chromium's system libraries.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // Chromium's own sandbox does not start in this container: it is
    // bootstrapped from an unprivileged user namespace, Docker's default seccomp
    // profile blocks `clone` with CLONE_NEWUSER, and Chrome dropped the older
    // setuid sandbox in v120, so there is no fallback. Verified in this image:
    // `chromium.launch({ chromiumSandbox: true })` fails with "Chromium
    // sandboxing failed!" while the same launch without it renders.
    //
    // This has to go in `launchOptions` — `chromiumSandbox` is a
    // BrowserType.launch() option, not a `use` option, and Playwright silently
    // ignores unknown `use` keys. Written as a bare `use.chromiumSandbox` the
    // suite type-checks nowhere (tsc rejects it) and, if it had been JS, would
    // have looked configured while doing nothing.
    //
    // The alternative — `seccomp: unconfined` on the `dev` service in
    // docker-compose.yml — would restore Chromium's sandbox but strip seccomp
    // filtering from the *whole* container: uvicorn, vite, the evaluation worker
    // and the sandboxed coding agent, in a container that also holds the Docker
    // socket and the bind-mounted workspace. Trading browser isolation in
    // exchange for agent isolation is the wrong direction, so the browser yields.
    //
    // What this does and does not expose: the suite only ever loads
    // http://localhost:5173 — our own Vite dev server — and every /api call is
    // fulfilled from `e2e/data.ts` fixtures. No third-party or untrusted origin is
    // ever rendered, so renderer isolation buys little here and its absence costs
    // nothing. Set CHROMIUM_SANDBOX=1 on a host that allows user namespaces (or run
    // the suite outside a container) to opt back in; the Dockerfile's launch check
    // honours the same variable, so the image stays verifiable either way.
    launchOptions: {
      chromiumSandbox: process.env.CHROMIUM_SANDBOX === "1",
    },
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});