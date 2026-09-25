/*
 * Applies the stored theme before the first paint.
 *
 * Without this, `globals.css` paints the light palette (`:root` is the light
 * palette) and ThemeToggle's `useEffect` flips `<html data-theme>` only after
 * React hydrates — so every dark-mode user gets a flash of light on a cold
 * load. This runs synchronously in `<head>`, before the stylesheet is applied.
 *
 * It is a separate file on purpose: the production CSP is `script-src 'self'`
 * with no `'unsafe-inline'` (see nginx.conf, added in #185), so an inline
 * script here would be blocked. An external file served from the same origin
 * is allowed, and a plain (non-module) synchronous script in the head is
 * guaranteed to run before the first paint.
 *
 * Keep the literals below in sync with `src/utils/theme.ts`; the test
 * `theme-init.test.ts` asserts they match, and executes this file in jsdom to
 * prove each branch works.
 */
(function () {
  var STORAGE_KEY = "theme";
  var MEDIA = "(prefers-color-scheme: dark)";
  var root = document.documentElement;
  var theme = null;

  try {
    var stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      theme = stored;
    }
  } catch (error) {
    /* storage blocked (private mode, disabled cookies) — fall through to the
       system preference rather than leaving the attribute unset */
  }

  if (theme === null) {
    try {
      theme =
        typeof window.matchMedia === "function" && window.matchMedia(MEDIA).matches
          ? "dark"
          : "light";
    } catch (error) {
      theme = "light";
    }
  }

  // Always set the attribute, including for light: it makes the applied theme
  // explicit and keeps this in step with ThemeToggle, which writes both values.
  root.setAttribute("data-theme", theme);

  // Signals the app that the pre-paint pass already happened, so a future
  // flash-free check (or a test) can tell "applied early" from "applied late".
  root.setAttribute("data-theme-source", "init");
})();
