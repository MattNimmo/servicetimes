export const PCO_CAMPUSES = [
  {
    code: "SLP",
    name: "Spring Lake Park",
    serviceTypeName: "SLP Weekend",
    serviceTypeId: "31424",
    isBroadcastOrigin: true,
    timezone: "America/Chicago",
    slots: [
      { label: "9am", localStart: "09:00", toleranceMinutes: 10 },
      { label: "11am", localStart: "11:00", toleranceMinutes: 10 },
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
      { label: "9am", localStart: "09:00", toleranceMinutes: 10 },
      { label: "11am", localStart: "11:00", toleranceMinutes: 10 },
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
      { label: "9am", localStart: "09:00", toleranceMinutes: 10 },
      { label: "11am", localStart: "11:00", toleranceMinutes: 10 },
    ],
  },
  {
    code: "LV",
    name: "Lakeville",
    serviceTypeName: "LV Sunday",
    serviceTypeId: "1176051",
    isBroadcastOrigin: false,
    timezone: "America/Chicago",
    slots: [{ label: "10am", localStart: "10:00", toleranceMinutes: 10 }],
  },
] as const;
