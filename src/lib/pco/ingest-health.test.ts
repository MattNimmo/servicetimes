import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/rest", () => ({ readRows: vi.fn() }));

import { getIngestionHealth, mostRecentChicagoSunday } from "@/lib/pco/ingest-health";
import { readRows } from "@/lib/supabase/rest";

describe("ingestion health", () => {
  beforeEach(() =>
    vi.mocked(readRows).mockImplementation(async () => []),
  );

  it("uses the most recent Chicago Sunday across UTC day boundaries", () => {
    expect(mostRecentChicagoSunday(new Date("2026-07-13T02:00:00Z"))).toBe("2026-07-12");
    expect(mostRecentChicagoSunday(new Date("2026-07-15T12:00:00Z"))).toBe("2026-07-12");
  });

  it("keeps the Hobby retry window pending through 21:04 UTC", async () => {
    const health = await getIngestionHealth(new Date("2026-07-12T19:24:00Z"));

    expect(health.status).toBe("pending");
    expect(health.expectedServiceDate).toBe("2026-07-12");
    expect(health.retryWindowEndsAt).toBe("2026-07-12T21:04:59.000Z");
  });

  it("marks a missing Sunday run overdue after the retry window", async () => {
    vi.mocked(readRows).mockImplementation(async (table) =>
      table === "ingest_runs"
        ? [{ window_start: "2026-07-05", started_at: "2026-07-06T10:52:00Z" }]
        : [],
    );

    const health = await getIngestionHealth(new Date("2026-07-12T21:05:00Z"));

    expect(health.status).toBe("overdue");
    expect(health.latestSuccessfulDate).toBe("2026-07-05");
  });

  it("requires all four successful location writes for the expected Sunday", async () => {
    vi.mocked(readRows).mockImplementation(async (table) =>
      table === "plans"
        ? Array.from({ length: 4 }, (_, index) => ({ campus_id: index + 1 }))
        : [
            { window_start: "2026-07-12", started_at: "2026-07-12T19:30:00Z" },
          ],
    );

    const health = await getIngestionHealth(new Date("2026-07-12T21:30:00Z"));

    expect(health.status).toBe("current");
    expect(health.successfulLocations).toBe(4);
  });
});
