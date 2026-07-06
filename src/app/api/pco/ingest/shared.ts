import { timingSafeEqual } from "node:crypto";

type IngestResult = {
  ok: boolean;
  writesPerformed?: number;
};

function authorized(request: Request, secret: string) {
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function runSecuredPcoIngest(
  request: Request,
  label: string,
  run: () => Promise<IngestResult>,
) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    console.error(`[${label}] aborted: CRON_SECRET missing or < 16 chars`);
    return Response.json(
      { ok: false, error: "Cron authentication is not configured" },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    console.warn(`[${label}] aborted: unauthorized request (bearer token mismatch)`);
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.ENABLE_PCO_INGESTION_WRITES !== "true") {
    console.error(`[${label}] aborted: ENABLE_PCO_INGESTION_WRITES is not "true"`);
    return Response.json({ ok: false, error: "Database ingestion is disabled" }, { status: 503 });
  }

  try {
    const result = await run();
    console.info(
      `[${label}] complete: ok=${result.ok} writesPerformed=${result.writesPerformed ?? 0}`,
    );
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    console.error(`[${label}] threw:`, error instanceof Error ? error.message : "unknown");
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown recurring ingestion error",
      },
      { status: 502 },
    );
  }
}
