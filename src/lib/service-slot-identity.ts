export type ServiceSlotKey = "first" | "second";

const SLOT_ALIASES: Record<string, ServiceSlotKey> = {
  first: "first",
  "9am": "first",
  "9:00am": "first",
  "10am": "first",
  "10:00am": "first",
  second: "second",
  "10:30am": "second",
  "11am": "second",
  "11:00am": "second",
};

export function normalizeServiceSlotKey(value: string | null | undefined) {
  if (!value) return "first" as const;
  return SLOT_ALIASES[value.trim().toLowerCase()] ?? null;
}
