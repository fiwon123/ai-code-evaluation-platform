import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const MEDIA = "(prefers-color-scheme: dark)";

/**
 * Resolve the initial theme:
 * 1. A stored preference in localStorage wins.
 * 2. Otherwise fall back to the OS color-scheme preference.
 * 3. Default to light when neither is available.
 */
export function resolveInitialTheme(storage?: Pick<Storage, "getItem">): Theme {
  const store = storage ?? window.localStorage;
  const stored = store.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  if (typeof window !== "undefined" && "matchMedia" in window) {
    return window.matchMedia(MEDIA).matches ? "dark" : "light";
  }
  return "light";
}

/**
 * Applies the theme to the <html> element as the `data-theme` attribute so
 * every CSS variable selector (`[data-theme="dark"]`, `:root, [data-theme="light"]`)
 * resolves correctly.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/**
 * Theme management hook — returns the current theme plus a toggle function.
 * Persists the user's choice to localStorage.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const setThemeExplicit = useCallback((next: Theme) => {
    setTheme(next);
  }, []);

  // Persist the resolved theme whenever it changes.
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return { theme, toggleTheme, setTheme: setThemeExplicit };
}
