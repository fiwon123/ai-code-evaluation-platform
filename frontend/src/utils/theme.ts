/**
 * The theme contract, in one place.
 *
 * `public/theme-init.js` has to duplicate these three literals: it runs before
 * the bundle exists, as plain JavaScript in `<head>`, so it cannot import from
 * the app. `theme-init.test.ts` asserts the file and this module agree — that
 * test is the only thing keeping the two copies honest, so change both together.
 */
export type Theme = "light" | "dark";

/** `localStorage` key holding an explicit user choice. */
export const THEME_STORAGE_KEY = "theme";

/** Media query used when the user has not chosen a theme. */
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}
