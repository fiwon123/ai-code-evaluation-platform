import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./data";

/**
 * Motion QA recordings. Not a gate — an instrument.
 *
 * Every other e2e spec judges animation by sampling computed style at a point in
 * time, which is the right instrument for *whether* something animates but the
 * wrong one for *how it reads*: a sample cannot show two cards overlapping, a
 * handoff that jumps, or a cycle that stutters once per lap. Those are all
 * properties of the sequence, not of any single frame.
 *
 * That is not hypothetical. Two defects in #353 were found only by recording:
 * the progress bar's loop seam was a one-frame teleport from 100% back to 4%
 * (17ms — a filmstrip sampled at 500ms steps straight over it), and the stacked
 * layout's connectors sat in the gutter beside the cards rather than between
 * them. Neither was visible in a still frame or in a computed-style sample at
 * any single instant.
 *
 * Run with video on:
 *
 *   E2E_VIDEO=1 npx playwright test motion-qa
 *
 * Recordings land in `frontend/test-results/**\/video.webm` (gitignored), one per
 * test per project. The `testIgnore` in playwright.config.ts keeps this file out
 * of `make test-e2e`.
 */

/** One pipeline cycle is 10s (see `pipelineStepActive` in Home.module.css). */
const CYCLE_MS = 10_000;

/**
 * Park the pipeline in frame and hold it there, so the recording brackets at
 * least one full cycle.
 *
 * This is the one wall-clock wait in the file: it is the only honest way
 * to express it. See the exemption in `src/test/no-wall-clock-sleeps.test.ts`.
 * The subject is a timeline that advances on its own clock, and the thing being
 * produced is a *recording* of it. There is no state to await: the wait ends
 * when the recording is long enough, and every state-based alternative
 * (`expect(...).toBeVisible()`, a settled frame) would return immediately and
 * cut the file short of the cycle it exists to capture. The assertions are
 * liveness checks that the pipeline was on screen at all, so a recording with
 * nothing in it cannot pass quietly.
 *
 * The page is deliberately not touched while it holds — no clicks, no hovers, no
 * further scrolling. Every frame after the scroll should be the resting state of
 * the pipeline, so anything that moves in the output is the animation and not the
 * automation.
 */
async function holdPipelineCycle(page: Page): Promise<void> {
  await mockApi(page);
  await page.goto("/");

  // The track sits below the hero and the terminal story above it, so an
  // unscrolled recording spends most of its frames on the hero and shows none of
  // the thing under review.
  const track = page.locator('[class*="pipelineTrack"]').first();
  await track.scrollIntoViewIfNeeded();

  // +2s of slack either side, so the recording brackets a full lap rather than
  // starting and ending mid-transition.
  await page.waitForTimeout(CYCLE_MS + 2_000);

  // Not an assertion about the animation — a liveness check that the pipeline is
  // actually on screen in this recording, which is the precondition for the video
  // being worth watching at all.
  await expect(track).toBeInViewport();
}

/**
 * Park the closing sections in frame and hold them there (#355).
 *
 * Two different holds, for two different reasons:
 *
 * * The teaser reveal is a one-shot entrance — it plays when the panel first
 *   intersects and never again, so the scroll has to land inside the recording
 *   and the hold only has to outlast the last row's delay. 260ms between five
 *   rows plus a 420ms duration is ~1.7s.
 * * The CTA ring loops every 64s. Holding a full lap would make the file
 *   enormous, and the rate is already pinned exactly by the sampled assertions
 *   in `ambient-motion.spec.ts`; what a recording adds is whether the arc reads
 *   as a slow dial rather than as a static dashed rectangle. 14s is ~79 degrees
 *   of turn — plenty to see.
 */
async function holdClosingSections(page: Page, target: string, ms: number): Promise<void> {
  await mockApi(page, undefined, { auth: true });
  await page.goto("/");

  const el = page.locator(target).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(ms);

  // Same liveness check as the pipeline: a recording of nothing must not pass.
  await expect(el).toBeInViewport();
}

test.describe("Home closing sections, recorded as video (#355)", () => {
  test.use({ reducedMotion: "no-preference" });

  test("records the teaser reveal", async ({ page }) => {
    await holdClosingSections(page, '[class*="teaserPanelWrap"]', 3_000);
  });

  test("records the CTA ring turning", async ({ page }) => {
    await holdClosingSections(page, '[class*="_cta_"]', 14_000);
  });
});

test.describe("Home pipeline, recorded as video", () => {
  // The whole point: the recording has to contain the motion, so motion cannot
  // be reduced away. Every other spec emulates reduced motion precisely because
  // it asserts resting state instead.
  test.use({ reducedMotion: "no-preference" });

  test("records a full pipeline cycle", async ({ page }) => {
    await holdPipelineCycle(page);
  });

  test("records the narrow layout", async ({ page }) => {
    // Separate from the above only so the two land in two files. The narrow
    // project is where the connectors stack, and that geometry is a different
    // thing to review from the desktop timeline.
    await holdPipelineCycle(page);
  });
});