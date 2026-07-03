// Shared non-production PlanTime name detection.
// Mirrors public.is_non_production_plan_time (see supabase migrations
// 20260625213000 + 20260702180000). Keep the two lists in sync.
export const NON_PRODUCTION_NAME_PATTERNS = [
  "rehearsal",
  "run through",
  "run-through",
  "walk through",
  "walk-through",
  "tech team",
  "tech-team",
  "translation",
  "instrumentalists",
  "vocalists",
  "broadcast audio",
  // MG names its morning run-through "Full service" — no rehearsal keyword.
  "full service",
] as const;

export function isNonProductionName(name: string | null): boolean {
  const lower = (name ?? "").toLowerCase();
  return NON_PRODUCTION_NAME_PATTERNS.some((pattern) => lower.includes(pattern));
}
