import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IngestionPlan } from "@/lib/pco/ingestion-plan";
import { runIngestionCli } from "./ingest-weekend";

const plan = {
  campus: "SLP",
  dryRun: true,
  plan: { pcoPlanId: "plan-1", serviceDate: "2026-06-22" },
  planTimes: [
    {
      pcoPlanTimeId: "time-1",
      detectedSlotLabel: "9am",
      slotResolutionState: "auto",
    },
  ],
  items: [],
  itemTimes: [],
  incidents: [],
  taxonomyReview: [],
  summary: {
    productionSlotCount: 2,
    matchedSlotCount: 1,
    autoResolvedSlotCount: 1,
    planTimeCount: 1,
    itemCount: 0,
    itemTimeCount: 0,
    unmappedItemCount: 0,
    taxonomyReviewByReason: {},
    incidentCount: 0,
  },
} as unknown as IngestionPlan;

function dependencies() {
  return {
    buildCampusPlan: vi.fn().mockResolvedValue(plan),
    persistPlan: vi.fn().mockResolvedValue({
      ingestRunId: 17,
      pcoPlanId: "plan-1",
      planTimesUpserted: 1,
      itemsUpserted: 0,
      itemTimesUpserted: 0,
      incidentsObserved: 0,
    }),
    verifyPlan: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
    log: vi.fn(),
  };
}

describe("ingest-weekend", () => {
  beforeEach(() => delete process.env.ENABLE_PCO_INGESTION_WRITES);
  afterEach(() => delete process.env.ENABLE_PCO_INGESTION_WRITES);

  it("defaults to an SLP dry-run without calling the writer", async () => {
    const deps = dependencies();

    await runIngestionCli([], deps);

    expect(deps.buildCampusPlan).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SLP", serviceTypeId: "31424" }),
    );
    expect(deps.persistPlan).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("Dry-run: SLP"));
  });

  it("refuses commit before calling the writer when writes are disabled", async () => {
    const deps = dependencies();

    await expect(runIngestionCli(["--commit"], deps)).rejects.toThrow(
      "ENABLE_PCO_INGESTION_WRITES=true is required",
    );
    expect(deps.persistPlan).not.toHaveBeenCalled();
  });

  it("commits one campus and prints the returned counts", async () => {
    process.env.ENABLE_PCO_INGESTION_WRITES = "true";
    const deps = dependencies();

    await runIngestionCli(["--campus", "SLP", "--commit"], deps);

    expect(deps.persistPlan).toHaveBeenCalledOnce();
    expect(deps.persistPlan).toHaveBeenCalledWith(plan);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('"ingestRunId":17'));
  });

  it("uses the committed run ID for verification", async () => {
    process.env.ENABLE_PCO_INGESTION_WRITES = "true";
    const deps = dependencies();

    await runIngestionCli(["--commit", "--verify"], deps);

    expect(deps.verifyPlan).toHaveBeenCalledWith(plan, 17);
  });

  it("requires an explicit run ID for standalone verification", async () => {
    const deps = dependencies();

    await expect(runIngestionCli(["--verify"], deps)).rejects.toThrow(
      "Standalone --verify requires --ingest-run-id",
    );
    expect(deps.buildCampusPlan).not.toHaveBeenCalled();
  });
});
