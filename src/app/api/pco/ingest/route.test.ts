import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pco/recurring-ingestion", () => ({
  runRecurringPcoIngestion: vi.fn(),
  runRepairPcoIngestion: vi.fn(),
}));

import { GET, POST } from "@/app/api/pco/ingest/route";
import { GET as BACKFILL_GET } from "@/app/api/pco/ingest/backfill/route";
import {
  runRecurringPcoIngestion,
  runRepairPcoIngestion,
} from "@/lib/pco/recurring-ingestion";

const secret = "test-cron-secret-123";

function request(method = "GET", token = secret) {
  return new Request("https://servicetimes.example/api/pco/ingest", {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("recurring ingestion route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = secret;
    process.env.ENABLE_PCO_INGESTION_WRITES = "true";
    vi.mocked(runRecurringPcoIngestion).mockResolvedValue({
      ok: true,
      generatedAt: "2026-06-24T00:00:00.000Z",
      writesPerformed: 4,
      campuses: [],
    });
    vi.mocked(runRepairPcoIngestion).mockResolvedValue({
      ok: true,
      generatedAt: "2026-06-24T00:00:00.000Z",
      writesPerformed: 0,
      campuses: [],
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.ENABLE_PCO_INGESTION_WRITES;
  });

  it("rejects an invalid bearer token before doing work", async () => {
    const response = await GET(request("GET", "wrong-secret-value"));

    expect(response.status).toBe(401);
    expect(runRecurringPcoIngestion).not.toHaveBeenCalled();
  });

  it("refuses to run while database writes are disabled", async () => {
    process.env.ENABLE_PCO_INGESTION_WRITES = "false";

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(runRecurringPcoIngestion).not.toHaveBeenCalled();
  });

  it("supports authenticated Vercel GET and manual POST triggers", async () => {
    const getResponse = await GET(request());
    const postResponse = await POST(request("POST"));

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(runRecurringPcoIngestion).toHaveBeenCalledTimes(2);
  });

  it("returns a failing status for a partial campus failure", async () => {
    vi.mocked(runRecurringPcoIngestion).mockResolvedValue({
      ok: false,
      generatedAt: "2026-06-24T00:00:00.000Z",
      writesPerformed: 3,
      campuses: [],
    });

    const response = await GET(request());

    expect(response.status).toBe(502);
  });

  it("uses the same auth gates for the Monday repair route", async () => {
    const response = await BACKFILL_GET(request());

    expect(response.status).toBe(200);
    expect(runRepairPcoIngestion).toHaveBeenCalledTimes(1);
  });
});
