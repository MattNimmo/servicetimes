import "server-only";

import type { IngestionPlan } from "@/lib/pco/ingestion-plan";
import { requireSupabaseEnv } from "@/lib/supabase/rest";

const WRITE_FLAG = "ENABLE_PCO_INGESTION_WRITES";

export async function persistIngestionPlan(plan: IngestionPlan) {
  if (process.env[WRITE_FLAG] !== "true") {
    throw new Error(`${WRITE_FLAG}=true is required for database ingestion`);
  }

  if (!plan.dryRun) {
    throw new Error("Only a validated dry-run ingestion plan can be persisted");
  }

  const supabaseUrl = requireSupabaseEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireSupabaseEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/ingest_pco_plan`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ payload: { ...plan, dryRun: false } }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    let detail = "unknown database error";
    try {
      const body = (await response.json()) as { message?: string };
      detail = body.message ?? detail;
    } catch {
      // Keep the error deliberately free of response bodies and credentials.
    }
    throw new Error(`Atomic ingestion failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as {
    ingestRunId: number;
    pcoPlanId: string;
    planTimesUpserted: number;
    itemsUpserted: number;
    itemTimesUpserted: number;
    incidentsObserved: number;
  };
}
