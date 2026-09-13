import "server-only";

import type { ServiceSlotKey } from "@/lib/service-slot-identity";
import { readRows } from "@/lib/supabase/rest";

type ServiceSlotScheduleRow = {
  id: number;
  campus_id: number;
  slot_key: ServiceSlotKey;
  is_active: boolean;
  is_run_through: boolean;
  schedule_id: number;
  effective_from: string | null;
  effective_until: string | null;
  slot_label: string;
  expected_local_start: string;
  match_tolerance_minutes: number;
};

export type ResolvedServiceSlot = Pick<
  ServiceSlotScheduleRow,
  | "id"
  | "campus_id"
  | "slot_key"
  | "is_active"
  | "is_run_through"
  | "slot_label"
  | "expected_local_start"
  | "match_tolerance_minutes"
>;

function coversServiceDate(row: ServiceSlotScheduleRow, serviceDate: string) {
  return (
    (row.effective_from === null || serviceDate >= row.effective_from) &&
    (row.effective_until === null || serviceDate < row.effective_until)
  );
}
export async function readServiceSlots(
  campusId: number,
  serviceDate: string,
  options: { activeOnly?: boolean } = {},
) {
  const rows = await readRows<ServiceSlotScheduleRow>(
    "service_slot_schedule_ranges",
    {
      campus_id: `eq.${campusId}`,
      ...(options.activeOnly === false ? {} : { is_active: "eq.true" }),
      is_run_through: "eq.false",
      select:
        "id,campus_id,slot_key,is_active,is_run_through,schedule_id,effective_from,effective_until,slot_label,expected_local_start,match_tolerance_minutes",
    },
  );

  return rows
    .filter((row) => coversServiceDate(row, serviceDate))
    .sort((left, right) =>
      left.expected_local_start.localeCompare(right.expected_local_start),
    );
}

export async function readServiceSlotsForCampuses(
  campusIds: number[],
  serviceDate: string,
) {
  if (campusIds.length === 0) return [];
  const rows = await readRows<ServiceSlotScheduleRow>(
    "service_slot_schedule_ranges",
    {
      campus_id: `in.(${campusIds.join(",")})`,
      is_active: "eq.true",
      is_run_through: "eq.false",
      select:
        "id,campus_id,slot_key,is_active,is_run_through,schedule_id,effective_from,effective_until,slot_label,expected_local_start,match_tolerance_minutes",
    },
  );
  return rows.filter((row) => coversServiceDate(row, serviceDate));
}
