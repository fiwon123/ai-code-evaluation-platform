import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { chromium, type Browser } from "@playwright/test";

import {
  FINDINGS_PATH,
  MANIFEST_PATH,
  OUT_ROOT,
  PARTS_DIR,
  RUN_ID,
  type SweepPart,
} from "./manifest";
import { AUDIT_RULES, type Finding } from "./helpers/audit";
import { buildContactSheets, type ContactSheets } from "./helpers/contact-sheet";
import {
  SWEEP_MOTION,
  SWEEP_ROUTES,
  SWEEP_SCROLL_OFFSETS,
  SWEEP_STATES,
  SWEEP_THEMES,
  SWEEP_VIEWPORTS,
} from "./routes";
import { findRepoRoot } from "./helpers/provenance";

/**
 * Global teardown: merge, audit, contact sheets, manifest.
 *
 * A run is only useful if it can say what produced it. This writes the
 * provenance line the report quotes — Chromium version, the resolved executable
 * path, the viewport and theme of every frame, the commit under test, and the
 * counts — so a capture can be traced to a browser and a tree, and so a
 * suspicious image can be reproduced rather than argued about.
 *
 * **The audits live here, not in the spec.** `fullyParallel` gives Playwright no
 * ordering guarantee, so a test that asserts "a frame exists" or "a contact sheet
 * was built" can be scheduled *before* the tests that produce them, and then fail
 * a perfectly good run — or, worse, pass by accident in a run where a worker
 * crashed. Teardown runs after every worker has exited, so an audit here inspects
 * the finished run by construction. That ordering guarantee is the whole reason
 * these checks are here rather than in `sweep.visual.ts`.
 */
const run = promisify(execFile);

// `OUT_ROOT`, `PARTS_DIR` and `MANIFEST_PATH` come from `./manifest`: the spec
// writes its parts where that module says, so a divergence here is a compile
// error rather than an empty merge reported as a clean run.

/**
 * Whether this invocation is a full sweep or a targeted run of the locks.
 *
 * `make visual-sweep` sets it, and only then are the frame-count audits
 * binding. Without it, `npx playwright test … provenance.lock` is a normal thing
 * to do while working on the harness — and a teardown that demanded 300 frames
 * from that would be a guard that punishes the act of checking the guard.
 */
const REQUIRED = process.env.VISUAL_SWEEP_REQUIRE_FRAMES === "1";

/**
 * The part file is `SweepPart`, imported rather than redeclared.
 *
 * The local copy typed `settle` as `Record<string, unknown>`, which accepts any
 * field and reads back as `unknown` — so a new settle finding could be written
 * by the spec and silently dropped by the manifest, with the type system
 * reporting success on both sides. Reading the spec's own type makes that a
 * compile error instead.
 */
type Part = SweepPart;

