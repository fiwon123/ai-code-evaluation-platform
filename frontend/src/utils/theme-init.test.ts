/**
 * The pre-paint theme script, executed for real.
 *
 * `public/theme-init.js` runs in `<head>` before the stylesheet applies, which
 * is the only reason a dark-theme user sees no light flash. It cannot be a
 * component: it has to exist before React does. So instead of trusting it, this
 * test loads the file and runs it against a stubbed `document`/`localStorage`
 * for every branch, then checks the two things that can silently rot — the
 * literals drifting from `src/utils/theme.ts`, and `index.html` ceasing to load
 * it synchronously.
 *
 * Reading it needs `node:fs`: Vite excludes `public/` from the module graph on
 * purpose (those files are copied verbatim to `dist`), so neither `?raw` nor
 * `import.meta.glob` can reach it. See `src/test/node-builtins.d.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_MEDIA_QUERY, THEME_STORAGE_KEY } from "./theme.ts";

const ROOT = join(__dirname, "..", "..");
const SCRIPT = readFileSync(join(ROOT, "public", "theme-init.js"), "utf8");
const INDEX_HTML = readFileSync(join(ROOT, "index.html"), "utf8");

/** Run the script against the live jsdom document. */
function run(): void {
  // eslint-disable-next-line no-new-func -- executing the shipped file is the point
  new Function(SCRIPT)();
}

function stubMatchMedia(matches: boolean | undefined): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value:
      matches === undefined
        ? undefined
        : vi.fn().mockImplementation((query: string) => ({
            matches,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          })),
  });
}

describe("public/theme-init.js", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-source");
    vi.restoreAllMocks();
    stubMatchMedia(false);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-source");
    vi.restoreAllMocks();
  });

  it("applies the stored dark theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies the stored light theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    stubMatchMedia(true); // a dark system must not win over an explicit choice
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("applies an explicit attribute for light, not just dark", () => {
    run();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("falls back to the system preference when nothing is stored", () => {
    stubMatchMedia(true);
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores a nonsense stored value and uses the system preference", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "chartreuse");
    stubMatchMedia(true);
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("survives blocked storage and still paints something", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    stubMatchMedia(true);
    expect(() => run()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("survives a missing matchMedia", () => {
    stubMatchMedia(undefined);
    expect(() => run()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("marks that the early pass ran", () => {
    run();
    expect(document.documentElement.dataset.themeSource).toBe("init");
  });
});

describe("pre-paint script wiring", () => {
  it("uses the same storage key and media query as the app", () => {
    // The two implementations cannot import each other (one is plain JS that
    // runs before the bundle exists), so these literals are the contract.
    expect(SCRIPT).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(SCRIPT).toContain(`"${THEME_MEDIA_QUERY}"`);
  });

  it("writes data-theme on the document element", () => {
    expect(SCRIPT).toContain("data-theme");
    expect(SCRIPT).toMatch(/documentElement/);
  });

  it("is loaded from index.html synchronously, in the head, before the bundle", () => {
    const tag = INDEX_HTML.match(/<script[^>]*theme-init[^>]*>/)?.[0];
    expect(tag, "index.html must load /theme-init.js").toBeDefined();

    // `type="module"`, `defer` and `async` are all deferred by definition, which
    // is exactly the bug this script exists to fix.
    expect(tag).not.toMatch(/type="module"/);
    expect(tag).not.toMatch(/\bdefer\b/);
    expect(tag).not.toMatch(/\basync\b/);
    expect(tag).toMatch(/src="\/theme-init\.js"/);

    const head = INDEX_HTML.slice(0, INDEX_HTML.indexOf("</head>"));
    const bundle = INDEX_HTML.match(/<script[^>]*src="\/src\/main\.tsx"/);
    expect(INDEX_HTML.indexOf("theme-init.js")).toBeLessThan(
      bundle ? INDEX_HTML.indexOf(bundle[0]) : Number.MAX_SAFE_INTEGER,
    );
    expect(head).toContain("theme-init.js");
  });

  it("stays an external file so `script-src 'self'` keeps working", () => {
    // The production CSP is `script-src 'self'` (nginx.conf, #185). An inline
    // script here would be blocked, and the policy must not be weakened with
    // 'unsafe-inline' to accommodate this file.
    expect(SCRIPT).not.toContain("</script");
    expect(INDEX_HTML).not.toMatch(/<script(?![^>]*src=)[^>]*>[\s\S]*?theme/);
  });
});
