import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/rest", () => ({ readRows: vi.fn() }));
vi.mock("@/lib/service-slots", () => ({
  readServiceSlots: vi.fn(),
  readServiceSlotsForCampuses: vi.fn(),
}));

import {
  getTriageData,
  resolveMidComparisonSlotKey,
} from "@/lib/instrument/queries";
import { readServiceSlots } from "@/lib/service-slots";
import { readRows } from "@/lib/supabase/rest";

describe("mid-service comparison slots", () => {
  it("keeps first services in the same comparison cohort", () => {
    expect(resolveMidComparisonSlotKey("first")).toBe("first");
  });

  it("keeps differently timed second services in one comparison cohort", () => {
    expect(resolveMidComparisonSlotKey("second")).toBe("second");
  });
});

describe("Verify service visibility", () => {
  it("returns unresolved PlanTimes and plan-scoped missing-service incidents", async () => {
    vi.mocked(readServiceSlots).mockResolvedValue([
      {
        id: 1,
        campus_id: 3,
        slot_key: "first",
        is_active: true,
        is_run_through: false,
        schedule_id: 11,
        effective_from: null,
        effective_until: null,
        slot_label: "9am",
        expected_local_start: "09:00:00",
        match_tolerance_minutes: 10,
      },
      {
        id: 2,
        campus_id: 3,
        slot_key: "second",
        is_active: true,
        is_run_through: false,
        schedule_id: 12,
        effective_from: "2026-08-30",
        effective_until: null,
        slot_label: "10:30am",
        expected_local_start: "10:30:00",
        match_tolerance_minutes: 10,
      },
    ]);
    vi.mocked(readRows).mockImplementation(
      (async (table: string, query: Record<string, string>) => {
        if (table === "campuses") {
          return [{
            id: 3,
            code: "ELK",
            name: "Elk River",
            reference_target_seconds: 4500,
            reference_target_status: "approved",
          }];
        }
        if (table === "plans") return [{ id: 10, title: "Weekend" }];
        if (table === "effective_plan_times") {
          return [
            {
              id: 19,
              effective_slot_id: null,
              pco_name: "Full Service Run Through",
              starts_at: "2026-08-30T12:45:00Z",
              planned_target_seconds: 3600,
              service_actual_seconds: 3600,
            },
            {
              id: 20,
              effective_slot_id: null,
              pco_name: "10:30 Service",
              starts_at: "2026-08-30T15:30:00Z",
              planned_target_seconds: 3600,
              service_actual_seconds: 3600,
            },
          ];
        }
        if (table === "review_incidents" && query.plan_time_id === "is.null") {
          return [{
            id: 30,
            slot_id: 2,
            kind: "slot_resolution",
            detail: "No PlanTime matched the 10:30am production slot.",
          }];
        }
        if (table === "review_incidents" && query.status === "eq.open") {
          return [{
            id: 31,
            plan_time_id: 20,
            slot_id: null,
            kind: "slot_resolution",
            review_incident_items: [],
          }];
        }
        if (table === "review_incidents") return [];
        if (table === "items" || table === "item_times" || table === "elements") {
          return [];
        }
        throw new Error(`Unexpected table ${table}`);
      }) as never,
    );

    const result = await getTriageData("ELK", "2026-08-30");

    expect(result?.slots).toEqual([
      expect.objectContaining({
        planTimeId: 20,
        slotKey: null,
        slotLabel: "Unresolved service",
        pcoName: "10:30 Service",
      }),
    ]);
    expect(result?.planIncidents).toEqual([
      expect.objectContaining({
        id: 30,
        slotKey: "second",
        slotLabel: "10:30am",
      }),
    ]);
    expect(result?.totalAttentionCount).toBe(2);
  });
});
