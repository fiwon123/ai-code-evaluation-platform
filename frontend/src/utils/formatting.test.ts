import { describe, expect, it } from "vitest";
import {
  formatDurationMs,
  formatElapsed,
  formatElapsedMs,
  formatRelativeTime,
  isDelayed,
  isSeverelyDelayed,
  statusVariant,
  STALE_AFTER_MS,
  SEVERE_DELAY_AFTER_MS,
} from "./formatting.ts";

const T0 = Date.parse("2026-01-01T00:00:00Z");

describe("statusVariant", () => {
  it("maps pending to the warning variant (waiting in the queue)", () => {
    expect(statusVariant("pending")).toBe("warning");
  });

  it("maps processing to the primary variant (actively running)", () => {
    expect(statusVariant("processing")).toBe("primary");
  });

  it("maps completed and failed to success and danger", () => {
    expect(statusVariant("completed")).toBe("success");
    expect(statusVariant("failed")).toBe("danger");
  });
});

describe("formatElapsedMs", () => {
  it("formats sub-minute elapsed times as seconds", () => {
    expect(formatElapsedMs(0)).toBe("0s");
    expect(formatElapsedMs(12_000)).toBe("12s");
    expect(formatElapsedMs(59_999)).toBe("59s");
  });

  it("formats minute elapsed times with padded seconds", () => {
    expect(formatElapsedMs(60_000)).toBe("1m 00s");
    expect(formatElapsedMs(65_000)).toBe("1m 05s");
    expect(formatElapsedMs(2 * 60_000 + 9_000)).toBe("2m 09s");
  });

  it("formats hour elapsed times with padded minutes", () => {
    expect(formatElapsedMs(3_600_000)).toBe("1h 00m");
    expect(formatElapsedMs(3_600_000 + 4 * 60_000)).toBe("1h 04m");
  });

  it("never goes negative for dates in the future", () => {
    expect(formatElapsedMs(-5_000)).toBe("0s");
  });
});

describe("formatElapsed", () => {
  it("computes elapsed since the timestamp at the given now", () => {
    expect(formatElapsed("2026-01-01T00:00:00Z", T0 + 12_000)).toBe("12s");
    expect(formatElapsed("2026-01-01T00:00:00Z", T0 + 65_000)).toBe("1m 05s");
  });
});

describe("formatDurationMs", () => {
  it("formats sub-second durations as milliseconds", () => {
    expect(formatDurationMs(12)).toBe("12ms");
    expect(formatDurationMs(850)).toBe("850ms");
  });

  it("formats second durations with one decimal place", () => {
    expect(formatDurationMs(4_200)).toBe("4.2s");
    expect(formatDurationMs(999)).toBe("999ms");
  });

  it("formats minute durations with padded seconds", () => {
    expect(formatDurationMs(90_000)).toBe("1m 30s");
    expect(formatDurationMs(120_000)).toBe("2m 00s");
  });
});

describe("isDelayed / STALE_AFTER_MS", () => {
  it("is not delayed before the threshold", () => {
    expect(isDelayed("2026-01-01T00:00:00Z", T0 + STALE_AFTER_MS - 1_000)).toBe(
      false,
    );
  });

  it("is delayed after the threshold", () => {
    expect(isDelayed("2026-01-01T00:00:00Z", T0 + STALE_AFTER_MS + 1_000)).toBe(
      true,
    );
  });
});

describe("isSeverelyDelayed / SEVERE_DELAY_AFTER_MS", () => {
  it("is not severely delayed before the threshold", () => {
    expect(
      isSeverelyDelayed("2026-01-01T00:00:00Z", T0 + SEVERE_DELAY_AFTER_MS - 1_000),
    ).toBe(false);
  });

  it("is severely delayed after the threshold", () => {
    expect(
      isSeverelyDelayed("2026-01-01T00:00:00Z", T0 + SEVERE_DELAY_AFTER_MS + 1_000),
    ).toBe(true);
  });

  it("is independent of the milder STALE_AFTER_MS threshold", () => {
    expect(SEVERE_DELAY_AFTER_MS).toBeGreaterThan(STALE_AFTER_MS);
  });
});

describe("formatRelativeTime", () => {
  it("formats recent times as just now", () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe("just now");
  });
});