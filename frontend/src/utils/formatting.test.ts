import { describe, expect, it } from "vitest";
import {
  fallbackInfo,
  formatDurationMs,
  formatElapsed,
  formatElapsedMs,
  formatRelativeTime,
  humanizeMetricKey,
  isDelayed,
  isSeverelyDelayed,
  scoreVariant,
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

describe("scoreVariant", () => {
  it("returns success at 80 and above", () => {
    expect(scoreVariant(100)).toBe("success");
    expect(scoreVariant(80)).toBe("success");
  });

  it("returns warning between 60 and 79", () => {
    expect(scoreVariant(79)).toBe("warning");
    expect(scoreVariant(60)).toBe("warning");
  });

  it("returns danger below 60", () => {
    expect(scoreVariant(59)).toBe("danger");
    expect(scoreVariant(0)).toBe("danger");
  });
});

describe("humanizeMetricKey", () => {
  it("uses curated labels for known keys", () => {
    expect(humanizeMetricKey("duration_ms")).toBe("Duration (ms)");
    expect(humanizeMetricKey("returncode")).toBe("Return code");
    expect(humanizeMetricKey("language")).toBe("Language");
    expect(humanizeMetricKey("backend")).toBe("Backend");
    expect(humanizeMetricKey("generation_ms")).toBe("Generation (ms)");
    expect(humanizeMetricKey("attempt")).toBe("Attempt");
  });

  it("falls back to sentence case for unknown keys", () => {
    expect(humanizeMetricKey("llm_latency_ms")).toBe("Llm Latency Ms");
  });

  it("handles empty keys", () => {
    expect(humanizeMetricKey("")).toBe("");
  });
});
describe("fallbackInfo", () => {
  it("is null for a normal run (the keys are absent, not falsy)", () => {
    expect(fallbackInfo({})).toBeNull();
    expect(fallbackInfo({ duration_ms: 1200, language: "python" })).toBeNull();
  });

  it("requires a boolean true — a string 'false' is not a fallback", () => {
    expect(fallbackInfo({ fallback_used: "false" })).toBeNull();
    expect(fallbackInfo({ fallback_used: 1 })).toBeNull();
    expect(fallbackInfo({ fallback_used: null })).toBeNull();
  });

  it("reads the provider, model and primary error", () => {
    const info = fallbackInfo({
      fallback_used: true,
      fallback_provider: "ollama",
      fallback_model: "tinyllama",
      primary_error: "HTTPStatusError: 429",
    });
    expect(info).toEqual({
      provider: "ollama",
      model: "tinyllama",
      primaryError: "HTTPStatusError: 429",
    });
  });

  it("tolerates missing or wrongly typed fields", () => {
    // A hand-edited or older payload must not break the report.
    expect(fallbackInfo({ fallback_used: true })).toEqual({
      provider: "a fallback provider",
      model: null,
      primaryError: null,
    });
    expect(
      fallbackInfo({ fallback_used: true, fallback_provider: 7, fallback_model: [] }),
    ).toEqual({ provider: "a fallback provider", model: null, primaryError: null });
  });
});
