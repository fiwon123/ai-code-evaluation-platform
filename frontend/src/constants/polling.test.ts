import { describe, expect, it } from "vitest";
import {
  COMPARE_POLL_MS,
  POLL_MAX_INTERVAL_MS,
  PROFILE_LIST_POLL_MS,
  SUBMISSION_POLL_MS,
  nextPollDelay,
} from "./polling.ts";

describe("polling constants", () => {
  it("keeps the base cadences and the cap in the order backoff assumes", () => {
    // nextPollDelay doubles from the base, so a cap at or below the base would
    // make the very first growth a no-op — the backoff would never start and
    // the flat-cadence bug would return silently.
    expect(SUBMISSION_POLL_MS).toBe(1_500);
    expect(COMPARE_POLL_MS).toBe(SUBMISSION_POLL_MS);
    expect(PROFILE_LIST_POLL_MS).toBe(5_000);
    expect(POLL_MAX_INTERVAL_MS).toBeGreaterThan(COMPARE_POLL_MS);
  });
});

describe("nextPollDelay", () => {
  it("doubles the current interval", () => {
    expect(nextPollDelay(1_500)).toBe(3_000);
    expect(nextPollDelay(3_000)).toBe(6_000);
  });

  it("never exceeds the cap", () => {
    expect(nextPollDelay(8_000)).toBe(POLL_MAX_INTERVAL_MS);
    expect(nextPollDelay(POLL_MAX_INTERVAL_MS)).toBe(POLL_MAX_INTERVAL_MS);
    // A caller past the cap (a longer injected interval) must clamp down, not
    // keep climbing.
    expect(nextPollDelay(60_000)).toBe(POLL_MAX_INTERVAL_MS);
  });

  it("honours a caller-supplied cap", () => {
    expect(nextPollDelay(1_500, 2_000)).toBe(2_000);
  });

  it("grows monotonically and reaches the cap within the severe-delay window", () => {
    // The claim in the module comment is that a flat 1.5s poll costs ~400
    // requests over the 10-minute window and the cap brings it to ~61. That
    // arithmetic is only true if the schedule is exactly this shape, so lock
    // the shape rather than the prose: a non-doubling or uncapped helper would
    // still pass a single-call test.
    const delays: number[] = [];
    let delay = COMPARE_POLL_MS;
    for (let elapsed = 0; elapsed < 600_000; elapsed += delay) {
      delays.push(delay);
      delay = nextPollDelay(delay);
    }
    const flat = 600_000 / COMPARE_POLL_MS;

    // Doubling, then the cap, then a plateau — the three phases, in order.
    const firstCapIndex = delays.indexOf(POLL_MAX_INTERVAL_MS);
    expect(firstCapIndex).toBeGreaterThan(0);
    expect(delays.slice(firstCapIndex).every((d) => d === POLL_MAX_INTERVAL_MS)).toBe(true);
    // Guard the audit: a schedule that stopped early would make the ratio below
    // look great for the wrong reason.
    expect(delays.length).toBeGreaterThan(50);
    expect(delays.length).toBeLessThan(flat);
    // The reduction the comment advertises, as a ratio so the exact count
    // cannot rot when the window or the base cadence is retuned.
    expect(delays.length / flat).toBeLessThan(0.2);
  });
});
