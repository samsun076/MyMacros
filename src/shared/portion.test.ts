import { describe, expect, it } from "vitest";
import { sameMacros, scaleMacros } from "./portion";

/** The scaling rule both sides of the wire now run (#58, #60).
 *
 *  `portion.test.ts` in `src/client/lib/` already pins what a rescale means to
 *  the *sheet* — that repeated adjustment does not drift, that `orig` moves
 *  with it so `edited` stays false. What is pinned here is narrower and is the
 *  reason the function moved: `PATCH /api/food-logs` recomputes this to decide
 *  whether a macro change was a correction or just a bigger portion, and that
 *  decision is an **equality**. An equality between two roundings is an
 *  equality that fails by one, and a 1 kcal gap here files an honest portion
 *  change as an override of the reader.
 *
 *  So the cases below are mostly about rounding: which figures land exactly,
 *  which land on a half, and that the rounding happens once on the product
 *  rather than twice on the way through.
 */

const PIZZA = { kcal: 360, protein_g: 12.3, carbs_g: 44, fat_g: 14 };

describe("scaleMacros (#60)", () => {
  it("doubles every figure when the portion doubles", () => {
    expect(scaleMacros(PIZZA, 2, 4)).toEqual({ kcal: 720, protein_g: 24.6, carbs_g: 88, fat_g: 28 });
  });

  /** The half that rounds: 12.3 / 2 is 6.15, and 1dp has to land it somewhere.
   *  `Math.round(61.499…)` is the whole reason the route may not do this
   *  arithmetic a second way. */
  it("rounds the macros to one decimal place on the way down", () => {
    expect(scaleMacros(PIZZA, 2, 1)).toEqual({ kcal: 180, protein_g: 6.2, carbs_g: 22, fat_g: 7 });
  });

  /** kcal is a whole number, because the column is. */
  it("rounds kcal to a whole number", () => {
    expect(scaleMacros({ kcal: 97, protein_g: 0, carbs_g: 0, fat_g: 0 }, 2, 3)?.kcal).toBe(146);
  });

  /** Scaling to the quantity it already has changes nothing — which is what
   *  makes "the portion explains the macros" a usable test rather than a
   *  tautology that fires on every save. */
  it("is the identity at the same quantity", () => {
    expect(scaleMacros(PIZZA, 2, 2)).toEqual(PIZZA);
  });

  /** Every rescale starts from the same pristine figures, so 2 → 4 → 2 comes
   *  back exactly rather than compounding. Stated here as well as in the
   *  client's own tests because this is now the function that guarantees it. */
  it("returns to the original figures through a round trip", () => {
    const up = scaleMacros(PIZZA, 2, 4);
    expect(scaleMacros(PIZZA, 2, 2)).toEqual(PIZZA);
    expect(up).not.toEqual(PIZZA);
  });

  it("scales fractional quantities", () => {
    expect(scaleMacros(PIZZA, 2, 3)).toEqual({ kcal: 540, protein_g: 18.5, carbs_g: 66, fat_g: 21 });
  });

  /** A zero divisor is a divide-by-zero and a zero target is a field being
   *  cleared, which has its own answer. Both are null rather than Infinity or
   *  a silent 0 — a route that read `NaN` here would compare it against a real
   *  number and quietly decide "not explained". */
  it("refuses a quantity of zero on either side", () => {
    expect(scaleMacros(PIZZA, 0, 4)).toBeNull();
    expect(scaleMacros(PIZZA, 2, 0)).toBeNull();
  });

  it("refuses a negative or non-finite quantity", () => {
    expect(scaleMacros(PIZZA, 2, -1)).toBeNull();
    expect(scaleMacros(PIZZA, Number.NaN, 4)).toBeNull();
    expect(scaleMacros(PIZZA, 2, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("sameMacros (#60)", () => {
  it("matches four identical figures", () => {
    expect(sameMacros(PIZZA, { ...PIZZA })).toBe(true);
  });

  /** **One kilocalorie is a difference.** No tolerance, because both sides
   *  reach the figure through `scaleMacros` — so the only way to be one off is
   *  to have typed it, and a window here would file a hand-edit as a portion
   *  change. Four separate assertions rather than a loop: a loop's later
   *  iterations never run once an earlier one throws, and a check that walked
   *  this table would report its first row and nothing else. */
  it("refuses a difference of one kilocalorie", () => {
    expect(sameMacros(PIZZA, { ...PIZZA, kcal: PIZZA.kcal + 1 })).toBe(false);
  });

  it("refuses a difference of a tenth of a gram of protein", () => {
    expect(sameMacros(PIZZA, { ...PIZZA, protein_g: 12.4 })).toBe(false);
  });

  it("refuses a difference of a tenth of a gram of carbs", () => {
    expect(sameMacros(PIZZA, { ...PIZZA, carbs_g: 44.1 })).toBe(false);
  });

  it("refuses a difference of a tenth of a gram of fat", () => {
    expect(sameMacros(PIZZA, { ...PIZZA, fat_g: 13.9 })).toBe(false);
  });
});
