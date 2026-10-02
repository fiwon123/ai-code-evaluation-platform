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
 *
 * Why `localhost` here is safe on a dual-stack host
 * -------------------------------------------------
 * `baseURL` and `webServer.url` both name `localhost`, and on this host that
 * resolves to `::1` first (RFC 6724). That is exactly the setup that made
 * `http://localhost:5173` fail in #282, when Vite bound `0.0.0.0` and nothing
 * listened on `[::1]`. The e2e suite was never affected, and the reason is
 * worth keeping in mind rather than rediscovering:
 *
 * - The readiness poll is Playwright's own client, not Node's default. Its
 *   `httpRequest()` spreads `happyEyeballsOptions`, whose `dualStackLookup`
 *   returns *both* families interleaved (v6 first) and sets
 *   `autoSelectFamily: true`, so Node races them (RFC 8305).
 * - The navigation is Chromium, which implements Happy Eyeballs natively.
 *
 * Both fall back from the refused `::1` to `127.0.0.1` immediately, because a
 * refused connect is instant rather than a timeout. Measured here against a
 * deliberately IPv4-only listener: poll returned `true` in 20ms, Chromium
 * returned HTTP 200 in 50ms. So #282's fix is still worth having (the URLs the
 * stack prints in its own banner are advertised to humans and tools alike), but
 * the e2e suite was relying on Happy Eyeballs, not on luck.
 *
 * This is also why the suite never reproduced the worker-side failure in
 * #274/#279: that one is a Python/httpcore path, and httpcore has no Happy
 * Eyeballs, so it dials only the first address and a blocked family looks
 * exactly like a bad API key. Locked by
 * `backend/tests/test_dev_sandbox_playwright.py::TestLocalhostDualStack`.
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
    // Video is OFF by default and switched on with E2E_VIDEO=1.
    //
    // A still frame is the wrong instrument for an animation: it cannot show a
    // sequence, an overlap, or whether a 10s loop reads as a smooth handoff or a
    // series of jumps. That is not hypothetical — the whole #353 pipeline defect
    // was *when* each card lit relative to the others, which a paused frame
    // cannot show at all, and the visual sweep (paused frames only) came back
    // clean on it.
    //
    // It stays opt-in because every test would record: the suite is ~260 tests
    // and a webm per test is hundreds of MB per run, which `make test-e2e`
    // should not silently start producing. Point a run at the recordings with
    // `PW_TEST_HTML_REPORT_OPEN=never` and read the .webm out of
    // `test-results/**/video.webm`; see e2e/motion-qa.spec.ts, which exists to
    // be recorded rather than asserted.
    //
    // No `size` override on purpose. Pinning one would scale-to-fit every
    // project into the same box, letterboxing the Pixel 7 profile — and a
    // letterboxed recording is how a mobile layout bug gets missed. Left unset,
    // each project records at its own viewport, which is the thing under review.
    ...(process.env.E2E_VIDEO === "1" ? { video: { mode: "on" as const } } : {}),
  },
  // `motion-qa.spec.ts` is not a test: it holds the page still for ~12s so the
  // recorder can capture a full pipeline cycle. Collected only alongside the
  // video, so `make test-e2e` never spends that wall-clock on it.
  testIgnore: process.env.E2E_VIDEO === "1" ? [] : ["**/motion-qa.spec.ts"],
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