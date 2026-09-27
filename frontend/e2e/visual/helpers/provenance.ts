import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Browser provenance: prove *which* Chromium produced a capture.
 *
 * The operator's requirement is absolute — screenshots must come from this
 * project's own sandboxed browser, never from a host browser, a host profile or
 * a host's open tabs. Four things in Playwright can quietly break that, and each
 * has a lock behind it:
 *
 * | Route to a host browser | What it does |
 * |---|---|
 * | `channel: "chrome"` | runs the installed Google Chrome |
 * | `connectOverCDP` | attaches to an already-running browser |
 * | `launchPersistentContext` | reuses a profile directory |
 * | `headless: false` | shows a window, and with it the operator's desktop |
 *
 * There is no list of forbidden words here on purpose. All four of the above end
 * the same way: Playwright resolves an executable that is *not* under this
 * project's browser root. So the guard is that fact, checked on the resolved path
 * at run time — and the run aborts before the first frame rather than producing
 * a manifest that quietly names someone else's Chrome. `provenance.lock.visual.ts`
 * feeds it the paths it must refuse, including the sibling-directory prefix trap
 * and a `..` traversal, because a guard nobody has tried to defeat is a guard
 * nobody knows works.
 *
 * `/ms-playwright` is the root the dev image pins (`Dockerfile` sets
 * `PLAYWRIGHT_BROWSERS_PATH`), and it holds the baked `chromium-*` build, the
 * headless shell and ffmpeg. A host-native checkout has no such directory, so
 * the host's Playwright-managed cache is accepted as the root — note the
 * distinction: that is still a browser *this project* downloaded and controls,
 * not the operator's Chrome. What is refused is a root that is not
 * Playwright-managed, and any of the four tokens above.
 */

/** The root the dev image pins. Chosen to match the Dockerfile ENV exactly. */
export const SANDBOX_BROWSER_ROOT = "/ms-playwright";

/** Where Playwright keeps browsers on a host-native checkout. */
const HOST_BROWSER_ROOT = "~/.cache/ms-playwright";

export interface BrowserProvenance {
  /** The root the resolved executable was required to sit under. */
  root: string;
  /** `PLAYWRIGHT_BROWSERS_PATH` as seen by the run, or null if unset. */
  fromEnv: string | null;
  /** The executable Playwright will actually launch. */
  executablePath: string;
}

/** The browser root this run will insist on, and where it came from. */
export function resolveBrowserRoot(env: NodeJS.ProcessEnv = process.env): {
  root: string;
  fromEnv: string | null;
} {
  const fromEnv = env.PLAYWRIGHT_BROWSERS_PATH ?? null;
  if (fromEnv) {
    return { root: fromEnv, fromEnv };
  }
  if (existsSync(SANDBOX_BROWSER_ROOT)) {
    return { root: SANDBOX_BROWSER_ROOT, fromEnv: null };
  }
  return { root: resolve(HOST_BROWSER_ROOT.replace("~", process.env.HOME ?? "~")), fromEnv: null };
}

/**
 * Resolve the executable and refuse to continue unless it is inside the root.
 *
 * The comparison is on the *resolved* path on both sides, so a `..` in
 * `PLAYWRIGHT_BROWSERS_PATH` cannot smuggle an executable past the check, and a
 * symlinked root is compared after `realpath` so `/ms-playwright` reached via a
 * link still matches.
 */
export function checkBrowserProvenance(executablePath: string): BrowserProvenance {
  const { root, fromEnv } = resolveBrowserRoot();
  const rootReal = realish(root);
  const exeReal = realish(executablePath);

  if (!exeReal.startsWith(`${rootReal}/`) && exeReal !== rootReal) {
    throw new Error(
      [
        "Visual sweep aborts: the browser Playwright would launch is not the project's own.",
        `  executable : ${exeReal}`,
        `  required   : under ${rootReal}`,
        `  PLAYWRIGHT_BROWSERS_PATH: ${fromEnv ?? "(unset)"}`,
        "",
        "In the dev sandbox this is automatic (the image sets PLAYWRIGHT_BROWSERS_PATH).",
        "On a host, run `npx playwright install chromium` so the browser lives in a",
        "Playwright-managed root — the operator's own Chrome is not accepted, because",
        "a capture made by it would not be reproducible against this project.",
      ].join("\n"),
    );
  }

  return { root: rootReal, fromEnv, executablePath: exeReal };
}

/** `realpath` where it works, and the literal path where it does not. */
function realish(path: string): string {
  const absolute = path.startsWith("~")
    ? resolve(path.replace("~", process.env.HOME ?? "~"))
    : resolve(path);
  try {
    // A path that does not exist throws, which is exactly the case where there
    // is nothing to resolve and the literal path is the right answer.
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/**
 * Walk up from `from` until a `.git` entry appears.
 *
 * The teardown runs with whatever cwd Playwright was launched from — the
 * Makefile's `cd frontend`, but a hand-run may be from the repo root or anywhere
 * else — so the repo root is *found* rather than assumed as a fixed number of
 * `..`. A fixed `../..` looked right from `frontend/` and silently resolved one
 * level too high from the repo root, where `git rev-parse` fails and the
 * manifest records a null commit: a manifest that cannot say what produced it.
 */
export function findRepoRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
