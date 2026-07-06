import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pco/client", () => ({
  normalizeNextPath: (next: string) => next,
  pcoGet: vi.fn(),
  pcoGetAll: vi.fn(),
}));

import { pcoGet, pcoGetAll } from "@/lib/pco/client";
import { fetchLatestCompletedPlan } from "@/lib/pco/fetch-plan";
import type { PcoCollection, PcoItem, PcoPlan, PcoPlanTime } from "@/lib/pco/types";

function collection<T>(data: T[]): PcoCollection<T> {
  return { data };
}

function plan(id: string, sortDate: string): PcoPlan {
  return {
    type: "Plan",
    id,
    attributes: {
      title: id,
      series_title: null,
      sort_date: sortDate,
      total_length: 3600,
    },
  };
}

function servicePlanTime(
  id: string,
  options: Partial<PcoPlanTime["attributes"]> = {},
): PcoPlanTime {
  return {
    type: "PlanTime",
    id,
    attributes: {
      starts_at: "2026-07-05T14:00:00Z",
      ends_at: "2026-07-05T15:00:00Z",
      live_starts_at: "2026-07-05T14:02:00Z",
      live_ends_at: "2026-07-05T15:04:00Z",
      name: "Service",
      recorded: true,
      time_type: "service",
      ...options,
    },
  };
}

const item: PcoItem = {
  type: "Item",
  id: "item-1",
  attributes: {
    title: "Message",
    item_type: "item",
    length: 1800,
    sequence: 1,
    service_position: "during",
  },
};

describe("fetchLatestCompletedPlan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T19:00:00Z"));
    vi.mocked(pcoGet).mockReset();
    vi.mocked(pcoGetAll).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers a future-bucketed plan whose service date has arrived", async () => {
    const oldPlan = plan("old", "2026-06-28T07:40:00Z");
    const todayPlan = plan("today", "2026-07-05T07:40:00Z");
    vi.mocked(pcoGet)
      .mockResolvedValueOnce(collection([oldPlan]))
      .mockResolvedValueOnce(collection([todayPlan]));
    vi.mocked(pcoGetAll)
      .mockResolvedValueOnce(collection([servicePlanTime("today-service")]))
      .mockResolvedValueOnce({ data: [item], included: [] });

    const result = await fetchLatestCompletedPlan("service-type");

    expect(result.plan.id).toBe("today");
    expect(pcoGetAll).toHaveBeenCalledWith(
      "/services/v2/service_types/service-type/plans/today/plan_times?per_page=100",
    );
  });

  it("skips an arrived future plan without recorded production bounds", async () => {
    const oldPlan = plan("old", "2026-06-28T07:40:00Z");
    const todayPlan = plan("today", "2026-07-05T07:40:00Z");
    vi.mocked(pcoGet)
      .mockResolvedValueOnce(collection([oldPlan]))
      .mockResolvedValueOnce(collection([todayPlan]));
    vi.mocked(pcoGetAll)
      .mockResolvedValueOnce(collection([servicePlanTime("today-service", { recorded: false })]))
      .mockResolvedValueOnce(collection([servicePlanTime("old-service")]))
      .mockResolvedValueOnce({ data: [item], included: [] });

    const result = await fetchLatestCompletedPlan("service-type");

    expect(result.plan.id).toBe("old");
  });

  it("ignores future weeks that have not arrived", async () => {
    const oldPlan = plan("old", "2026-06-28T07:40:00Z");
    const nextPlan = plan("next", "2026-07-12T07:40:00Z");
    vi.mocked(pcoGet)
      .mockResolvedValueOnce(collection([oldPlan]))
      .mockResolvedValueOnce(collection([nextPlan]));
    vi.mocked(pcoGetAll)
      .mockResolvedValueOnce(collection([servicePlanTime("old-service")]))
      .mockResolvedValueOnce({ data: [item], included: [] });

    const result = await fetchLatestCompletedPlan("service-type");

    expect(result.plan.id).toBe("old");
    expect(pcoGetAll).not.toHaveBeenCalledWith(
      "/services/v2/service_types/service-type/plans/next/plan_times?per_page=100",
    );
  });
});
