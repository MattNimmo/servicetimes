import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  computeVariance,
  isElementBlocked,
  isSlotBlocked,
  type ReviewIncident,
} from "@/lib/variance/queries";

const bundleOverlap: ReviewIncident = {
  id: 1,
  plan_id: null,
  plan_time_id: 10,
  slot_id: null,
  kind: "bundle_overlap",
  review_incident_items: [{ item_id: 100 }],
};

describe("variance rules", () => {
  it("computes complete deltas and percentages", () => {
    expect(computeVariance(100, 125)).toEqual({
      status: "complete",
      plannedSeconds: 100,
      actualSeconds: 125,
      deltaSeconds: 25,
      deltaPercent: 25,
    });
  });

  it("never computes a delta for incomplete or blocked evidence", () => {
    expect(computeVariance(100, null).status).toBe("needs_review");
    expect(computeVariance(100, 125, true).deltaSeconds).toBeNull();
    expect(computeVariance(null, 125).status).toBe("no_plan");
  });

  it("does not let bundle overlap block an entire slot", () => {
    expect(isSlotBlocked([bundleOverlap], 10, 20)).toBe(false);
    expect(isElementBlocked([bundleOverlap], 10, 20, [100])).toBe(true);
    expect(isElementBlocked([bundleOverlap], 10, 20, [101])).toBe(false);
  });

  it("cascades slot integrity incidents to every element", () => {
    const missingBounds: ReviewIncident = {
      ...bundleOverlap,
      id: 2,
      kind: "missing_live_bounds",
      review_incident_items: [],
    };
    expect(isSlotBlocked([missingBounds], 10, 20)).toBe(true);
    expect(isElementBlocked([missingBounds], 10, 20, [101])).toBe(true);
  });

  it("ignores run-through slot incidents for production slots", () => {
    const runThrough: ReviewIncident = {
      ...bundleOverlap,
      id: 3,
      plan_time_id: 99,
      kind: "slot_resolution",
      review_incident_items: [],
    };
    expect(isSlotBlocked([runThrough], 10, 20)).toBe(false);
  });
});
