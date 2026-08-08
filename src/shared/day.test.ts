import { describe, expect, it } from "vitest";
import { dayInTimezone } from "./day";

/** The case this exists for: a Worker running at 01:00 UTC is still on the
 *  previous day for everyone in the Americas, and the budget engine and
 *  /api/sync both write days with no client present to ask (#19, #44). */
describe("dayInTimezone", () => {
  it("is the previous day in New York late in the UTC evening", () => {
    const instant = new Date("2026-08-08T01:30:00Z");
    expect(dayInTimezone(instant, "UTC")).toBe("2026-08-08");
    expect(dayInTimezone(instant, "America/New_York")).toBe("2026-08-07");
  });

  it("is the next day in Sydney", () => {
    const instant = new Date("2026-08-07T20:00:00Z");
    expect(dayInTimezone(instant, "Australia/Sydney")).toBe("2026-08-08");
  });

  it("agrees with UTC in the middle of the UTC day", () => {
    const instant = new Date("2026-08-07T12:00:00Z");
    for (const tz of ["UTC", "America/New_York", "Europe/London", "Australia/Sydney"]) {
      expect(dayInTimezone(instant, tz)).toBe("2026-08-07");
    }
  });

  /** DST changes the offset mid-day, so the same UTC hour lands on different
   *  local dates either side of it. 2026-03-08 is when US clocks go forward
   *  (EST −5 → EDT −4) and 2026-11-01 is when they go back. */
  it("tracks the offset across a DST change", () => {
    const ny = (iso: string) => dayInTimezone(new Date(iso), "America/New_York");

    // 04:30Z, still EST: 23:30 the evening before
    expect(ny("2026-03-08T04:30:00Z")).toBe("2026-03-07");
    // 07:30Z the same morning, now EDT: 03:30, the 8th
    expect(ny("2026-03-08T07:30:00Z")).toBe("2026-03-08");

    // clocks go back at 06:00Z; 06:30Z is 01:30 EST, the repeated hour
    expect(ny("2026-11-01T06:30:00Z")).toBe("2026-11-01");
    // 03:30Z that morning is still 23:30 EDT on Halloween
    expect(ny("2026-11-01T03:30:00Z")).toBe("2026-10-31");
  });

  it("always answers YYYY-MM-DD", () => {
    expect(dayInTimezone(new Date("2026-01-05T12:00:00Z"), "UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to UTC rather than throwing on a bad timezone", () => {
    expect(dayInTimezone(new Date("2026-08-07T12:00:00Z"), "Not/AZone")).toBe("2026-08-07");
    expect(dayInTimezone(new Date("2026-08-07T12:00:00Z"), "")).toBe("2026-08-07");
  });
});
