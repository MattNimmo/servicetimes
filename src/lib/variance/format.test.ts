import { describe, expect, it } from "vitest";

import { parseDurationInput } from "@/lib/variance/format";

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
