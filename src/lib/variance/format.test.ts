import { describe, expect, it } from "vitest";

import {
  formatDelta,
  formatDuration,
  parseDurationInput,
} from "@/lib/variance/format";

describe("formatDuration", () => {
  it("formats long durations with total minutes instead of hours", () => {
    expect(formatDuration(5_141)).toBe("85:41");
    expect(formatDuration(3_600)).toBe("60:00");
  });

  it("preserves signs, rounding, zero, and missing values", () => {
    expect(formatDuration(-5_141)).toBe("−85:41");
    expect(formatDuration(65.6)).toBe("1:06");
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatDelta", () => {
  it("formats long deltas with total minutes", () => {
    expect(formatDelta(5_141)).toBe("+85:41");
    expect(formatDelta(-5_141)).toBe("−85:41");
  });
});

describe("parseDurationInput", () => {
  it("parses minute-second durations", () => {
    expect(parseDurationInput("75:30")).toBe(4_530);
    expect(parseDurationInput("0:45")).toBe(45);
  });

  it("parses hour-minute-second durations", () => {
    expect(parseDurationInput("1:15:30")).toBe(4_530);
  });

  it("rejects malformed inputs", () => {
    expect(parseDurationInput("")).toBeNull();
    expect(parseDurationInput("75")).toBeNull();
    expect(parseDurationInput("1:75:30")).toBeNull();
    expect(parseDurationInput("abc")).toBeNull();
  });
});
