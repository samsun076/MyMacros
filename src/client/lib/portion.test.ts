import { describe, expect, it } from "vitest";
import type { AnalyzedItem, FoodLog } from "../../shared/api";
import { FOOD_LIMITS, isMeasuredPortionUnit, portionQtyRule } from "./numeric";
import {
  blankItem,
  editable,
  editableFromLog,
  isEdited,
  portionLabel,
  savedGrams,
  savedPortion,
  setPortionQty,
} from "./portion";

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

/** `isEdited` itself since #59, where it was a local restatement of the rule
 *  while it lived inside `Log.tsx`. The point of these assertions is unchanged
 *  — a portion change leaves the item indistinguishable from an untouched read
 *  — but they are now made against the function the save actually calls, and a
 *  copy of a rule beside its own tests is the register's defect in miniature. */
const edited = isEdited;

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

/** #104. The column exists to answer "the model said two and they ate four",
 *  and there is exactly one way to get that wrong while producing a
 *  well-formed row: read the AI's qty off `orig` instead of `base`. #58 moves
 *  `orig` with a rescale on purpose, so after one tap `orig.portion.qty` IS
 *  the user's number — the row would then say the reader counted four, which
 *  is a lie that no later pass can detect, let alone correct. */
describe("savedPortion", () => {
  it("sends the count the user settled on", () => {
    expect(savedPortion(setPortionQty(editable(PIZZA), 4))?.portion_qty).toBe(4);
  });

  it("sends the AS-READ count as the reader's, not the scaled one", () => {
    // `orig.portion.qty` is 4 here. Reading it would be the whole defect.
    expect(savedPortion(setPortionQty(editable(PIZZA), 4))?.ai_portion_qty).toBe(2);
  });

  it("keeps the reader's count through a long walk, not just one tap", () => {
    const walked = [3, 7, 0.5].reduce(setPortionQty, editable(PIZZA));
    expect(savedPortion(walked)?.ai_portion_qty).toBe(2);
  });

  it("carries the unit the reader chose, unchanged", () => {
    expect(savedPortion(setPortionQty(editable(PIZZA), 4))?.portion_unit).toBe("slices");
  });

  /** An unscaled save writes them EQUAL, never null — 0006's rule, and the
   *  reason "the reader agreed" is distinguishable from "nobody looked". */
  it("writes both counts on an UNSCALED save rather than withholding them", () => {
    expect(savedPortion(editable(PIZZA))).toEqual({
      portion_qty: 2,
      portion_unit: "slices",
      ai_portion_qty: 2,
    });
  });

  it("withholds everything for a read that proposed no portion", () => {
    expect(savedPortion(editable({ ...PIZZA, portion: null }))).toBeNull();
  });

  it("withholds everything for #16's blank row, which has no portion key", () => {
    const blank = editable({
      name: "",
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      confidence: null,
    });
    expect(savedPortion(blank)).toBeNull();
  });
});

/** #107, and it is #104's defect one control over. The barcode sheet's HOW
 *  MUCH field has rescaled every macro since #15 and the number itself has
 *  never been saved — so a row says "Greek yoghurt, 2%, 146 kcal" and nothing
 *  on it says whether that was 100 g, 150 g or the tub.
 *
 *  There is exactly one way to get this wrong while producing a well-formed
 *  row, and it is the same shape `savedPortion` names: read the reader's
 *  amount off something a rescale has already moved. At read level that is
 *  `read.grams`. It is worse here than it is one level down, because
 *  `setGrams` rebuilds every row with `editable(scaled)` — which moves BOTH
 *  `orig` and `base` — so after one adjustment `read.baseGrams` is the only
 *  surviving copy of what the read arrived at, anywhere in the app.
 *
 *  **The figures below are 150 over a base of 100 on purpose.** An unscaled
 *  save has the two equal, so it cannot tell a correct implementation from one
 *  reading `grams` twice — every assertion about provenance has to be made
 *  against a sheet somebody has actually adjusted. */