export default async function globalTeardown(): Promise<void> {
  const partsDir = PARTS_DIR;
  const parts: Part[] = [];

  if (existsSync(partsDir)) {
    for (const entry of (await readdir(partsDir)).sort()) {
      if (!entry.endsWith(".json")) continue;
      parts.push(JSON.parse(await readFile(join(partsDir, entry), "utf8")) as Part);
    }
  }

  if (parts.length === 0) {
    if (REQUIRED) {
      // A full sweep with no parts means every worker died before writing one,
      // and a manifest of zero frames would be a cheerful report of a run that
      // never happened. Say so loudly instead.
      throw new Error(
        `visual sweep: no manifest parts under ${partsDir} — every worker failed before ` +
          "writing one. Read the run output; there is nothing to review.",
      );
    }
    // A targeted run of the lock files captures nothing by design, so there is
    // nothing to merge and nothing to audit. Not a failure.
    process.stdout.write("visual sweep: no capture workers ran; skipping the manifest.\n");
    return;
  }

  const frames = parts.flatMap((part) => part.frames);
  const browser = parts.find((part) => part.browser)?.browser ?? null;

  // The commit is the other half of "what produced this". Best effort: a shallow
  // clone or a tarball export has no HEAD, and a missing commit should not cost
  // the run its manifest.
  let commit: string | null = null;
  const repoRoot = findRepoRoot();
  if (repoRoot) {
    try {
      const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
      commit = stdout.trim() || null;
    } catch {
      commit = null;
    }
  }

  // Findings, collapsed. A page captured at three scroll offsets reports the same
  // cut-off heading three times, and a report that says so three times reads as
  // three defects — so a finding is per (rule, page, theme, viewport) and keeps the
  // frames it was seen in. Collapsing here rather than in the report means the
  // count in the manifest and the row in the table are the same number.
  const findings = mergeFindings(parts.flatMap((part) => part.findings ?? []));

  const byTheme: Record<string, number> = {};
  const byViewport: Record<string, number> = {};
  let bytes = 0;
  for (const frame of frames) {
    byTheme[frame.theme] = (byTheme[frame.theme] ?? 0) + 1;
    byViewport[frame.viewport] = (byViewport[frame.viewport] ?? 0) + 1;
    bytes += frame.bytes;
  }

  // A stuck reveal is the finding a reviewer must not have to notice by eye.
  // Surfaced at the top of the manifest.
  const stuckReveals = frames
    .filter((frame) => frame.settle?.revealsTimedOut === true)
    .map((frame) => ({ path: frame.path, pending: frame.settle?.pendingReveals }));

  // Frames photographed mid-motion. Reported, never failed: the frame is in the
  // sheet, but a reviewer must not file it as a design difference.
  const unquiescedFrames = frames
    .filter(
      (frame) => frame.settle?.unquiesced === true || (frame.settle?.unsettledReveals ?? 0) > 0,
    )
    .map((frame) => ({ path: frame.path, reveals: frame.settle?.unsettledReveals }));

  // Tiled in the project's own browser, launched here because the teardown is the
  // first place that knows every frame exists. A failure to launch is recorded and
  // swallowed: the sheets are a convenience for review, and losing them must not
  // discard a run whose frames are all on disk.
  let contactSheets: ContactSheets = {
    tiled: [],
    sheets: 0,
    reason: "not attempted",
  };
  let tiler: Browser | null = null;
  try {
    tiler = await chromium.launch();
    contactSheets = await buildContactSheets(OUT_ROOT, tiler);
  } catch (error) {
    contactSheets = {
      tiled: [],
      sheets: 0,
      reason: `no contact sheets were tiled (${(error as Error).message}); every frame is still on disk`,
    };
  } finally {
    await tiler?.close();
  }

  const notes: string[] = [
    "Captures are PNG from this project's own Chromium, under the browser root named above.",
    "Text metrics come from the image's fonts: the app uses the system-ui stack with no webfonts, so runs are host-independent.",
    "Do not pixel-diff these against a capture from another browser, profile or operating system.",
    contactSheets.reason ??
      "Contact sheets are tiled in this project's own Chromium, 12 to a sheet, each thumbnail captioned with its frame path. In a browser rather than with ffmpeg because Playwright's bundled ffmpeg is a minimal build — `scale` and `pad`, no `tile` — so a tiling filtergraph fails at option parsing, before a frame is read.",
    "Static and state frames are captured with prefers-reduced-motion: reduce — the app's own at-rest rendering, since Home's hero types a prompt and cycles a status chip on timers that never finish.",
    "Motion frames are captured with motion on, and are filmstrips rather than byte-reproducible captures: a transition sampled at 30% is a frame of a moving page, which is the point.",
  ];

  await writeFile(
    MANIFEST_PATH,
    JSON.stringify(
      {
        generatedBy: "make visual-sweep",
        run: RUN_ID,
        commit,
        origin: process.env.VISUAL_SWEEP_ORIGIN ?? "http://localhost:4173",
        build: "production (vite build + vite preview)",
        browser: browser
          ? { version: browser.version, executablePath: browser.executablePath }
          : null,
        projects: parts.map((part) => ({
          name: part.project,
          worker: part.workerIndex,
          viewport: part.viewport,
          userAgent: part.userAgent,
        })),
        counts: {
          frames: frames.length,
          bytes,
          byTheme,
          byViewport,
          contactSheets: contactSheets.sheets,
          findings: findings.length,
          bySeverity: countBy(findings, (finding) => finding.severity),
        },
        contactSheets: contactSheets.tiled,
        stuckReveals,
        unquiescedFrames,
        notes,
        frames,
      },
      null,
      2,
    ),
  );

  // Findings get their own file: the manifest answers "what did this run
  // capture", and the report a reviewer opens first answers "what is wrong with
  // it" — which should not require reading a 344-frame inventory first.
  await writeFile(
    FINDINGS_PATH,
    JSON.stringify(
      {
        run: RUN_ID,
        commit,
        rules: AUDIT_RULES,
        counts: countBy(findings, (finding) => finding.severity),
        findings,
      },
      null,
      2,
    ),
  );

  // --- audits, in the only place the ordering is guaranteed ------------------

  if (REQUIRED) {
    audit(frames.length, parts, stuckReveals.length, unquiescedFrames.length);
  }

  // The parts have served their purpose; leaving them invites a second merge
  // reading stale records.
  await rm(partsDir, { recursive: true, force: true });
  await rm(join(OUT_ROOT, ".staging"), { recursive: true, force: true });

  process.stdout.write(
    `\nvisual sweep: ${frames.length} frames, ${(bytes / 1024 / 1024).toFixed(1)} MB, commit ${commit ?? "unknown"}\n` +
      `              browser ${browser?.version ?? "unknown"} (${browser?.executablePath ?? "unknown"})\n` +
      `              manifest ${join(OUT_ROOT, "manifest.json")}\n` +
      `              findings ${FINDINGS_PATH} (${findings.length}: ${describeCounts(findings)})\n`,
  );
}

