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
