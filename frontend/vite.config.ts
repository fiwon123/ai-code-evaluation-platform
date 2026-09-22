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
