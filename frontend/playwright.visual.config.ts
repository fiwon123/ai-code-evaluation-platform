import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the visual sweep.
 *
 * Separate from `playwright.config.ts` on purpose, in three ways that matter:
 *
 * 1. **It serves the production build.** `vite build` + `vite preview` on 4173,
 *    because a long-running dev server serves stale CSS modules — the trap
 *    recorded in this repo's own notes, and one that would make every capture
 *    show yesterday's stylesheet. `reuseExistingServer: false` is the point: an
 *    already-running preview on 4173 would be serving an older `dist`, so the
 *    build under review would not be the one photographed.
 * 2. **It collects only `*.visual.ts`.** The normal config's default
 *    `testMatch` (`*.spec.ts` / `*.test.ts`) cannot see these files, so the two
 *    suites cannot pick each other up, and `make test-e2e` stays exactly as it
 *    was. The vitest gate cannot either: `vite.config.ts` excludes `e2e/**`.
 * 3. **It pins the browser.** No `channel`, no `connectOverCDP`, no
 *    `launchPersistentContext`, no `headless: false` — the four routes to a
 *    host browser, a host profile or the operator's open tabs. Their absence is
 *    locked by `src/pages/visual-sweep.lock.test.ts` in `make check`, because a
 *    config that merely *looks* sandboxed is worth nothing. The runtime half is
 *    `checkBrowserProvenance`, which refuses to run unless the resolved
 *    executable is inside this project's browser root.
 *
 * The sweep is not in `make check` and not in CI: it needs the baked browser, and
 * it produces hundreds of files a reviewer has to look at, so it is a deliberate
 * act rather than a gate. Same reasoning as `make test-e2e`.
 */

const PORT = 4173;
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e/visual",
  // The `*.visual.ts` suffix is the whole isolation mechanism: the default
  // `**/*.@(spec|test).ts` cannot match it, so the normal config stays blind to
  // these files even though they sit in the same tree.
  testMatch: "**/*.visual.ts",
  fullyParallel: true,
  // The sweep is a review aid, not a gate, so a retry is spent on re-shooting
  // frames that a reviewer will read anyway. Retries would also double a run's
  // disk, which is the budget the output layout is built around.
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "visual-sweeps/manifest.parts/report.json" }]],
  // Under the run id, not beside it. A shared artifacts directory is deleted at
  // the start of every run, so two sweeps on one checkout erase each other's
  // error contexts — and the context is the page snapshot that explains a failed
  // state driver, which is exactly when a reviewer needs it most.
  outputDir: `visual-sweeps/${process.env.VISUAL_SWEEP_RUN ?? "local"}/.artifacts`,
  use: {
    baseURL: ORIGIN,
    // `animations: "disabled"` is deliberately NOT used, here or in the spec.
    // Playwright implements it by cancelling infinite animations, which would
    // drop the ambient layer to its unanimated style. The settle is done
    // explicitly in `helpers/motion.ts`, where it can be recorded.
    //
    // Trace and video are off: they are for debugging a *failure*, and a
    // screenshot harness that also writes a video per test doubles the output
    // for no review value.
    trace: "off",
    video: "off",
    launchOptions: {
      // Chromium's own sandbox cannot start in this container — it bootstraps
      // from an unprivileged user namespace, Docker's default seccomp profile
      // blocks `clone(CLONE_NEWUSER)`, and Chrome dropped the setuid sandbox in
      // v120, so there is no fallback. Same reasoning, and the same trade, as
      // `playwright.config.ts`: the only origin this sweep loads is its own
      // preview server, so renderer isolation buys little here.
      chromiumSandbox: process.env.CHROMIUM_SANDBOX === "1",
    },
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "pixel-7",
      // Pixel 7 rather than the generic Android profile: the AC calls for it and
      // its 412px width is the one that actually breaks layouts.
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: false,
    // A production build of 25 lazy chunks, on a container that may be running a
    // worker and a database. 60s (the e2e config's figure) is tight here.
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  globalTeardown: "./e2e/visual/teardown.visual.ts",
});
