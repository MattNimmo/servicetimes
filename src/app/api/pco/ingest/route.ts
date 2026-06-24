import { timingSafeEqual } from "node:crypto";

import { runRecurringPcoIngestion } from "@/lib/pco/recurring-ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request, secret: string) {
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function ingest(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json({ ok: false, error: "Cron authentication is not configured" }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.ENABLE_PCO_INGESTION_WRITES !== "true") {
    return Response.json({ ok: false, error: "Database ingestion is disabled" }, { status: 503 });
  }

  try {
    const result = await runRecurringPcoIngestion();
    return Response.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown recurring ingestion error",
      },
      { status: 502 },
    );
  }
}

export const GET = ingest;
export const POST = ingest;
