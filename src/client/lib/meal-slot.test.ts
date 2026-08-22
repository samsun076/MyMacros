import { describe, expect, it } from "vitest";
import type { MealSlot } from "../../shared/api";
import { mealSlotFor } from "./day";
import { SLOT_TICK_SLACK_MS, msUntilSlotChange } from "./meal-slot";

/** #116's arithmetic, in the project that can reach it.
 *
 *  The hook itself is eight lines of React and lives in the layer CLAUDE.md
 *  says has no oracle — nothing in this repo executes a component. What is
 *  testable is the question it asks: *how long until the answer changes?* The
 *  wiring is asserted from the source in `tools/sheet-drag.test.mjs` and driven
 *  under CDP with an offset clock; this file is the part with real arithmetic
 *  in it, and it is here for the reason `lib/keyboard.ts` is.
 *
 *  Every case below is stated in *minutes to the boundary* rather than in a
 *  restated schedule, so this file does not become the second copy of 11/16/21
 *  that `msUntilSlotChange` was written to avoid. */
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (h: number, m = 0, s = 0) => new Date(2026, 7, 7, h, m, s);

describe("msUntilSlotChange", () => {
  it("counts to the next boundary from inside a slot", () => {
    // 09:30 is breakfast; breakfast ends at 11:00 — 90 minutes away.
    expect(msUntilSlotChange(at(9, 30))).toBe(90 * MIN);
    // 12:01 is lunch; lunch ends at 16:00.
    expect(msUntilSlotChange(at(12, 1))).toBe(3 * HOUR + 59 * MIN);
    // 20:59:30 is dinner, thirty seconds of it left.
    expect(msUntilSlotChange(at(20, 59, 30))).toBe(30_000);
  });

  it("is never zero, standing exactly on a boundary", () => {
    // The instant the slot changes, the *next* change is a full slot away —
    // a zero here would re-arm a timer that fires immediately, forever.
    expect(msUntilSlotChange(at(11, 0, 0))).toBe(5 * HOUR);
    expect(msUntilSlotChange(at(16, 0, 0))).toBe(5 * HOUR);
    expect(msUntilSlotChange(at(21, 0, 0))).toBe(3 * HOUR);
  });

  it("crosses midnight to turn snack back into breakfast", () => {
    // The only boundary that is also a date change, and the one a schedule
    // written as [11, 16, 21] would silently miss.
    expect(msUntilSlotChange(at(23, 30))).toBe(30 * MIN);
    expect(msUntilSlotChange(at(21, 0, 0))).toBe(3 * HOUR);
  });

  it("agrees with mealSlotFor at both ends of every wait it reports", () => {
    // The claim the hook actually depends on, stated as a property rather than
    // as a table: whatever it returns, the slot is unchanged one millisecond
    // before it and changed at it. A table of four answers would pass while
    // being off by an hour everywhere.
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 17, 59]) {
        const now = at(h, m);
        const ms = msUntilSlotChange(now);
        const before = new Date(now.getTime() + ms - 1);
        const after = new Date(now.getTime() + ms);
        expect(mealSlotFor(before), `${h}:${m} minus 1ms`).toBe(mealSlotFor(now));
        expect(mealSlotFor(after), `${h}:${m} at the boundary`).not.toBe(mealSlotFor(now));
      }
    }
  });

  it("never reports a wait longer than the longest slot", () => {
    // Breakfast is the longest at eleven hours. A search that fell through to
    // the fallback would show up here as an hour on a clock that has a
    // boundary minutes away, and the property test above would not see it.
    for (let h = 0; h < 24; h++) {
      expect(msUntilSlotChange(at(h)), `${h}:00`).toBeLessThanOrEqual(11 * HOUR);
      expect(msUntilSlotChange(at(h)), `${h}:00`).toBeGreaterThan(0);
    }
  });

  it("degrades to an hour when nothing ever changes", () => {
    // Not reachable through `mealSlotFor`, and that is the point of being able
    // to pass a different reader: the fallback is what a future schedule with
    // one slot in it would hit, and an unbounded search there would hang the
    // tab rather than merely be wrong.
    const always = (): MealSlot => "lunch";
    expect(msUntilSlotChange(at(9, 30), always)).toBe(HOUR);
  });
});

describe("SLOT_TICK_SLACK_MS", () => {
  /** The re-read has to land *inside* the new slot, or the bar shows the old
   *  answer for a frame after a clock that stepped backwards. */
  it("pushes the re-read past the boundary", () => {
    expect(SLOT_TICK_SLACK_MS).toBeGreaterThan(0);
    // 20:59:59.500 → 500ms of wait; with the slack the re-read lands after
    // 21:00:00, which mealSlotFor answers as the new slot.
    const now = at(20, 59, 59);
    const ms = msUntilSlotChange(new Date(now.getTime() + 500)) + SLOT_TICK_SLACK_MS;
    const woke = new Date(now.getTime() + 500 + ms);
    expect(mealSlotFor(woke)).not.toBe(mealSlotFor(now));
  });

  /** **And it is a ceiling on a disagreement, which is the reason it is small.**
   *  `relog` stamps the row from `mealSlotFor()` at the moment of the tap, so
   *  for this long after a boundary the bar is behind the write it describes.
   *  A "comfortable" few seconds here would be a few seconds of the statement
   *  naming the wrong meal on the one screen where a tap is an unconfirmed
   *  write — which is #116's own complaint with a smaller number on it. */
  it("bounds how long the bar can lag the row it describes", () => {
    expect(SLOT_TICK_SLACK_MS).toBeLessThanOrEqual(500);
  });
});
