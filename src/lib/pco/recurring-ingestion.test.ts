import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/rest", () => ({ readRows: vi.fn() }));

import { PCO_CAMPUSES } from "@/lib/pco/campuses";
import type { IngestionPlan, PcoCampus } from "@/lib/pco/ingestion-plan";
import {
  getCampusDateFreshness,
  getPlanFreshness,
  runRecurringPcoIngestion,
  runRepairPcoIngestion,
} from "@/lib/pco/recurring-ingestion";
import type { PcoPlan } from "@/lib/pco/types";
import { readRows } from "@/lib/supabase/rest";

const expectedServiceDate = "2026-07-05";
const campusCodes = PCO_CAMPUSES.map(({ code }) => code);
const recurringNow = () => new Date("2026-07-05T19:00:00Z");

function plan(campus: string, pcoPlanId: string) {
  return {
    campus,
    dryRun: true,
    plan: { pcoPlanId, serviceDate: expectedServiceDate },
    planTimes: [],
    items: [],
    itemTimes: [],
    incidents: [],
    taxonomyReview: [],
    summary: {},
  } as unknown as IngestionPlan;
}

function missingFreshness() {
  return { status: "missing" as const };
}

function completeFreshness(campus: PcoCampus) {
  return {
    status: "complete" as const,
    planId: campusCodes.indexOf(campus.code) + 1,
    pcoPlanId: `existing-${campus.code}`,
  };
}

function persistedCampuses(persistPlan: ReturnType<typeof vi.fn>) {
  return persistPlan.mock.calls.map(
    ([value]) => (value as IngestionPlan).campus,
  );
}

