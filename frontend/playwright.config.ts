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