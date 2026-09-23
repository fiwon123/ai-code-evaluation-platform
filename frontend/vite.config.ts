/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Vite 8.3.0's non-bundled dev client fails to replace the
  // __SERVER_FORWARD_CONSOLE__ placeholder, blanking the page at :5173.
  // Enable the bundled dev client (the supported Vite 8 path) for dev/build.
  // Excluded in Vitest (`mode === "test"`): bundledDev breaks the SSR/rolldown
  // transform pipeline used by the test runner (see issue #107).
  ...(mode !== "test"
    ? {
        experimental: {
          bundledDev: true,
        },
      }
    : {}),
  // Defense-in-depth for the non-bundled client path (upstream vite bug, see
  // vitejs/vite#22419): if the dev server ever runs without bundledDev, the
  // raw client.mjs hits `__SERVER_FORWARD_CONSOLE__` unreplaced and throws.
  // The `define` mechanism reliably replaces the token via __DEFINES__ and is
  // inert in bundled mode (clientInjectionsPlugin is excluded there, see
  // vitejs/vite#22012) and in build/test (these tokens never appear in app
  // source). `false` short-circuits setupForwardConsoleHandler, preserving the
  // default disabled forwardConsole behavior.
  define: {
    __BUNDLED_DEV__: "false",
    __SERVER_FORWARD_CONSOLE__: "false",
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
}));
