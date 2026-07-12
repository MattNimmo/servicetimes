import "server-only";

import { readRows } from "@/lib/supabase/rest";

const EXPECTED_LOCATIONS = 4;
const RETRY_WINDOW_END_UTC_HOUR = 21;
const RETRY_WINDOW_END_UTC_MINUTE = 4;

type IngestRunRow = {
  window_start: string | null;
  started_at: string;
};

type PlanRow = {
  campus_id: number;
};

export type IngestionHealth = {
  status: "current" | "pending" | "overdue";
  expectedServiceDate: string;
  successfulLocations: number;
  expectedLocations: number;
  latestSuccessfulDate: string | null;
  retryWindowEndsAt: string;
};

function chicagoCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function mostRecentChicagoSunday(now: Date) {
  const { year, month, day } = chicagoCalendarDate(now);
  const calendarDate = new Date(Date.UTC(year, month - 1, day, 12));
  calendarDate.setUTCDate(calendarDate.getUTCDate() - calendarDate.getUTCDay());
  return calendarDate.toISOString().slice(0, 10);
}

export function retryWindowEndsAt(serviceDate: string) {
  return new Date(
    `${serviceDate}T${String(RETRY_WINDOW_END_UTC_HOUR).padStart(2, "0")}:${String(RETRY_WINDOW_END_UTC_MINUTE).padStart(2, "0")}:59Z`,
  );
}

export async function getIngestionHealth(
  now: Date = new Date(),
): Promise<IngestionHealth> {
  const expectedServiceDate = mostRecentChicagoSunday(now);
  const [plans, rows] = await Promise.all([
    readRows<PlanRow>("plans", {
      service_date: `eq.${expectedServiceDate}`,
      select: "campus_id",
    }),
    readRows<IngestRunRow>("ingest_runs", {
      kind: "eq.actuals",
      status: "eq.ok",
      select: "window_start,started_at",
      order: "started_at.desc",
      limit: "100",
    }),
  ]);
  const successfulLocations = new Set(plans.map((plan) => plan.campus_id)).size;
  const latestSuccessfulDate =
    rows.find((row) => row.window_start !== null)?.window_start ?? null;
  const retryDeadline = retryWindowEndsAt(expectedServiceDate);

  return {
    status:
      successfulLocations >= EXPECTED_LOCATIONS
        ? "current"
        : now <= retryDeadline
          ? "pending"
          : "overdue",
    expectedServiceDate,
    successfulLocations,
    expectedLocations: EXPECTED_LOCATIONS,
    latestSuccessfulDate,
    retryWindowEndsAt: retryDeadline.toISOString(),
  };
}
