import { describe, expect, it } from "vitest";
import type { AnalyzedItem } from "../../shared/api";
import { type EditableItem, editable, portionLabel, setPortionQty } from "./portion";

/** #58. The property this file exists for is **drift**, and it is the one a
 *  screenshot and a single tap both miss: a rescale that starts from the
 *  current numbers instead of the as-read ones compounds a rounding error on
 *  every adjustment, and every individual step still looks right.
 *
 *  The second property is that `edited` keeps meaning what #16/#76 made it
 *  mean — "the user overrode the AI's numbers" — which a portion change is
 *  not. That one is invisible until a week of logs is being read back. */

const PIZZA: AnalyzedItem = {
  name: "Pepperoni pizza",
  calories: 285,
  protein_g: 12.3,
  carbs_g: 35.7,
  fat_g: 10.4,
  confidence: 0.7,
  portion: { qty: 2, unit: "slices" },
};

/** `isEdited`'s rule, restated here rather than imported: it lives inside
 *  `Log.tsx` beside the component, and the point of these assertions is that a
 *  portion change leaves the item indistinguishable from an untouched read. */
const edited = (it: EditableItem) =>
  it.name !== it.orig.name ||
  it.calories !== it.orig.calories ||
  it.protein_g !== it.orig.protein_g ||
  it.carbs_g !== it.orig.carbs_g ||
  it.fat_g !== it.orig.fat_g;

