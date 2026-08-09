import { describe, expect, it } from "vitest";
import { fmtDayAgo } from "./format";

/** Local noon, so nothing here is a hair from a midnight boundary for the
 *  wrong reason — the calendar-day logic is what's under test, not the
 *  runner's timezone. */
const NOW = new Date(2026, 7, 9, 12, 0, 0);
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

describe("fmtDayAgo", () => {
  it("counts hours inside the first day", () => {
    expect(fmtDayAgo(at(2026, 7, 9, 0), NOW)).toBe("12h ago");
  });

  /** Minutes are what say whether a 30-minute sync is healthy — "0h ago"
   *  would be true and useless. */
  it("keeps minutes while they still mean something", () => {
    expect(fmtDayAgo(new Date(2026, 7, 9, 11, 40).toISOString(), NOW)).toBe("20m ago");
    expect(fmtDayAgo(new Date(2026, 7, 9, 11, 59, 45).toISOString(), NOW)).toBe("just now");
  });

  /** The case the whole format exists for: a laptop shut at 11pm, the app
   *  opened on a phone at 9am. Ten hours on a clock, "yesterday" to a human —
   *  and "yesterday" is the one you can act on. */
  it("prefers calendar days to 24-hour blocks", () => {
    const lateLastNight = new Date(2026, 7, 8, 23, 0).toISOString();
    const morning = new Date(2026, 7, 9, 9, 0);
    expect(fmtDayAgo(lateLastNight, morning)).toBe("yesterday");
  });

  it("names the weekday within the past week", () => {
    expect(fmtDayAgo(at(2026, 7, 6), NOW)).toBe("Thursday");
  });

  /** Past a week "last Thursday" stops being unambiguous. */
  it("falls back to a date beyond a week", () => {
    expect(fmtDayAgo(at(2026, 6, 28), NOW)).toBe("Jul 28");
  });

  it("doesn't crash on a timestamp it can't parse", () => {
    expect(fmtDayAgo("nonsense", NOW)).toBe("at some point");
  });
});
