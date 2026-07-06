import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IngestionPlan, PcoCampus } from "@/lib/pco/ingestion-plan";
import {
  runRecurringPcoIngestion,
  runRepairPcoIngestion,
} from "@/lib/pco/recurring-ingestion";
import type { PcoPlan } from "@/lib/pco/types";

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
    const buildCampusPlan = vi.fn(async (campus: PcoCampus) =>
      plan(campus.code, `plan-${campus.code}`),
    );
    const persistPlan = vi.fn(async (value: IngestionPlan) => ({
      ingestRunId: value.campus,
    }));

    const result = await runRecurringPcoIngestion({
      buildCampusPlan,
      persistPlan: persistPlan as never,
    });

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(4);
    expect(buildCampusPlan).toHaveBeenCalledTimes(4);
    expect(persistPlan).toHaveBeenCalledTimes(4);
  });

  it("performs zero writes when any campus preview fails", async () => {
    const buildCampusPlan = vi.fn(async (campus: PcoCampus) => {
      if (campus.code === "MG") throw new Error("PCO unavailable");
      return plan(campus.code, `plan-${campus.code}`);
    });
    const persistPlan = vi.fn();

    const result = await runRecurringPcoIngestion({
      buildCampusPlan,
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
      buildCampusPlan: async (campus: PcoCampus) =>
        plan(campus.code, `plan-${campus.code}`),
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

function pcoPlan(id: string): PcoPlan {
  return {
    type: "Plan",
    id,
    attributes: {
      title: id,
      series_title: null,
      sort_date: "2026-07-05T07:40:00Z",
      total_length: 3600,
    },
  };
}

describe("runRepairPcoIngestion", () => {
  it("skips complete plans and repairs missing or incomplete plans", async () => {
    const listPastPlans = vi.fn(async (serviceTypeId: string) => [
      pcoPlan(`plan-${serviceTypeId}`),
    ]);
    const getPlanFreshness = vi.fn(async (campus: PcoCampus) => {
      if (campus.code === "SLP" || campus.code === "LV") {
        return { status: "complete" as const, planId: 1 };
      }
      if (campus.code === "MG") {
        return { status: "incomplete" as const, planId: 2, reasons: ["gap"] };
      }
      return { status: "missing" as const };
    });
    const fetchPlanBundle = vi.fn(async (_serviceTypeId: string, pco: PcoPlan) => ({
      status: "ok" as const,
      bundle: {
        plan: pco,
        planTimes: [],
        items: [],
        itemTimes: [],
      },
    }));
    const buildIngestionPlan = vi.fn((campus: PcoCampus, bundle) =>
      plan(campus.code, bundle.plan.id),
    );
    const persistPlan = vi.fn(async (value: IngestionPlan) => ({
      ingestRunId: value.plan.pcoPlanId,
    }));

    const result = await runRepairPcoIngestion(
      { weeks: 3 },
      {
        listPastPlans,
        getPlanFreshness,
        fetchPlanBundle,
        buildIngestionPlan: buildIngestionPlan as never,
        persistPlan: persistPlan as never,
        now: () => new Date("2026-07-06T10:00:00Z"),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(2);
    expect(fetchPlanBundle).toHaveBeenCalledTimes(2);
    expect(persistPlan).toHaveBeenCalledTimes(2);
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ campus: "SLP", status: "skipped_complete" }),
    );
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ campus: "MG", status: "committed" }),
    );
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ campus: "ELK", status: "committed" }),
    );
  });

  it("reports unqualified repair candidates without failing the run", async () => {
    const result = await runRepairPcoIngestion(
      { weeks: 1 },
      {
        listPastPlans: async () => [pcoPlan("plan-unready")],
        getPlanFreshness: async () => ({ status: "missing" as const }),
        fetchPlanBundle: async () => ({
          status: "skipped" as const,
          reason: "no recorded LIVE bounds on any production plan_time",
        }),
        buildIngestionPlan: (() => {
          throw new Error("should not build");
        }) as never,
        persistPlan: (() => {
          throw new Error("should not persist");
        }) as never,
        now: () => new Date("2026-07-06T10:00:00Z"),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(0);
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ status: "skipped_unqualified" }),
    );
  });
});
