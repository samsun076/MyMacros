import { describe, expect, it } from "vitest";
import { BOUNDED_FIELDS, itemRefusal } from "./item-refusal";

/** #113. `POST /api/food-logs` refused a portion that pushed a food past the
 *  calorie ceiling with a bare `invalid_item` — naming no field, on a sheet
 *  where the last thing the person touched was the portion.
 *
 *  What is tested here is the *classification*, which is the whole of the fix:
 *  the bounds themselves are correct and are deliberately unchanged (see the
 *  module docstring — the unreachable band is inside the region both ceilings
 *  already call a typo, and narrowing either would refuse honest input to tidy
 *  up a case nobody reaches). `food-logs.route.test.ts` drives the same facts
 *  through real workerd; this proves the decision, that proves the route makes
 *  it. */
describe("itemRefusal", () => {
  const over = ["kcal"] as const;

  it("names the portion when a portion put the item over a bound", () => {
    expect(itemRefusal({ named: true, over, portioned: true })).toEqual({
      error: "item_over_limit",
      fields: ["portion_qty"],
      over: "kcal",
    });
  });

  /** The case #113 used to prove the defect was pre-existing rather than
   *  introduced by #107: posting the same over-limit item *without* the three
   *  portion columns returns the identical `invalid_item`. It still does, and
   *  it should — there is no field to blame, and blaming one would be a worse
   *  error message than the generic one rather than a better one. */
  it("stays generic when no portion was stated", () => {
    expect(itemRefusal({ named: true, over, portioned: false })).toEqual({ error: "invalid_item" });
  });

  it("stays generic when nothing was out of range", () => {
    // A malformed `confidence` reaches the same `return` and has nothing to do
    // with the amount. Attributing it to the portion would be a guess.
    expect(itemRefusal({ named: true, over: [], portioned: true })).toEqual({ error: "invalid_item" });
  });

  it("stays generic when the item has no name", () => {
    // The more actionable complaint, and not something a portion can cause.
    expect(itemRefusal({ named: false, over, portioned: true })).toEqual({ error: "invalid_item" });
  });

  it("reports each bound by its own name", () => {
    for (const field of BOUNDED_FIELDS) {
      expect(itemRefusal({ named: true, over: [field], portioned: true })).toEqual({
        error: "item_over_limit",
        fields: ["portion_qty"],
        over: field,
      });
    }
  });

  /** A portion large enough to break the kcal ceiling will usually break a
   *  macro ceiling too, so "which one do we name" has to be settled rather
   *  than left to fall out of iteration order — an error whose wording moved
   *  between two identical saves would read as flaky to whoever hit it twice. */
  it("names kcal first when several bounds fired", () => {
    expect(itemRefusal({ named: true, over: ["fat_g", "carbs_g", "kcal"], portioned: true })).toMatchObject({
      over: "kcal",
    });
  });

  it("names the earliest field in BOUNDED_FIELDS order, whatever order they arrive in", () => {
    expect(itemRefusal({ named: true, over: ["fat_g", "carbs_g"], portioned: true })).toMatchObject({
      over: "carbs_g",
    });
  });

  it("keeps kcal at the head of BOUNDED_FIELDS — it is the figure the sheet's footer shows", () => {
    expect(BOUNDED_FIELDS[0]).toBe("kcal");
  });
});