describe("savedGrams", () => {
  /** A 150 g helping of a product the reader opened at 100 g. */
  const SCALED = { grams: 150, baseGrams: 100 };

  it("sends the grams the user settled on", () => {
    expect(savedGrams(SCALED)?.portion_qty).toBe(150);
  });

  it("sends the AS-READ grams as the reader's, not the scaled ones", () => {
    // `read.grams` is 150 here. Reading it would be the whole defect.
    expect(savedGrams(SCALED)?.ai_portion_qty).toBe(100);
  });

  it("labels the amount in grams", () => {
    expect(savedGrams(SCALED)?.portion_unit).toBe("g");
  });

  /** The #109 interlock, asserted where the label is chosen. The save route
   *  reads this string to pick the qty ceiling, so a label that fell out of
   *  MEASURED_PORTION_UNITS would bound a gram weight at 100 and refuse the
   *  150 above — a 400 on the save, from a change nowhere near it. */
  it("labels it with a MEASURED unit, or the route bounds grams at 100", () => {
    expect(isMeasuredPortionUnit(savedGrams(SCALED)?.portion_unit)).toBe(true);
  });

  /** The other half: same list, same number. #109 derived
   *  `portion_qty_measured.max` from `grams.max` precisely so "the field
   *  accepted it" and "the route will store it" are one statement. */
  it("and that unit's ceiling is the grams field's own ceiling", () => {
    expect(portionQtyRule(savedGrams(SCALED)?.portion_unit).max).toBe(FOOD_LIMITS.grams.max);
  });

  /** 0006's rule, at the read level: equal, never null. "The reader's amount
   *  was right" must not look like "nobody recorded the reader's amount". */
  it("writes both amounts on an UNTOUCHED read rather than withholding them", () => {
    expect(savedGrams({ grams: 100, baseGrams: 100 })).toEqual({
      portion_qty: 100,
      portion_unit: "g",
      ai_portion_qty: 100,
    });
  });

  it("withholds everything for a photo or text read, which has no grams", () => {
    expect(savedGrams({})).toBeNull();
  });

  /** The boundary #109 left standing: a value the field accepts must reach the
   *  column, or the ceiling silently became a refusal. */
  it("carries the field's ceiling through — 2,000 g", () => {
    expect(savedGrams({ grams: 2000, baseGrams: 2000 })?.portion_qty).toBe(2000);
  });

  it("carries the field's floor through — 1 g", () => {
    expect(savedGrams({ grams: 1, baseGrams: 1 })?.portion_qty).toBe(1);
  });

  /** `defaultGrams` is not the field's number: it echoes OpenFoodFacts'
   *  contributor-entered `serving_quantity`, which can be anything. Sending it
   *  would 400 the whole save and make the product unloggable. */
  it("withholds when the AS-READ amount is above what the route accepts", () => {
    expect(savedGrams({ grams: 150, baseGrams: 5000 })).toBeNull();
  });

  it("withholds when a sub-gram serving rounded the read down to zero", () => {
    expect(savedGrams({ grams: 0, baseGrams: 0 })).toBeNull();
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

/** A stored row, reopened (#60).
 *
 *  The property here is the one a screenshot cannot see and one tap cannot
 *  either: a row seeded with the wrong `base` renders identically and only
 *  misbehaves when the portion control is touched, by which point the number
 *  it has multiplied is a number the user already saved.
 */
const SAVED: FoodLog = {
  id: "row-1",
  user_id: "u",
  logged_on: "2026-08-21",
  logged_at: "2026-08-21T18:30:00.000Z",
  meal_slot: "dinner",
  name: "Chicken breast, cooked",
  kcal: 330,
  protein_g: 62,
  carbs_g: 0,
  fat_g: 7.2,
  source: "text",
  photo_key: null,
  barcode: null,
  confidence: 0.85,
  edited: 0,
  ai_kcal: 165,
  ai_protein_g: 31,
  ai_carbs_g: 0,
  ai_fat_g: 3.6,
  // saved at 200 g, where the reader had counted 100 — the pair that separates
  // a right implementation from a wrong one
  portion_qty: 200,
  portion_unit: "g",
  ai_portion_qty: 100,
  notes: null,
  created_at: "2026-08-21T18:30:00.000Z",
  updated_at: "2026-08-21T18:30:00.000Z",
};

describe("editableFromLog (#60)", () => {
  it("shows the saved numbers, not the reader's", () => {
    const it0 = editableFromLog(SAVED);
    expect(it0.calories).toBe(330);
    expect(it0.protein_g).toBe(62);
  });

  it("shows the saved portion, not the one the reader counted", () => {
    expect(editableFromLog(SAVED).portion).toEqual({ qty: 200, unit: "g" });
  });

  /** **The assertion this whole block exists for.** `base` is the divisor, and
   *  what the saved macros describe is the saved qty. Seeding it from
   *  `ai_portion_qty` would make 200 → 200 a doubling. */
  it("rescales from the SAVED quantity, so a no-op is a no-op", () => {
    const same = setPortionQty(editableFromLog(SAVED), 200);
    expect(same.calories).toBe(330);
    expect(same.protein_g).toBe(62);
  });

  it("halves from the saved quantity, not from the reader's", () => {
    const half = setPortionQty(editableFromLog(SAVED), 100);
    expect(half.calories).toBe(165);
    expect(half.protein_g).toBe(31);
  });

  it("keeps the confidence the read reported", () => {
    expect(editableFromLog(SAVED).confidence).toBe(0.85);
  });

  /** Null is "nothing estimated this" and stays null — a favorite re-log, or a
   *  row #60 itself added. The row's note is what changes, not the value. */
  it("keeps a null confidence null", () => {
    expect(editableFromLog({ ...SAVED, confidence: null }).confidence).toBeNull();
  });

  /** All three portion columns or none (#104). A row with none draws no
   *  control rather than one over an invented "1 serving". */
  it("gives a row with no stored portion no portion at all", () => {
    const bare = editableFromLog({ ...SAVED, portion_qty: null, portion_unit: null, ai_portion_qty: null });
    expect(bare.portion).toBeNull();
  });

  /** A half-populated row is a shape the save route cannot write, so the only
   *  way to meet one is a hand-edited table — and inventing the missing half
   *  is worse than drawing no control. */
  it("refuses to invent a unit for a qty that has none", () => {
    expect(editableFromLog({ ...SAVED, portion_unit: null }).portion).toBeNull();
  });

  it("refuses to invent a qty for a unit that has none", () => {
    expect(editableFromLog({ ...SAVED, portion_qty: null }).portion).toBeNull();
  });

  /** A row with no portion cannot grow one by being scaled — the sheet draws
   *  no control for it, and this is the same refusal one level down. */
  it("leaves a portionless row alone when something tries to scale it", () => {
    const bare = editableFromLog({ ...SAVED, portion_qty: null, portion_unit: null });
    expect(setPortionQty(bare, 4)).toEqual(bare);
  });
});

describe("blankItem (#60)", () => {
  /** #16's blank row by another name. Nothing read it, so there is nothing to
   *  report about it and nothing to scale it from. */
  it("has no confidence, because nothing estimated it", () => {
    expect(blankItem().confidence).toBeNull();
  });

  it("has no portion, because nothing counted it", () => {
    expect(blankItem().portion ?? null).toBeNull();
  });

  it("starts at zero on every macro", () => {
    const b = blankItem();
    expect([b.calories, b.protein_g, b.carbs_g, b.fat_g]).toEqual([0, 0, 0, 0]);
  });
});
