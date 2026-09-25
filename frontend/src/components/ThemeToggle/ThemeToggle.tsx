import { useEffect, useRef, useState } from "react";
import { isTheme, THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from "../../utils/theme.ts";
import type { Theme } from "../../utils/theme.ts";
import styles from "./ThemeToggle.module.css";

// The pre-paint pass in `public/theme-init.js` has already resolved and applied
// the theme by the time this component mounts; this only keeps React's copy in
// step and persists explicit choices. The literals it needs live in
// `src/utils/theme.ts` so the two implementations cannot drift.

function systemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia(THEME_MEDIA_QUERY).matches ? "dark" : "light";
  }
  return "light";
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function initialTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window === "undefined" ? "light" : initialTheme(),
  );
  const mounted = useRef(false);

  // Apply the theme to <html> and persist it.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
  }, [theme]);

  // Sync the toggle whenever the stored/system theme changes externally
  // (e.g. from another tab).
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(THEME_MEDIA_QUERY);
    function sync() {
      const stored = storedTheme();
      // Only follow the system when the user hasn't chosen explicitly.
      if (!stored) {
        setTheme(systemTheme());
      }
    }
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // Skip the initial mount animation when the page loads.
  useEffect(() => {
    const id = window.setTimeout(() => {
      mounted.current = true;
    }, 300);
    return () => window.clearTimeout(id);
  }, []);

  function toggle() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  const next = theme === "light" ? "dark" : "light";

  return (
    <button
      type="button"
      className={`${styles.toggle} ${mounted.current ? styles.animate : ""}`}
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <span className={styles.icon}>
        {theme === "light" ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
