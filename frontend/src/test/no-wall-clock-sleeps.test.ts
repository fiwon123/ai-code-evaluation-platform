import { describe, expect, it } from "vitest";

/**
 * No wall-clock sleeps used as synchronisation in tests (#330).
 *
 * `SubmissionDetail.test.tsx` proved a fetch happened exactly once by sleeping
 * 50ms and counting calls. That is a claim about the machine's load as much as
 * about the code: the test flaked once in five full runs under parallel vitest,
 * and the failure direction is biased — a slow machine overshoots the sleep,
 * which makes it *more* likely to catch a request that was merely late. So it
 * fails on correct code and can pass on a real defect that happened to be slow.
 *
 * The fix is not a convention people reliably follow, and the cost of forgetting
 * is a flake nobody can reproduce. So the idiom is banned, and the ban is
 * checked here rather than trusted.
 *
 * The pattern is `new Promise` whose executor waits on a real `setTimeout`. That
 * is specific enough to be unambiguous: a test that genuinely needs to observe
 * elapsed time advances a *mocked* clock (`vi.advanceTimersByTimeAsync`), which
 * is not a sleep because the test controls it. Timeouts that are not
 * synchronisation — a `setTimeout` in a component double, a spy asserting a
 * timer was cleared — are not this shape and are left alone.
 */

/**
 * The sleep idiom, as a pattern.
 *
 * Written out rather than reached for first: the natural version of this — an
 * optional `\{[^}]*\}` for a block-bodied executor — consumes the very
 * `setTimeout` it is meant to find, and quietly matches only the one-liners.
 * Verified against the cases below before being trusted to pass a real file.
 */
