import "server-only";

import type { IngestionPlan } from "@/lib/pco/ingestion-plan";

type VerificationCheck = {
  check: string;
  expected: string | number;
  actual: string | number;
  pass: boolean;
};

export type IngestionVerification = {
  ok: boolean;
  checks: VerificationCheck[];
};

function requireEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

async function readRows<T>(table: string, params: Record<string, string>) {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Ingestion verification read failed for ${table} (${response.status})`);
  }

  return (await response.json()) as T[];
}

function groupedKinds(incidents: Array<{ kind: string }>) {
  const counts = new Map<string, number>();
  for (const { kind } of incidents) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}:${count}`)
    .join(", ");
}

function check(
  name: string,
  expected: string | number,
  actual: string | number,
): VerificationCheck {
  return { check: name, expected, actual, pass: expected === actual };
}

export async function verifyIngestionPlan(
  plan: IngestionPlan,
  ingestRunId: number,
): Promise<IngestionVerification> {
  const [runs, campuses, plans] = await Promise.all([
    readRows<{ id: number; status: string }>("ingest_runs", {
      id: `eq.${ingestRunId}`,
      select: "id,status",
    }),
    readRows<{ id: number; code: string }>("campuses", {
      code: `eq.${plan.campus}`,
      select: "id,code",
    }),
    readRows<{ id: number; campus_id: number }>("plans", {
      pco_plan_id: `eq.${plan.plan.pcoPlanId}`,
      select: "id,campus_id",
    }),
  ]);

  const run = runs[0];
  const campus = campuses[0];
  const persistedPlan = plans[0];
  const checks: VerificationCheck[] = [
    check("ingest run count", 1, runs.length),
    check("ingest run status", "ok", run?.status ?? "missing"),
    check("plan count", 1, plans.length),
    check(
      "plan campus",
      campus?.id ?? "missing campus",
      persistedPlan?.campus_id ?? "missing plan",
    ),
  ];

  if (!persistedPlan) return { ok: false, checks };

  const [planTimes, items] = await Promise.all([
    readRows<{
      id: number;
      pco_plan_time_id: string;
      detected_slot_id: number | null;
      slot_resolution_state: string;
      service_slots: { slot_label: string } | null;
    }>("plan_times", {
      plan_id: `eq.${persistedPlan.id}`,
      select:
        "id,pco_plan_time_id,detected_slot_id,slot_resolution_state,service_slots(slot_label)",
    }),
    readRows<{ id: number }>("items", {
      plan_id: `eq.${persistedPlan.id}`,
      select: "id",
    }),
  ]);

  checks.push(
    check("plan time count", plan.summary.planTimeCount, planTimes.length),
    check("item count", plan.summary.itemCount, items.length),
  );

  for (const expected of plan.planTimes) {
    const actual = planTimes.find(
      ({ pco_plan_time_id }) => pco_plan_time_id === expected.pcoPlanTimeId,
    );
    checks.push(
      check(
        `PlanTime ${expected.pcoPlanTimeId} slot`,
        expected.detectedSlotLabel ?? "unresolved",
        actual?.service_slots?.slot_label ?? "unresolved",
      ),
      check(
        `PlanTime ${expected.pcoPlanTimeId} state`,
        expected.slotResolutionState,
        actual?.slot_resolution_state ?? "missing",
      ),
    );
  }

  const planTimeIds = planTimes.map(({ id }) => id);
  const [itemTimes, incidents] = await Promise.all([
    planTimeIds.length === 0
      ? Promise.resolve([])
      : readRows<{ id: number }>("item_times", {
          plan_time_id: `in.(${planTimeIds.join(",")})`,
          select: "id",
        }),
    readRows<{ kind: string }>("review_incidents", {
      status: "eq.open",
      or:
        planTimeIds.length === 0
          ? `(plan_id.eq.${persistedPlan.id})`
          : `(plan_id.eq.${persistedPlan.id},plan_time_id.in.(${planTimeIds.join(",")}))`,
      select: "kind",
    }),
  ]);

  checks.push(
    check("item time count", plan.summary.itemTimeCount, itemTimes.length),
    check("open incident count", plan.summary.incidentCount, incidents.length),
    check("open incidents by kind", groupedKinds(plan.incidents), groupedKinds(incidents)),
  );

  return { ok: checks.every(({ pass }) => pass), checks };
}