describe("runRecurringPcoIngestion", () => {
  it("writes all four current campuses and succeeds after four-of-four verification", async () => {
    const buildCampusPlan = vi.fn(async (campus: PcoCampus) =>
      plan(campus.code, `plan-${campus.code}`),
    );
    const persistPlan = vi.fn(async (value: IngestionPlan) => ({
      ingestRunId: value.campus,
    }));

    const result = await runRecurringPcoIngestion({
      buildCampusPlan,
      persistPlan: persistPlan as never,
      getCampusDateFreshness: async () => missingFreshness(),
      countPersistedCampuses: async () => 4,
      now: recurringNow,
    });

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(4);
    expect(result.expectedServiceDate).toBe(expectedServiceDate);
    expect(result.verification).toEqual({
      successfulLocations: 4,
      expectedLocations: 4,
    });
    expect(buildCampusPlan).toHaveBeenCalledTimes(4);
    expect(persistPlan).toHaveBeenCalledTimes(4);
    expect(result.campuses.every(({ status }) => status === "committed")).toBe(
      true,
    );
  });

  it.each(campusCodes)(
    "isolates a %s preview failure and commits the other campuses",
    async (failedCampus) => {
      const buildCampusPlan = vi.fn(async (campus: PcoCampus) => {
        if (campus.code === failedCampus) throw new Error("PCO unavailable");
        return plan(campus.code, `plan-${campus.code}`);
      });
      const persistPlan = vi.fn(async () => ({ ingestRunId: 1 }));

      const result = await runRecurringPcoIngestion({
        buildCampusPlan,
        persistPlan: persistPlan as never,
        getCampusDateFreshness: async () => missingFreshness(),
        countPersistedCampuses: async () => 3,
        now: recurringNow,
      });

      expect(result.ok).toBe(false);
      expect(result.writesPerformed).toBe(3);
      expect(persistedCampuses(persistPlan).sort()).toEqual(
        campusCodes.filter((code) => code !== failedCampus).sort(),
      );
      expect(result.campuses).toContainEqual(
        expect.objectContaining({
          campus: failedCampus,
          status: "preview_failed",
          error: "PCO unavailable",
        }),
      );
    },
  );

  it.each(campusCodes)(
    "rejects only a stale %s preview and writes the other campuses",
    async (staleCampus) => {
      const buildCampusPlan = vi.fn(async (campus: PcoCampus) => {
        const value = plan(campus.code, `plan-${campus.code}`);
        if (campus.code === staleCampus) value.plan.serviceDate = "2026-06-28";
        return value;
      });
      const persistPlan = vi.fn(async () => ({ ingestRunId: 1 }));

      const result = await runRecurringPcoIngestion({
        buildCampusPlan,
        persistPlan: persistPlan as never,
        getCampusDateFreshness: async () => missingFreshness(),
        countPersistedCampuses: async () => 3,
        now: recurringNow,
      });

      expect(result.ok).toBe(false);
      expect(result.writesPerformed).toBe(3);
      expect(persistedCampuses(persistPlan)).not.toContain(staleCampus);
      expect(result.campuses).toContainEqual(
        expect.objectContaining({
          campus: staleCampus,
          status: "preview_failed",
          error: `Expected ${expectedServiceDate}, received 2026-06-28`,
        }),
      );
    },
  );

  it.each(campusCodes)(
    "isolates a %s database failure and preserves the other commits",
    async (failedCampus) => {
      const persistPlan = vi.fn(async (value: IngestionPlan) => {
        if (value.campus === failedCampus) throw new Error("database unavailable");
        return { ingestRunId: value.campus };
      });

      const result = await runRecurringPcoIngestion({
        buildCampusPlan: async (campus: PcoCampus) =>
          plan(campus.code, `plan-${campus.code}`),
        persistPlan: persistPlan as never,
        getCampusDateFreshness: async () => missingFreshness(),
        countPersistedCampuses: async () => 3,
        now: recurringNow,
      });

      expect(result.ok).toBe(false);
      expect(result.writesPerformed).toBe(3);
      expect(persistPlan).toHaveBeenCalledTimes(4);
      expect(result.campuses).toContainEqual(
        expect.objectContaining({
          campus: failedCampus,
          status: "write_failed",
          error: "database unavailable",
        }),
      );
      for (const committedCampus of campusCodes.filter(
        (code) => code !== failedCampus,
      )) {
        expect(result.campuses).toContainEqual(
          expect.objectContaining({
            campus: committedCampus,
            status: "committed",
          }),
        );
      }
    },
  );

  it.each(["missing", "incomplete"] as const)(
    "targets one %s campus while skipping three complete campuses",
    async (targetStatus) => {
      const targetCampus = "ELK";
      const getCampusDateFreshness = vi.fn(async (campus: PcoCampus) => {
        if (campus.code !== targetCampus) return completeFreshness(campus);
        return targetStatus === "missing"
          ? missingFreshness()
          : {
              status: "incomplete" as const,
              planId: 30,
              pcoPlanId: "existing-ELK",
              reasons: ["gap"],
            };
      });
      const buildCampusPlan = vi.fn(async (campus: PcoCampus) =>
        plan(campus.code, `recovered-${campus.code}`),
      );
      const persistPlan = vi.fn(async () => ({ ingestRunId: 1 }));

      const result = await runRecurringPcoIngestion({
        buildCampusPlan,
        persistPlan: persistPlan as never,
        getCampusDateFreshness,
        countPersistedCampuses: async () => 4,
        now: recurringNow,
      });

      expect(result.ok).toBe(true);
      expect(result.writesPerformed).toBe(1);
      expect(buildCampusPlan).toHaveBeenCalledTimes(1);
      expect(buildCampusPlan).toHaveBeenCalledWith(
        expect.objectContaining({ code: targetCampus }),
        expectedServiceDate,
      );
      expect(persistedCampuses(persistPlan)).toEqual([targetCampus]);
      expect(
        result.campuses.filter(({ status }) => status === "skipped_complete"),
      ).toHaveLength(3);
    },
  );

  it("keeps three complete campuses when the missing campus still fails", async () => {
    const targetCampus = "MG";
    const buildCampusPlan = vi.fn(async () => {
      throw new Error("No completed production service was found");
    });
    const persistPlan = vi.fn();

    const result = await runRecurringPcoIngestion({
      buildCampusPlan,
      persistPlan: persistPlan as never,
      getCampusDateFreshness: async (campus: PcoCampus) =>
        campus.code === targetCampus
          ? missingFreshness()
          : completeFreshness(campus),
      countPersistedCampuses: async () => 3,
      now: recurringNow,
    });

    expect(result.ok).toBe(false);
    expect(result.writesPerformed).toBe(0);
    expect(buildCampusPlan).toHaveBeenCalledTimes(1);
    expect(persistPlan).not.toHaveBeenCalled();
    expect(
      result.campuses.filter(({ status }) => status === "skipped_complete"),
    ).toHaveLength(3);
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ campus: targetCampus, status: "preview_failed" }),
    );
  });

  it("isolates a freshness-check exception and continues all other campuses", async () => {
    const failedCampus = "SLP";
    const persistPlan = vi.fn(async () => ({ ingestRunId: 1 }));

    const result = await runRecurringPcoIngestion({
      buildCampusPlan: async (campus: PcoCampus) =>
        plan(campus.code, `plan-${campus.code}`),
      persistPlan: persistPlan as never,
      getCampusDateFreshness: async (campus: PcoCampus) => {
        if (campus.code === failedCampus) throw new Error("freshness unavailable");
        return missingFreshness();
      },
      countPersistedCampuses: async () => 3,
      now: recurringNow,
    });

    expect(result.writesPerformed).toBe(3);
    expect(persistedCampuses(persistPlan)).not.toContain(failedCampus);
    expect(result.campuses).toContainEqual(
      expect.objectContaining({
        campus: failedCampus,
        status: "preview_failed",
        error: "freshness unavailable",
      }),
    );
  });

  it("normalizes an unexpected campus rejection without losing other results", async () => {
    const persistPlan = vi.fn(async () => ({ ingestRunId: 1 }));
    const result = await runRecurringPcoIngestion({
      buildCampusPlan: (async (campus: PcoCampus) =>
        campus.code === "MG"
          ? ({} as IngestionPlan)
          : plan(campus.code, `plan-${campus.code}`)) as never,
      persistPlan: persistPlan as never,
      getCampusDateFreshness: async () => missingFreshness(),
      countPersistedCampuses: async () => 3,
      now: recurringNow,
    });

    expect(result.writesPerformed).toBe(3);
    expect(result.campuses).toHaveLength(4);
    expect(result.campuses).toContainEqual(
      expect.objectContaining({ campus: "MG", status: "preview_failed" }),
    );
  });

  it("collects failures at different stages without blocking valid campuses", async () => {
    const result = await runRecurringPcoIngestion({
      buildCampusPlan: async (campus: PcoCampus) => {
        if (campus.code === "SLP") throw new Error("preview unavailable");
        return plan(campus.code, `plan-${campus.code}`);
      },
      persistPlan: (async (value: IngestionPlan) => {
        if (value.campus === "LV") throw new Error("write unavailable");
        return { ingestRunId: 1 };
      }) as never,
      getCampusDateFreshness: async () => missingFreshness(),
      countPersistedCampuses: async () => 2,
      now: recurringNow,
    });

    expect(result.writesPerformed).toBe(2);
    expect(result.campuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ campus: "SLP", status: "preview_failed" }),
        expect.objectContaining({ campus: "MG", status: "committed" }),
        expect.objectContaining({ campus: "ELK", status: "committed" }),
        expect.objectContaining({ campus: "LV", status: "write_failed" }),
      ]),
    );
  });

  it("returns four explicit failures when every preview fails", async () => {
    const persistPlan = vi.fn();
    const result = await runRecurringPcoIngestion({
      buildCampusPlan: async (campus: PcoCampus) => {
        throw new Error(`unqualified ${campus.code}`);
      },
      persistPlan: persistPlan as never,
      getCampusDateFreshness: async () => missingFreshness(),
      countPersistedCampuses: async () => 0,
      now: recurringNow,
    });

    expect(result.ok).toBe(false);
    expect(result.writesPerformed).toBe(0);
    expect(persistPlan).not.toHaveBeenCalled();
    expect(result.campuses).toHaveLength(4);
    expect(result.campuses.every(({ status }) => status === "preview_failed")).toBe(
      true,
    );
  });

  it("skips all complete campuses and succeeds without a new write", async () => {
    const buildCampusPlan = vi.fn();
    const persistPlan = vi.fn();
    const result = await runRecurringPcoIngestion({
      buildCampusPlan: buildCampusPlan as never,
      persistPlan: persistPlan as never,
      getCampusDateFreshness: async (campus: PcoCampus) =>
        completeFreshness(campus),
      countPersistedCampuses: async () => 4,
      now: recurringNow,
    });

    expect(result.ok).toBe(true);
    expect(result.writesPerformed).toBe(0);
    expect(buildCampusPlan).not.toHaveBeenCalled();
    expect(persistPlan).not.toHaveBeenCalled();
    expect(
      result.campuses.every(({ status }) => status === "skipped_complete"),
    ).toBe(true);
  });

  it("does not report success when four writes verify as only three campuses", async () => {
    const result = await runRecurringPcoIngestion({
      buildCampusPlan: async (campus: PcoCampus) =>
        plan(campus.code, `plan-${campus.code}`),
      persistPlan: (async () => ({ ingestRunId: 1 })) as never,
      getCampusDateFreshness: async () => missingFreshness(),
      countPersistedCampuses: async () => 3,
      now: recurringNow,
    });

    expect(result.ok).toBe(false);
    expect(result.writesPerformed).toBe(4);
    expect(result.verification).toEqual({
      successfulLocations: 3,
      expectedLocations: 4,
    });
  });

  it("keeps campus association and configured order when previews settle out of order", async () => {
    const resolvers = new Map<string, (value: IngestionPlan) => void>();
    const buildCampusPlan = vi.fn(
      (campus: PcoCampus) =>
        new Promise<IngestionPlan>((resolve) => {
          resolvers.set(campus.code, resolve);
        }),
    );
    const run = runRecurringPcoIngestion({
      buildCampusPlan,
      persistPlan: (async () => ({ ingestRunId: 1 })) as never,
      getCampusDateFreshness: async () => missingFreshness(),
      countPersistedCampuses: async () => 4,
      now: recurringNow,
    });

    await vi.waitFor(() => expect(resolvers.size).toBe(4));
    for (const code of [...campusCodes].reverse()) {
      resolvers.get(code)?.(plan(code, `plan-${code}`));
    }
    const result = await run;

    expect(result.campuses.map(({ campus }) => campus)).toEqual(campusCodes);
    for (const campus of result.campuses) {
      expect(campus.pcoPlanId).toBe(`plan-${campus.campus}`);
    }
  });
});