const SLEEP =
  /new\s+Promise\s*\(\s*\(?\s*(?:resolve|res|rj)\b[^)]*\)?\s*=>\s*(?:\{\s*)?setTimeout\s*\(/;

const SOURCES = import.meta.glob("../**/*.{test,spec}.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * The Playwright suite's equivalent (#340).
 *
 * Same failure mode, different verb. `journeys.visual.ts` waited 250ms after
 * clicking submit and `websocket.spec.ts` waited 300ms after pushing a frame, both
 * as synchronisation. Measured, not assumed: the register page's DOM is
 * byte-identical at 0ms and at 250ms, so that sleep bought nothing at all, and it
 * was labelled "Submit blocked" while photographing a race it could not resolve.
 *
 * A browser test gets one more tool than a unit test here — `page.waitForTimeout`
 * — and the temptation is worse, because waiting for a *state* is often
 * impossible: asserting that an update changed nothing has no state to wait for.
 * That is why the sanctioned answer is not "wait longer" but "assert the absence
 * where it is readable" — see `settleSocketFrames`, and the hook-level test that
 * proves the drop.
 */
const E2E_SOURCES = import.meta.glob("../../e2e/**/*.{spec,visual}.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Comments are stripped before matching, so documenting a wait cannot smuggle one
 * past the lock — and so the `//` in the `http://` origins these files are full of
 * does not truncate the line before the call is read.
 */
const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const E2E_SLEEP = /\bpage\.waitForTimeout\s*\(/;

/**
 * The one sanctioned wall-clock wait in the browser suite, and what it is for.
 *
 * `burstJ` records a moving moment as a strip of JPEGs. Between frames it must
 * let the animation actually advance — that is the artefact, not synchronisation,
 * and no state can stand in for it because the state *is* time passing. The
 * `because` pattern is part of the exemption: delete the justification and the
 * lock goes red, so an exemption cannot outlive the argument that earned it.
 */
const E2E_EXEMPT: Record<string, { count: number; because: RegExp }> = {
  "../../e2e/visual/journeys.visual.ts": {
    count: 1,
    because: /one legitimate wall-clock wait/,
  },
  // #350's reduced-motion assertion. The thing under test is a *timer that
  // must not fire*: the walkthrough rail advances every STEP_CYCLE_MS and is
  // supposed to hold still for a reader who asked for reduced motion. There is
  // no state to wait on — the claim is the absence of a change over a span
  // longer than the interval, so wall-clock is the only way to express it. The
  // span is asserted to be longer than two holds, so a shortened STEP_CYCLE_MS
  // cannot make it pass by proving less.
  "../../e2e/demo-picker.spec.ts": {
    count: 1,
    because: /two holds of STEP_CYCLE_MS/,
  },
};

/** e2e files whose wall-clock waits are not accounted for. */
function unexplainedE2ESleeps(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([path, body]) => {
      const found = stripComments(body).match(new RegExp(E2E_SLEEP.source, "g"))?.length ?? 0;
      const exempt = E2E_EXEMPT[path];
      if (!exempt) return found > 0;
      return found !== exempt.count || !exempt.because.test(body);
    })
    .map(([path]) => path);
}

/** Test files with a wall-clock sleep in them. */
function sleepers(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([, body]) => SLEEP.test(body))
    .map(([path]) => path);
}

describe("the sleep detector fires on a sleep", () => {
  // The detector is the lock here, so it is held to the same standard as every
  // other one in this repo: proved on a known-bad input before it is trusted to
  // pass a good one. A grep that quietly stopped matching would turn the lock
  // below into a no-op that reads as coverage.
  it("catches the shape #330 used", () => {
    expect(SLEEP.test("await new Promise((resolve) => setTimeout(resolve, 50));")).toBe(
      true,
    );
  });

  it("catches it with a block-bodied executor and a renamed binding", () => {
    expect(
      SLEEP.test("await new Promise((res) => { setTimeout(res, 30); });"),
    ).toBe(true);
  });

  it("leaves a mocked clock alone", () => {
    // The sanctioned replacement must not be caught, or the ban would push people
    // back to sleeping.
    expect(SLEEP.test("await vi.advanceTimersByTimeAsync(POLL_MS);")).toBe(false);
  });

  it("catches the shape with no arrow-parameter parens", () => {
    // The variant a real reintroduction would most likely take.
    expect(SLEEP.test("return new Promise(resolve => setTimeout(() => resolve(c), 30))")).toBe(
      true,
    );
  });

  it("does not mistake another async wait for a sleep", () => {
    // A promise that resolves on the next frame is a different tool, and it is
    // frame-driven rather than clock-driven.
    expect(SLEEP.test("await new Promise((r) => requestAnimationFrame(r));")).toBe(false);
    expect(SLEEP.test("const p = new Promise((resolve) => resolve(1));")).toBe(false);
  });

  it("leaves a non-synchronisation timeout alone", () => {
    expect(SLEEP.test("clearTimeout(pollTimer);")).toBe(false);
    expect(
      SLEEP.test("vi.spyOn(window, 'setTimeout')"),
    ).toBe(false);
  });
});

describe("the browser sleep detector fires on a sleep", () => {
  it("catches the shape #340 used", () => {
    expect(E2E_SLEEP.test("await page.waitForTimeout(300);")).toBe(true);
  });

  it("catches it however the argument is spaced or named", () => {
    expect(E2E_SLEEP.test("await page.waitForTimeout( 250 )")).toBe(true);
    expect(E2E_SLEEP.test("await page.waitForTimeout(MOTION_MS);")).toBe(true);
  });

  it("is not fooled by a wait hidden in a comment", () => {
    // The natural way to defeat this lock is to write `// await
    // page.waitForTimeout(300)` and leave the real one below it.
    expect(stripComments("// await page.waitForTimeout(300);\n").includes("waitForTimeout")).toBe(
      false,
    );
    expect(
      stripComments("/* page.waitForTimeout(300) */ const a = page.waitForTimeout(1);").match(
        new RegExp(E2E_SLEEP.source, "g"),
      ),
    ).toHaveLength(1);
  });

  it("keeps origins intact so the call after a url is still read", () => {
    // `//` inside a string would otherwise be taken for a comment and swallow the
    // rest of the line — and these files are full of `http://` origins.
    expect(
      stripComments('const base = "http://localhost:4173"; await page.waitForTimeout(1);').match(
        new RegExp(E2E_SLEEP.source, "g"),
      ),
    ).toHaveLength(1);
  });

  it("leaves the sanctioned settling helpers alone", () => {
    // The ban must not push people back to sleeping, so the replacement has to
    // survive it.
    expect(E2E_SLEEP.test("await settleSocketFrames(page);")).toBe(false);
    expect(E2E_SLEEP.test("const { scrollY } = await settleAtScroll(page, 1);")).toBe(false);
    expect(E2E_SLEEP.test("await expect(locator).toBeVisible();")).toBe(false);
  });
});

describe("no browser test synchronises by sleeping", () => {
  it("reads a real corpus, so the ban is not vacuous", () => {
    expect(Object.keys(E2E_SOURCES).length).toBeGreaterThan(10);
  });

  it("finds no unexplained waits", () => {
    expect(
      unexplainedE2ESleeps(E2E_SOURCES),
      "A browser test is waiting on real time to pass. Wait on the state that " +
        "proves the thing happened, or use a settling helper. If the frame you " +
        "are waiting on genuinely must advance (a recorded burst), say why in a " +
        "comment the lock can check. See #340.",
    ).toEqual([]);
  });
});

describe("no test synchronises by sleeping", () => {
  it("reads a real corpus, so the ban is not vacuous", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
    expect(SOURCES).toBeDefined();
  });

  it("finds no sleepers", () => {
    expect(
      sleepers(SOURCES),
      "A test is waiting on real time to pass. Drive the clock instead " +
        "(`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`), or wait on the " +
        "state that proves the thing happened. See #330.",
    ).toEqual([]);
  });
});
