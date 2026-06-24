import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IngestionPlan } from "@/lib/pco/ingestion-plan";
import { runRecurringPcoIngestion } from "@/lib/pco/recurring-ingestion";

function plan(campus: string, pcoPlanId: string) {
  return {
    campus,
    dryRun: true,
    plan: { pcoPlanId },
    planTimes: [],
    items: [],
    itemTimes: [],
    incidents: [],
    taxonomyReview: [],
    summary: {},
  } as unknown as IngestionPlan;
}

describe("runRecurringPcoIngestion", () => {
  it("previews every campus before committing all four plans", async () => {
    const fetchPlan = vi.fn(async (serviceTypeId: string) => ({ serviceTypeId }));
    const buildPlan = vi.fn((campus) => plan(campus.code, `plan-${campus.code}`));
    const persistPlan = vi.fn(async (value: IngestionPlan) => ({
      ingestRunId: value.campus,
    }));

    const result = await runRecurringPcoIngestion({
      fetchPlan,
      buildPlan: buildPlan as never,
      persistPlan: persistPlan as never,
    });

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(4);
    expect(fetchPlan).toHaveBeenCalledTimes(4);
    expect(persistPlan).toHaveBeenCalledTimes(4);
  });

  it("performs zero writes when any campus preview fails", async () => {
    const fetchPlan = vi.fn(async (serviceTypeId: string) => {
      if (serviceTypeId === "380440") throw new Error("PCO unavailable");
      return { serviceTypeId };
    });
    const persistPlan = vi.fn();

    const result = await runRecurringPcoIngestion({
      fetchPlan: fetchPlan as never,
      buildPlan: ((campus) => plan(campus.code, `plan-${campus.code}`)) as never,
      persistPlan: persistPlan as never,
    });

    expect(result.ok).toBe(false);
    expect(result.writesPerformed).toBe(0);
    expect(persistPlan).not.toHaveBeenCalled();
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ campus: "MG", status: "preview_failed" }),
    );
  });

  it("reports a partial write failure without hiding successful commits", async () => {
    const result = await runRecurringPcoIngestion({
      fetchPlan: (async () => ({})) as never,
      buildPlan: ((campus) => plan(campus.code, `plan-${campus.code}`)) as never,
      persistPlan: (async (value: IngestionPlan) => {
        if (value.campus === "LV") throw new Error("database unavailable");
        return { ingestRunId: value.campus };
      }) as never,
    });

    expect(result.ok).toBe(false);
    expect(result.writesPerformed).toBe(3);
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ campus: "LV", status: "write_failed" }),
    );
  });
});