describe("setPortionQty", () => {
  it("scales every number up, and the portion with them", () => {
    const four = setPortionQty(editable(PIZZA), 4);
    expect(four).toMatchObject({
      calories: 570,
      protein_g: 24.6,
      carbs_g: 71.4,
      fat_g: 20.8,
      portion: { qty: 4, unit: "slices" },
    });
  });

  it("scales down, halves included", () => {
    const one = setPortionQty(editable(PIZZA), 1);
    expect(one).toMatchObject({
      calories: 143, // 142.5 rounds up
      protein_g: 6.2, // 6.15 → 6.2
      carbs_g: 17.9, // 17.85 → 17.9 (round-half-up on the ×10)
      fat_g: 5.2,
      portion: { qty: 1, unit: "slices" },
    });
  });

  /* ── The round trip, and which of these walks actually proves anything ──
   *
   * #58 names 2 → 4 → 2 and 2 → 3 → 7 → 2. Both are true and both are
   * **decorative against the defect they were written for**: every step there
   * is a whole or half multiple of 285 / 12.3 / 35.7 / 10.4, so an
   * implementation that compounds from the current values instead of the
   * pristine base lands on exactly the same figures and the assertions stay
   * green. Verified by running them against that mutation, not assumed.
   *
   * They stay, as a regression guard and because they are the property the
   * issue asked for. The two walks below them are the ones that separate the
   * implementations, and any future change here should be broken against
   * *those*. */
  it("returns the ORIGINAL numbers on a round trip — 2 → 4 → 2", () => {
    const back = setPortionQty(setPortionQty(editable(PIZZA), 4), 2);
    expect(back.calories).toBe(285);
    expect(back.protein_g).toBe(12.3);
    expect(back.carbs_g).toBe(35.7);
    expect(back.fat_g).toBe(10.4);
    expect(back.portion).toEqual({ qty: 2, unit: "slices" });
  });

  it("survives a long walk away and back — 2 → 3 → 7 → 2", () => {
    const walked = [3, 7, 2].reduce(setPortionQty, editable(PIZZA));
    expect(walked.calories).toBe(285);
    expect(walked.protein_g).toBe(12.3);
    expect(walked.carbs_g).toBe(35.7);
    expect(walked.fat_g).toBe(10.4);
  });

  it("does not drift through a HALVING — 2 → 0.5 → 2", () => {
    // Compounding gives 284 / 12.4 / 35.6 here. Plausible, wrong, and the
    // whole reason `base` exists.
    const walked = [0.5, 2].reduce(setPortionQty, editable(PIZZA));
    expect([walked.calories, walked.protein_g, walked.carbs_g, walked.fat_g]).toEqual([
      285, 12.3, 35.7, 10.4,
    ]);
  });

  it("does not drift through a wide walk — 2 → 7 → 0.3 → 2", () => {
    // Compounding gives 287 / 12 / 36 / 10.7 — two kcal and a whole tenth of
    // every macro, after three taps.
    const walked = [7, 0.3, 2].reduce(setPortionQty, editable(PIZZA));
    expect([walked.calories, walked.protein_g, walked.carbs_g, walked.fat_g]).toEqual([
      285, 12.3, 35.7, 10.4,
    ]);
  });

  it("keeps the pristine base untouched through every adjustment", () => {
    const start = editable(PIZZA);
    const walked = [3, 7, 0.5, 12].reduce(setPortionQty, start);
    expect(walked.base).toEqual(PIZZA);
    // and the object identity is the same one, so nothing copied it forward
    expect(walked.base).toBe(start.base);
  });

  it("moves `orig` with the scaled values, so `edited` stays false", () => {
    const four = setPortionQty(editable(PIZZA), 4);
    expect(edited(four)).toBe(false);
    expect(four.orig.calories).toBe(four.calories);
    expect(four.orig.protein_g).toBe(four.protein_g);
    expect(four.orig.carbs_g).toBe(four.carbs_g);
    expect(four.orig.fat_g).toBe(four.fat_g);
  });

  it("still reports a real correction as an edit", () => {
    const four = setPortionQty(editable(PIZZA), 4);
    expect(edited({ ...four, calories: 600 })).toBe(true);
  });

  it("is a no-op for an item the reader gave no portion", () => {
    const vague = editable({ ...PIZZA, portion: null });
    expect(setPortionQty(vague, 4)).toBe(vague);
    const absent = editable({
      name: "Lunch out",
      calories: 700,
      protein_g: 30,
      carbs_g: 70,
      fat_g: 30,
      confidence: 0.3,
    });
    expect(setPortionQty(absent, 4)).toBe(absent);
  });

  it("holds at the bounds FOOD_LIMITS clamps to", () => {
    // The field clamps before it commits (0.1 … 100), so these are the two
    // values that can actually arrive here.
    const min = setPortionQty(editable(PIZZA), 0.1);
    expect(min).toMatchObject({ calories: 14, portion: { qty: 0.1, unit: "slices" } });
    const max = setPortionQty(editable(PIZZA), 100);
    expect(max).toMatchObject({ calories: 14250, portion: { qty: 100, unit: "slices" } });
    // and both come home
    expect(setPortionQty(min, 2).calories).toBe(285);
    expect(setPortionQty(max, 2).calories).toBe(285);
  });

  it("refuses a qty that would divide by zero or run backwards", () => {
    const start = editable(PIZZA);
    expect(setPortionQty(start, 0)).toBe(start);
    expect(setPortionQty(start, -3)).toBe(start);
    expect(setPortionQty(start, Number.NaN)).toBe(start);
    expect(setPortionQty(start, Number.POSITIVE_INFINITY)).toBe(start);
    // and a base that arrived unusable can't be scaled from either
    const rotten = editable({ ...PIZZA, portion: { qty: 0, unit: "slices" } });
    expect(setPortionQty(rotten, 4)).toBe(rotten);
  });

  it("scales a fractional as-read qty from its own basis", () => {
    // 1.5 cups → 3 cups is ×2, not ×3.
    const rice = editable({
      name: "Jasmine rice",
      calories: 210,
      protein_g: 4,
      carbs_g: 45,
      fat_g: 0,
      confidence: 0.6,
      portion: { qty: 1.5, unit: "cups" },
    });
    expect(setPortionQty(rice, 3)).toMatchObject({ calories: 420, carbs_g: 90 });
  });
});

describe("portionLabel", () => {
  it("prints the count and the unit, upper-cased for the row", () => {
    expect(portionLabel({ qty: 4, unit: "slices" })).toBe("4 SLICES");
    expect(portionLabel({ qty: 1.5, unit: "cups" })).toBe("1.5 CUPS");
  });

  it("drops a trailing zero — `4`, never `4.0`", () => {
    expect(portionLabel({ qty: 4.0, unit: "tacos" })).toBe("4 TACOS");
  });

  /** Deliberate, and it does read oddly: the reader hands back the unit it saw
   *  ("1 cup"), and scaling that to three prints `3 CUP`. Pinned here so the
   *  next reader knows nobody forgot. Fixing it needs English plurals — "slices"
   *  must not become "slicess", and "g"/"oz" must not become anything — which
   *  is a table this issue has no business inventing, and a half-working one
   *  would be wrong in more places than the wart it replaces. */
  it("does not pluralise — the unit is the reader's word, not ours", () => {
    expect(portionLabel({ qty: 3, unit: "cup" })).toBe("3 CUP");
    expect(portionLabel({ qty: 1, unit: "slices" })).toBe("1 SLICES");
  });

  it("says nothing at all when there is no portion", () => {
    expect(portionLabel(null)).toBeNull();
    expect(portionLabel(undefined)).toBeNull();
  });
});
