import { describe, expect, it } from "vitest";
import { localDay, mealSlotFor } from "./day";

/** #44's rules, pinned. Both functions read the *local* clock deliberately —
 *  the device owns the day boundary — so these assertions hold in any
 *  timezone the suite runs in, and none of them need a fake one.
 *
 *  M4 is why this matters now: `/api/sync` (#19) writes `ran_on` and
 *  `measured_on` from a script with no client present, which makes it a second
 *  writer with its own notion of "today". This file is the first writer's half
 *  of that contract written down. */
describe("localDay", () => {
  it("formats the local date, zero-padded", () => {
    expect(localDay(new Date(2026, 7, 7, 12, 0))).toBe("2026-08-07");
    expect(localDay(new Date(2026, 0, 1, 12, 0))).toBe("2026-01-01");
  });

  it("cuts at midnight — an 11pm meal belongs to that day", () => {
    expect(localDay(new Date(2026, 7, 7, 23, 59))).toBe("2026-08-07");
    expect(localDay(new Date(2026, 7, 8, 0, 0))).toBe("2026-08-08");
  });

  // explicitly not a 3-4am "late night" cutoff, settled on #44
  it("gives a 2am meal the new day", () => {
    expect(localDay(new Date(2026, 7, 8, 2, 0))).toBe("2026-08-08");
  });
});

describe("mealSlotFor", () => {
  const at = (h: number, m = 0) => mealSlotFor(new Date(2026, 7, 7, h, m));

  it("walks the day: <11 breakfast, <16 lunch, <21 dinner, else snack", () => {
    expect(at(0)).toBe("breakfast");
    expect(at(10, 59)).toBe("breakfast");
    expect(at(11)).toBe("lunch");
    expect(at(15, 59)).toBe("lunch");
    expect(at(16)).toBe("dinner");
    expect(at(20, 59)).toBe("dinner");
    expect(at(21)).toBe("snack");
    expect(at(23, 59)).toBe("snack");
  });
});
