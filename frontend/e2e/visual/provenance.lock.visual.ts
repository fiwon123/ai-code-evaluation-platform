import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test } from "@playwright/test";

import { buildContactSheets } from "./helpers/contact-sheet";
import { checkBrowserProvenance, findRepoRoot, resolveBrowserRoot } from "./helpers/provenance";

/**
 * Runtime locks: a capture is only evidence if it came from *this project's*
 * browser, from *this project's* tree, and if the parts of the run that are
 * merely convenient can fail without taking the run with them.
 *
 * The temptation is to lock this by grepping the config for `channel:`,
 * `connectOverCDP` and friends. That proves the word is absent from a text file
 * — not that the launched browser is ours — and it is the kind of check that
 * passes on a file it failed to read. (An earlier draft of this branch did
 * exactly that, and its comment stripper was quietly eating two thirds of the
 * file it claimed to inspect.)
 *
 * So the lock is behavioural: the real guard is fed paths it must refuse, and
 * the paths it must accept. A `channel: "chrome"` launch, a CDP attach or a
 * persistent profile all resolve to an executable *outside* the browser root, so
 * every one of them fails the same check — which is why the check, and not a
 * list of forbidden words, is the thing worth testing.
 */
test.describe("browser provenance", () => {
  test("accepts the browser this run will actually launch", () => {
    // The positive case first, because a guard that refuses everything is a
    // green suite and no captures.
    const provenance = checkBrowserProvenance(chromium.executablePath());
    expect(provenance.executablePath).toContain(provenance.root);
    expect(provenance.executablePath).toMatch(/chromium|headless/);
  });

  test("refuses a host browser", () => {
    // The four realistic ways a capture ends up made by something else.
    const hosts = [
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/opt/google/chrome/chrome",
      "/snap/bin/chromium",
    ];
    for (const executable of hosts) {
      expect(
        () => checkBrowserProvenance(executable),
        `accepted a host browser: ${executable}`,
      ).toThrow(/not the project's own/);
    }
  });

  test("refuses a sibling directory that shares the root's name", () => {
    // The prefix bug. A naive `startsWith("/ms-playwright")` accepts
    // `/ms-playwright-backup/chrome`, which is a perfectly ordinary path someone
    // could point PLAYWRIGHT_BROWSERS_PATH at. The guard compares the resolved
    // path plus a separator, and this is the test that says so.
    const root = resolveBrowserRoot().root;
    expect(() => checkBrowserProvenance(`${root}-backup/chrome`)).toThrow(/not the project's own/);
    expect(() => checkBrowserProvenance(`${root}_evil/chrome`)).toThrow(/not the project's own/);
  });

  test("refuses a traversal out of the root", () => {
    // `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright/../opt/…` must not launder an
    // executable past the check, because both sides are resolved first.
    const root = resolveBrowserRoot().root;
    expect(() => checkBrowserProvenance(`${root}/../../usr/bin/chromium`)).toThrow(
      /not the project's own/,
    );
  });

  test("prefers the image's pinned root over the host cache", () => {
    const { root, fromEnv } = resolveBrowserRoot();
    // In the sandbox this is `/ms-playwright` from the Dockerfile ENV; on a host
    // it is Playwright's own cache. Either way the manifest records which, and
    // the report quotes it — a run that cannot say where its browser came from
    // should not be trusted.
    expect(root.length).toBeGreaterThan(0);
    expect(root).toMatch(/ms-playwright/);
    if (fromEnv) {
      expect(root).toBe(fromEnv);
    }
  });

test.describe("the commit half of provenance", () => {
  test("finds the repo root from any depth", () => {
    // The manifest says "browser, commit, tree". It read the commit from
    // `resolve(cwd, "../..")`, which is the repo root only when the cwd happens
    // to be `frontend/`. The Makefile does `cd frontend`, so that looked safe —
    // and one level off is still a real directory, `git` simply fails there, and
    // the manifest recorded a null commit while the run reported success. A
    // capture that cannot name its commit is a capture nobody can re-derive.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const fromFrontend = findRepoRoot(resolve(here, "../../.."));
    const fromDeepInside = findRepoRoot(resolve(here, "../../src/hooks"));
    expect(fromFrontend).toBeTruthy();
    expect(fromDeepInside).toBe(fromFrontend);
    expect(existsSync(join(fromFrontend!, ".git"))).toBe(true);
    expect(existsSync(join(fromFrontend!, "frontend/package.json"))).toBe(true);
  });

  test("reports no repo root rather than inventing one", () => {
    // Nothing above /tmp is a repository. A harness that returned `/` here would
    // run `git` outside the project and record whatever commit it found.
    const outside = mkdtempSync(join(tmpdir(), "sweep-norepo-"));
    try {
      expect(findRepoRoot(outside)).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test.describe("degrading instead of failing", () => {
  test("no browser to tile with costs the contact sheets, not the run", async () => {
    // Tiling happens in the project's own browser because Playwright's bundled
    // ffmpeg cannot tile at all: it is a minimal build with `scale` and `pad` and
    // no `tile`, `hstack` or `overlay`, so a tiling filtergraph fails while
    // *parsing the option string*, before a single frame is read. The first
    // implementation did exactly that and its error path was the only thing that
    // noticed — the run reported success with no sheets behind it.
    const result = await buildContactSheets(
      resolve(fileURLToPath(new URL(".", import.meta.url)), "../visual-sweeps"),
      null,
    );
    expect(result.tiled).toEqual([]);
    expect(result.sheets).toBe(0);
    // The reason has to say the frames survive, because that is the question the
    // operator has at that moment.
    expect(result.reason).toMatch(/frame/i);
  });
});
});
