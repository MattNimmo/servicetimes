import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { persistIngestionPlan } from "@/lib/pco/ingestion-writer";
import type { IngestionPlan } from "@/lib/pco/ingestion-plan";

const plan = {
  campus: "LV",
  dryRun: true,
  plan: { pcoPlanId: "plan-1" },
  planTimes: [],
  items: [],
  itemTimes: [],
  incidents: [],
  taxonomyReview: [],
  summary: { unmappedItemCount: 0 },
} as unknown as IngestionPlan;

describe("persistIngestionPlan", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    delete process.env.ENABLE_PCO_INGESTION_WRITES;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.ENABLE_PCO_INGESTION_WRITES;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("refuses to call Supabase while writes are disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistIngestionPlan(plan)).rejects.toThrow(
      "ENABLE_PCO_INGESTION_WRITES=true is required",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts one write-enabled payload to the atomic RPC", async () => {
    process.env.ENABLE_PCO_INGESTION_WRITES = "true";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ingestRunId: 1,
        pcoPlanId: "plan-1",
        planTimesUpserted: 0,
        itemsUpserted: 0,
        itemTimesUpserted: 0,
        incidentsObserved: 0,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistIngestionPlan(plan)).resolves.toMatchObject({
      ingestRunId: 1,
      pcoPlanId: "plan-1",
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/ingest_pco_plan");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body as string)).toMatchObject({
      payload: { campus: "LV", dryRun: false },
    });
  });

  it("returns a sanitized database error", async () => {
    process.env.ENABLE_PCO_INGESTION_WRITES = "true";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ message: "invalid ingestion payload" }, { status: 400 }),
      ),
    );

    await expect(persistIngestionPlan(plan)).rejects.toThrow(
      "Atomic ingestion failed (400): invalid ingestion payload",
    );
  });
});
