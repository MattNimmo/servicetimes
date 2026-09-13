import type { ServiceSlotKey } from "@/lib/service-slot-identity";

export type { ServiceSlotKey } from "@/lib/service-slot-identity";

export type ServiceSlotSchedule = {
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  label: string;
  localStart: string;
  toleranceMinutes: number;
};

export type PcoCampusConfiguration = {
  code: "SLP" | "MG" | "ELK" | "LV";
  name: string;
  serviceTypeName: string;
  serviceTypeId: string;
  isBroadcastOrigin: boolean;
  timezone: string;
  slots: readonly {
    key: ServiceSlotKey;
    schedules: readonly ServiceSlotSchedule[];
  }[];
};

const unchangedSchedule = (
  label: string,
  localStart: string,
): readonly ServiceSlotSchedule[] => [
  {
    effectiveFrom: null,
    effectiveUntil: null,
    label,
    localStart,
    toleranceMinutes: 10,
  },
];

export function resolveServiceSlotSchedule(
  slot: PcoCampusConfiguration["slots"][number],
  serviceDate: string,
) {
  return (
    slot.schedules.find(
      (schedule) =>
        (schedule.effectiveFrom === null || serviceDate >= schedule.effectiveFrom) &&
        (schedule.effectiveUntil === null || serviceDate < schedule.effectiveUntil),
    ) ?? null
  );
}

export const PCO_CAMPUSES = [
  {
    code: "SLP",
    name: "Spring Lake Park",
    serviceTypeName: "SLP Weekend",
    serviceTypeId: "31424",
    isBroadcastOrigin: true,
    timezone: "America/Chicago",
    slots: [
      { key: "first", schedules: unchangedSchedule("9am", "09:00") },
      { key: "second", schedules: unchangedSchedule("11am", "11:00") },
    ],
  },
  {
    code: "MG",
    name: "Maple Grove",
    serviceTypeName: "MG Sunday",
    serviceTypeId: "380440",
    isBroadcastOrigin: false,
    timezone: "America/Chicago",
    slots: [
      { key: "first", schedules: unchangedSchedule("9am", "09:00") },
      { key: "second", schedules: unchangedSchedule("11am", "11:00") },
    ],
  },
  {
    code: "ELK",
    name: "Elk River",
    serviceTypeName: "ELK Sunday",
    serviceTypeId: "650973",
    isBroadcastOrigin: false,
    timezone: "America/Chicago",
    slots: [
      { key: "first", schedules: unchangedSchedule("9am", "09:00") },
      {
        key: "second",
        schedules: [
          {
            effectiveFrom: null,
            effectiveUntil: "2026-08-30",
            label: "11am",
            localStart: "11:00",
            toleranceMinutes: 10,
          },
          {
            effectiveFrom: "2026-08-30",
            effectiveUntil: null,
            label: "10:30am",
            localStart: "10:30",
            toleranceMinutes: 10,
          },
        ],
      },
    ],
  },
  {
    code: "LV",
    name: "Lakeville",
    serviceTypeName: "LV Sunday",
    serviceTypeId: "1176051",
    isBroadcastOrigin: false,
    timezone: "America/Chicago",
    slots: [{ key: "first", schedules: unchangedSchedule("10am", "10:00") }],
  },
] as const satisfies readonly PcoCampusConfiguration[];