describe("persisted plan freshness", () => {
  it("uses the same completeness evaluator for PCO-plan and campus-date lookups", async () => {
    const readRowsMock = vi.mocked(readRows);
    readRowsMock.mockReset();
    readRowsMock.mockImplementation(
      (async (table: string) => {
        if (table === "campuses") return [{ id: 10 }];
        if (table === "plans") {
          return [{ id: 20, pco_plan_id: "plan-SLP" }];
        }
        if (table === "effective_plan_times") {
          return [
            {
              id: 30,
              effective_slot_id: 1,
              live_starts_at: "2026-07-05T14:00:00Z",
              live_ends_at: "2026-07-05T15:00:00Z",
            },
            {
              id: 31,
              effective_slot_id: 2,
              live_starts_at: "2026-07-05T16:00:00Z",
              live_ends_at: "2026-07-05T17:00:00Z",
            },
          ];
        }
        if (table === "element_variance") {
          return [
            { plan_time_id: 30, actual_is_complete: true },
            { plan_time_id: 31, actual_is_complete: true },
          ];
        }
        if (table === "review_incidents") return [];
        throw new Error(`Unexpected table ${table}`);
      }) as never,
    );
    const campus = PCO_CAMPUSES[0];

    const byPcoPlan = await getPlanFreshness(campus, "plan-SLP");
    const byCampusDate = await getCampusDateFreshness(
      campus,
      expectedServiceDate,
    );

    expect(byPcoPlan).toEqual({
      status: "complete",
      planId: 20,
      pcoPlanId: "plan-SLP",
    });
    expect(byCampusDate).toEqual(byPcoPlan);
    expect(readRowsMock).toHaveBeenCalledWith(
      "plans",
      expect.objectContaining({
        campus_id: "eq.10",
        service_date: `eq.${expectedServiceDate}`,
      }),
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
        return {
          status: "complete" as const,
          planId: 1,
          pcoPlanId: `plan-${campus.serviceTypeId}`,
        };
      }
      if (campus.code === "MG") {
        return {
          status: "incomplete" as const,
          planId: 2,
          pcoPlanId: `plan-${campus.serviceTypeId}`,
          reasons: ["gap"],
        };
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
