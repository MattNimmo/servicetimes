import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IngestionPlan } from "@/lib/pco/ingestion-plan";
import { verifyIngestionPlan } from "@/lib/pco/ingestion-verifier";

const plan = {
  campus: "SLP",
  plan: { pcoPlanId: "plan-1" },
  planTimes: [
    {
      pcoPlanTimeId: "time-1",
      detectedSlotLabel: "9am",
      slotResolutionState: "auto",
    },
  ],
  items: [{}],
  itemTimes: [{}],
  incidents: [{ kind: "timer_bleed" }],
  summary: {
    planTimeCount: 1,
    itemCount: 1,
    itemTimeCount: 1,
    incidentCount: 1,
  },
} as unknown as IngestionPlan;

describe("verifyIngestionPlan", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("reconciles the persisted plan to the dry-run plan", async () => {
    const rowsByTable: Record<string, unknown[]> = {
      ingest_runs: [{ id: 17, status: "ok" }],
      campuses: [{ id: 1, code: "SLP" }],
      plans: [{ id: 10, campus_id: 1 }],
      plan_times: [
        {
          id: 20,
          pco_plan_time_id: "time-1",
          detected_slot_id: 30,
          slot_resolution_state: "auto",
          service_slots: { slot_label: "9am" },
        },
      ],
      items: [{ id: 40 }],
      item_times: [{ id: 50 }],
      review_incidents: [{ kind: "timer_bleed" }],
    };
    const fetchMock = vi.fn(async (...args: [URL | RequestInfo, RequestInit?]) => {
      const [input] = args;
      const url = new URL(input.toString());
      const table = url.pathname.split("/").at(-1) ?? "";
      return Response.json(rowsByTable[table] ?? []);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyIngestionPlan(plan, 17);

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ pass: true })]));
    expect(fetchMock).toHaveBeenCalledTimes(7);
    for (const [, request] of fetchMock.mock.calls) {
      expect(request?.headers).toMatchObject({
        Authorization: "Bearer test-service-role-key",
      });
    }
  });
});
