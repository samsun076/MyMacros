import { describe, expect, it } from "vitest";
import { timelineView } from "./timeline";

/** #80's two predicted traps, pinned. Both are the same mistake — reading a
 *  list by position after changing which end is which — and both produce
 *  something that looks like a data bug rather than a layout one, which is
 *  why neither would be caught by a screenshot of a correct-looking screen. */

const day = [
  { when: "6:55 AM", id: "a" },
  { when: "12:37 PM", id: "b" },
  { when: "7:10 PM", id: "c" },
];

describe("the Today timeline's order (#80)", () => {
  it("renders newest first", () => {
    expect(timelineView(day, false).rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  /** The header must keep reading forwards while the list reads backwards.
   *  A reversed span prints "7:10P — 6:55A", which reads as corrupt data. */
  it("still spans earliest to latest, not first-rendered to last", () => {
    expect(timelineView(day, false).span).toBe("6:55A — 7:10P");
  });

  /** The wash means "this is the one you just added". On the oldest meal of
   *  the day it is worse than absent — it points at the wrong row with
   *  confidence. */
  it("puts the just-saved wash on the newest entry, which now renders first", () => {
    const { rows } = timelineView(day, true);
    expect(rows.map((r) => r.fresh)).toEqual([true, false, false]);
    expect(rows.find((r) => r.fresh)?.id).toBe("c");
  });

  it("washes nothing when this render doesn't follow a save", () => {
    expect(timelineView(day, false).rows.some((r) => r.fresh)).toBe(false);
  });

  it("names a single entry once rather than as a range", () => {
    const one = [{ when: "8:02 AM", id: "solo" }];
    expect(timelineView(one, false).span).toBe("8:02A");
    expect(timelineView(one, true).rows[0]?.fresh).toBe(true);
  });

  it("has a span for a day with nothing on it", () => {
    expect(timelineView([], false).span).toBe("—");
    expect(timelineView([], true).rows).toEqual([]);
  });

  /** Reversal must not be in place — `entries` stays chronological because
   *  the span reads it, and a caller may hold it across renders. */
  it("does not mutate the list it was given", () => {
    const input = [...day];
    timelineView(input, true);
    expect(input.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
