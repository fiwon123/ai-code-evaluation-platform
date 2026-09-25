/**
 * Minimal ambient declarations for the Node built-ins used by tests.
 *
 * `@types/node` is not a dependency of this project, and the app config sets
 * `types: ["vite/client", "vitest/globals"]`. Tests still legitimately need to
 * read files that Vite deliberately keeps out of the module graph — anything
 * under `public/`, which is copied verbatim to `dist` and therefore cannot be
 * imported with `?raw` (or reached with `import.meta.glob`).
 *
 * Only the surface actually used is declared, so this stays a shim rather than
 * a second type source. If `@types/node` is ever added, delete this file.
 */
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
}

/** Vitest injects CJS interop globals into the jsdom test environment. */
declare const __dirname: string;
