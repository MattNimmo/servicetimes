import { describe, expect, it } from "vitest";

import { normalizeServiceSlotKey } from "@/lib/service-slot-identity";

describe("service slot URL identity", () => {
  it.each(["9am", "9:00am", "10am", "10:00am", "first"])(
    "maps %s to the first service",
    (value) => expect(normalizeServiceSlotKey(value)).toBe("first"),
  );

  it.each(["10:30am", "11am", "11:00am", "second"])(
    "maps %s to the second service",
    (value) => expect(normalizeServiceSlotKey(value)).toBe("second"),
  );

  it("rejects unknown aliases instead of silently choosing a service", () => {
    expect(normalizeServiceSlotKey("late")).toBeNull();
  });
});
