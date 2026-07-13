import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveMidComparisonSlotLabel } from "@/lib/instrument/queries";

describe("mid-service comparison slots", () => {
  it("compares Lakeville 10am with the other campuses' 9am services", () => {
    expect(resolveMidComparisonSlotLabel("LV", "10am", "LV")).toBe("10am");
    expect(resolveMidComparisonSlotLabel("LV", "10am", "SLP")).toBe("9am");
    expect(resolveMidComparisonSlotLabel("LV", "10am", "ELK")).toBe("9am");
    expect(resolveMidComparisonSlotLabel("LV", "10am", "MG")).toBe("9am");
  });

  it("includes Lakeville 10am in another campus' 9am comparison", () => {
    expect(resolveMidComparisonSlotLabel("MG", "9am", "LV")).toBe("10am");
    expect(resolveMidComparisonSlotLabel("MG", "9am", "SLP")).toBe("9am");
  });

  it("keeps later-service comparisons on their selected slot", () => {
    expect(resolveMidComparisonSlotLabel("MG", "11am", "LV")).toBe("11am");
    expect(resolveMidComparisonSlotLabel("MG", "11am", "SLP")).toBe("11am");
  });
});
