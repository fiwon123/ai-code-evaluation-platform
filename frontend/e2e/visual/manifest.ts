import { resolve } from "node:path";

import type { Finding } from "./helpers/audit";

/**
 * The run's output contract — the one place that decides *where* a run writes
 * and *what shape* a manifest record has.
 *
 * This exists because the spec and the global teardown each need the same three
 * facts: the run id, the directory it names, and the shape of a part file. Held
 * as duplicates they cannot disagree loudly — they can only disagree silently,
 * and the failure mode is specific: the teardown resolves a different `OUT_ROOT`
 * than the spec wrote to, finds no parts, and reports a clean run with zero
 * frames. A guard that passes because it looked in the wrong directory is worse
 * than no guard, because it converts a crash into a false all-clear.
 *
 * So the paths are derived once, here, and the frame record is a type both sides
 * import. A field added to a frame is a type error in the teardown rather than
 * a `Record<string, unknown>` that quietly accepts anything.
 */

/** This run's identifier. `make visual-sweep` names it; a bare `npm run` gets `local`. */
export const RUN_ID = process.env.VISUAL_SWEEP_RUN ?? "local";

/** Where every frame, part and manifest for this run lives. */
export const OUT_ROOT = resolve(process.cwd(), "visual-sweeps", RUN_ID);

/** Where workers deposit their manifest parts, one file per project and worker. */
export const PARTS_DIR = resolve(OUT_ROOT, "manifest.parts");

/** The merged manifest, written by the teardown once every worker has exited. */
export const MANIFEST_PATH = resolve(OUT_ROOT, "manifest.json");

/**
 * Findings on their own, beside the manifest.
 *
 * Separate because the two are read by different people at different times: the
 * manifest answers "what did this run capture", the findings answer "what is
 * wrong with it", and the second is the one a reviewer opens first. Folding them
 * in would mean downloading a 344-frame inventory to read eleven rows of a table.
 */
export const FINDINGS_PATH = resolve(OUT_ROOT, "findings.json");

/**
 * Per-project viewport geometry, as Playwright reports it.
 *
 * Named `…Geometry` because the spec's `SweepViewport` is the *name* of a
 * viewport from the matrix ("pixel-7"), and two types differing by one letter is
 * exactly the sort of thing that ships as a silent mix-up.
 *
 * Kept loose (`number | null`) on purpose: a project's device may not pin a
 * viewport, and the manifest should record `null` for that rather than invent
 * numbers.
 */
export interface SweepViewportGeometry {
  width: number;
  height: number;
}

/** The browser the frames came from. */
export interface SweepBrowser {
  version: string;
  executablePath: string;
}

/** What the settle found, for a static frame. */
export interface SweepSettle {
  total: number;
  timeDriven: number;
  positionDriven: number;
  infinite: number;
  scrollY: number;
  maxScroll: number;
  revealed: number;
  pendingReveals: number;
  revealsTimedOut: boolean;
  unquiesced: boolean;
  unsettledReveals: number;
}

/** One captured frame. */
export interface SweepFrame {
  /** Path relative to `OUT_ROOT`, so the manifest survives a moved checkout. */
  path: string;
  theme: string;
  viewport: string;
  /**
   * Which page this frame is of: a route path, a state id, or a motion id.
   *
   * Separate from `state`, which is a sentence for a human. The report is a table
   * with one row per finding and a "page" column, and a column of sentences makes
   * grouping and sorting impossible.
   */
  page: string;
  state: string;
  bytes: number;
  /** Wall-clock cost. The one number here that legitimately varies by machine. */
  ms: number;
  /** For motion frames: how many animations the seek actually moved. */
  seeked?: number;
  /** For static frames: what was animating at this offset. */
  settle?: SweepSettle;
}

/** One worker's contribution to the run. */
export interface SweepPart {
  project: string;
  workerIndex: number;
  viewport: SweepViewportGeometry | null;
  userAgent: string | undefined;
  browser: SweepBrowser | null;
  frames: SweepFrame[];
  /** Layout and accessibility findings, measured on the page each frame shows. */
  findings: Finding[];
}

/**
 * One file per project *and* worker.
 *
 * The worker index is in the name because the frames are per-worker: with more
 * workers than projects, a part named after the project alone has each of them
 * overwrite the last, so the manifest describes one worker's frames while the
 * report claims the whole matrix. The teardown concatenates every part it finds,
 * so the collision has to be impossible in the filename rather than unlikely.
 */
export function partFileName(project: string, workerIndex: number): string {
  return `${project}-w${workerIndex}.json`;
}