/**
 * Fail the run on a short or malformed result.
 *
 * Throwing from teardown fails the run, which is the point: a manifest that
 * claims fewer frames than the matrix declares means a worker died, and a report
 * written over 280 of the promised 300 frames is worse than no report, because
 * it reads as complete.
 */
function audit(
  frameCount: number,
  parts: Part[],
  stuckRevealCount: number,
  unquiescedCount: number,
): void {
  const problems: string[] = [];

  // Per route, because a route that narrows its scroll set contributes fewer
  // frames — the count has to be derived the way the spec derives it, or the
  // audit is a different matrix from the run it is auditing.
  const declaredStatic =
    SWEEP_ROUTES.reduce(
      (sum, route) => sum + (route.scroll ?? SWEEP_SCROLL_OFFSETS).length,
      0,
    ) * SWEEP_THEMES.length * SWEEP_VIEWPORTS.length;
  const declaredState = SWEEP_STATES.reduce(
    (sum, state) =>
      sum + (state.themes ?? SWEEP_THEMES).length * (state.viewports ?? SWEEP_VIEWPORTS).length,
    0,
  );
  const declaredMotion = SWEEP_MOTION.reduce((sum, pass) => sum + pass.samples.length, 0);
  const declared = declaredStatic + declaredState + declaredMotion;

  if (frameCount < 200) {
    problems.push(`only ${frameCount} frames, below the 200-frame floor`);
  }
  if (frameCount < declared) {
    problems.push(`${frameCount} frames captured, matrix declares ${declared} — a worker likely died`);
  }

  // One part per worker, and one worker per project at least: a project whose
  // part never arrived would silently vanish from the viewport comparison.
  const projects = new Set(parts.map((part) => part.project));
  for (const expected of SWEEP_VIEWPORTS) {
    if (!projects.has(expected)) {
      problems.push(`no frames for the ${expected} project`);
    }
  }

  // Every recorded path must exist. A frame record for a file that is not there
  // is a report entry a reviewer cannot open.
  const missing = frames_missing(parts);
  if (missing.length > 0) {
    problems.push(`${missing.length} recorded frame(s) are not on disk: ${missing.slice(0, 3).join(", ")}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `visual sweep audit failed:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
        `Frames: ${join(OUT_ROOT)}\n` +
        (stuckRevealCount > 0 ? `Also: ${stuckRevealCount} stuck reveal(s) recorded in the manifest.\n` : "") +
        (unquiescedCount > 0
          ? `And: ${unquiescedCount} frame(s) were captured while animations were still running.\n`
          : ""),
    );
  }
}

function frames_missing(parts: Part[]): string[] {
  const missing: string[] = [];
  for (const part of parts) {
    for (const frame of part.frames) {
      if (!existsSync(join(OUT_ROOT, frame.path))) {
        missing.push(frame.path);
      }
    }
  }
  return missing;
}

/** A finding with the frames it was seen in, so "3 frames" is not "3 defects". */
interface MergedFinding extends Finding {
  frames: string[];
}

/**
 * Collapse per-frame findings into per-defect ones.
 *
 * A page is captured at several scroll offsets, and a heading that overflows
 * overflows at all of them. Left uncollapsed, one bug on a three-offset route is
 * three rows in the report, and the count triples the moment a page gains an
 * offset — which is the shape of finding that teaches a reviewer to skim the
 * table instead of reading it.
 *
 * The *frames* are kept, because the evidence is the point: "this is wrong at
 * every scroll offset of this page" is a far stronger claim than "this page has a
 * problem", and only the list of frames supports it.
 */
function mergeFindings(findings: Finding[]): MergedFinding[] {
  const byKey = new Map<string, MergedFinding>();
  for (const finding of findings) {
    const key = [finding.rule, finding.page, finding.theme, finding.viewport].join(" ");
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.frames.includes(finding.frame)) existing.frames.push(finding.frame);
      // The fullest measurement wins: each frame has a budget of listed instances,
      // so a later frame may know about more of them than the first did.
      if (finding.detail.length > existing.detail.length) existing.detail = finding.detail;
      continue;
    }
    byKey.set(key, { ...finding, frames: [finding.frame] });
  }
  const severityOrder = { blocker: 0, major: 1, minor: 2 } as const;
  return [...byKey.values()].sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.page.localeCompare(b.page) ||
      a.rule.localeCompare(b.rule),
  );
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function describeCounts(findings: MergedFinding[]): string {
  const counts = countBy(findings, (finding) => finding.severity);
  const parts = (["blocker", "major", "minor"] as const)
    .filter((severity) => (counts[severity] ?? 0) > 0)
    .map((severity) => `${counts[severity]} ${severity}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}
