import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pco/recurring-ingestion", () => ({
  runRecurringPcoIngestion: vi.fn(),
  runRepairPcoIngestion: vi.fn(),
}));
vi.mock("@/lib/pco/ingest-health", () => ({
  getIngestionHealth: vi.fn(),
}));
vi.mock("@/lib/auth/github-actions-oidc", () => ({
  authorizeGitHubIngestWatchdog: vi.fn(async () => false),
}));

import { GET, POST } from "@/app/api/pco/ingest/route";
import { GET as BACKFILL_GET } from "@/app/api/pco/ingest/backfill/route";
import { POST as WATCHDOG_POST } from "@/app/api/pco/ingest/watchdog/route";
import { authorizeGitHubIngestWatchdog } from "@/lib/auth/github-actions-oidc";
import { getIngestionHealth } from "@/lib/pco/ingest-health";
import {
  runRecurringPcoIngestion,
  runRepairPcoIngestion,
} from "@/lib/pco/recurring-ingestion";

const secret = "test-cron-secret-123";

function request(method = "GET", token = secret, schedule?: string) {
  return new Request("https://servicetimes.example/api/pco/ingest", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(schedule ? { "x-vercel-cron-schedule": schedule } : {}),
    },
  });
}

describe("recurring ingestion route", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = secret;
    process.env.ENABLE_PCO_INGESTION_WRITES = "true";
    vi.mocked(runRecurringPcoIngestion).mockResolvedValue({
      ok: true,
      generatedAt: "2026-06-24T00:00:00.000Z",
      expectedServiceDate: "2026-06-21",
      writesPerformed: 4,
      verification: { successfulLocations: 4, expectedLocations: 4 },
      campuses: [],
    });
    vi.mocked(runRepairPcoIngestion).mockResolvedValue({
      ok: true,
      generatedAt: "2026-06-24T00:00:00.000Z",
      writesPerformed: 0,
      campuses: [],
    });
    vi.mocked(getIngestionHealth).mockResolvedValue({
      status: "pending",
      expectedServiceDate: "2026-06-21",
      successfulLocations: 3,
      expectedLocations: 4,
      latestSuccessfulDate: "2026-06-14",
      retryWindowEndsAt: "2026-06-21T21:04:59.000Z",
    });
    vi.mocked(authorizeGitHubIngestWatchdog).mockResolvedValue(false);
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
    const getResponse = await GET(request("GET", secret, "0 19 * * 0"));
    const postResponse = await POST(request("POST"));

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(getResponse.headers.get("cache-control")).toBe("no-store");
    expect(getResponse.headers.get("x-ingest-request-id")).toBeTruthy();
    expect(runRecurringPcoIngestion).toHaveBeenCalledTimes(2);
  });

  it("returns a failing status for a partial campus failure", async () => {
    vi.mocked(runRecurringPcoIngestion).mockResolvedValue({
      ok: false,
      generatedAt: "2026-06-24T00:00:00.000Z",
      expectedServiceDate: "2026-06-21",
      writesPerformed: 3,
      verification: { successfulLocations: 3, expectedLocations: 4 },
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

  it("runs recovery from the watchdog when freshness is incomplete", async () => {
    const response = await WATCHDOG_POST(request("POST"));

    expect(response.status).toBe(200);
    expect(getIngestionHealth).toHaveBeenCalledTimes(1);
    expect(runRecurringPcoIngestion).toHaveBeenCalledTimes(1);
  });

  it("accepts a verified GitHub OIDC token on the watchdog route", async () => {
    vi.mocked(authorizeGitHubIngestWatchdog).mockResolvedValue(true);

    const response = await WATCHDOG_POST(request("POST", "github-oidc-token"));

    expect(response.status).toBe(200);
    expect(authorizeGitHubIngestWatchdog).toHaveBeenCalledTimes(1);
    expect(runRecurringPcoIngestion).toHaveBeenCalledTimes(1);
  });

  it("skips watchdog writes when all locations are already current", async () => {
    vi.mocked(getIngestionHealth).mockResolvedValue({
      status: "current",
      expectedServiceDate: "2026-06-21",
      successfulLocations: 4,
      expectedLocations: 4,
      latestSuccessfulDate: "2026-06-21",
      retryWindowEndsAt: "2026-06-21T21:04:59.000Z",
    });

    const response = await WATCHDOG_POST(request("POST"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        ok: true,
        skipped: "already_current",
        verification: { successfulLocations: 4, expectedLocations: 4 },
      }),
    );
    expect(runRecurringPcoIngestion).not.toHaveBeenCalled();
  });
});
