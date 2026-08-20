import { describe, expect, it } from "vitest";
import { normalize } from "./analyze";

/** Structured outputs guarantee the *shape* of what Claude returns and
 *  silently drop `minimum`/`maximum` from the schema that is sent (#45). So
 *  the JSON schema cannot promise a calorie count is positive, or that
 *  confidence is a probability — `normalize` is the only thing that does, on
 *  the way to a row that a budget will later be computed from. */
describe("normalize", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    name: "Chicken burrito",
    calories: 640,
    protein_g: 41.2,
    carbs_g: 62.8,
    fat_g: 22.4,
    confidence: 0.62,
    ...over,
  });

  it("passes a well-formed item through", () => {
    expect(normalize(item({ portion: { qty: 1, unit: "burrito" } }))).toEqual({
      name: "Chicken burrito",
      calories: 640,
      protein_g: 41.2,
      carbs_g: 62.8,
      fat_g: 22.4,
      confidence: 0.62,
      portion: { qty: 1, unit: "burrito" },
    });
  });

  it("floors negatives at zero rather than logging a meal that gives calories back", () => {
    expect(normalize(item({ calories: -200, protein_g: -1, confidence: -0.5 }))).toMatchObject({
      calories: 0,
      protein_g: 0,
      confidence: 0,
    });
  });

  it("caps absurd values", () => {
    expect(normalize(item({ calories: 999999, protein_g: 50000 }))).toMatchObject({
      calories: 10000,
      protein_g: 1000,
    });
  });

  it("keeps confidence a probability", () => {
    expect(normalize(item({ confidence: 42 }))?.confidence).toBe(1);
    expect(normalize(item({ confidence: 0.876 }))?.confidence).toBe(0.88);
  });

  it("rounds calories to whole and macros to one place", () => {
    expect(normalize(item({ calories: 640.6, protein_g: 41.26 }))).toMatchObject({
      calories: 641,
      protein_g: 41.3,
    });
  });

  it("substitutes zero for a number that isn't one", () => {
    expect(
      normalize(item({ calories: NaN, protein_g: "41", carbs_g: null, fat_g: undefined })),
    ).toMatchObject({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    expect(normalize(item({ calories: Infinity }))?.calories).toBe(0);
  });

  it("drops an item with no name — there is nothing to show on the sheet", () => {
    expect(normalize(item({ name: "" }))).toBeNull();
    expect(normalize(item({ name: "   " }))).toBeNull();
    expect(normalize(item({ name: 42 }))).toBeNull();
    expect(normalize(item({ name: undefined }))).toBeNull();
  });

  it("survives junk where an object should be", () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(undefined)).toBeNull();
    expect(normalize("burrito")).toBeNull();
  });

  it("trims and truncates the name", () => {
    expect(normalize(item({ name: "  Burrito  " }))?.name).toBe("Burrito");
    expect(normalize(item({ name: "x".repeat(500) }))?.name).toHaveLength(120);
  });

  /** #58. The schema states `portion` as `anyOf: [object, null]` and structured
   *  outputs strip `minimum`/`maximum` from it exactly as they do everywhere
   *  else (#45), so nothing about the qty is trusted off the wire.
   *
   *  The other half is that a *half* portion is refused rather than repaired.
   *  A unit with no usable qty is "1 of something", which is the invented
   *  serving #58 says never to show; a qty with no unit is a bare number the
   *  sheet cannot label. Both become null — the same answer "had lunch out"
   *  gets, and the row degrades to hand-editing. */
  describe("portion", () => {
    const p = (portion: unknown) => normalize(item({ portion }))?.portion;

    it("clamps a qty above the ceiling instead of dropping the portion", () => {
      expect(p({ qty: 5000, unit: "slices" })).toEqual({ qty: 100, unit: "slices" });
      expect(p({ qty: 100.4, unit: "slices" })).toEqual({ qty: 100, unit: "slices" });
    });

    it("keeps a fractional qty at one decimal place", () => {
      expect(p({ qty: 1.5, unit: "cups" })).toEqual({ qty: 1.5, unit: "cups" });
      expect(p({ qty: 2.46, unit: "cups" })).toEqual({ qty: 2.5, unit: "cups" });
    });

    it("refuses a negative or zero qty rather than flooring it to something", () => {
      expect(p({ qty: -3, unit: "slices" })).toBeNull();
      expect(p({ qty: 0, unit: "slices" })).toBeNull();
      // positive, and still zero once it is rounded to what ships — the sheet
      // divides by this number
      expect(p({ qty: 0.04, unit: "slices" })).toBeNull();
    });

    it("refuses a qty that isn't a number", () => {
      expect(p({ qty: "4", unit: "slices" })).toBeNull();
      expect(p({ qty: null, unit: "slices" })).toBeNull();
      expect(p({ qty: Number.NaN, unit: "slices" })).toBeNull();
      expect(p({ qty: Number.POSITIVE_INFINITY, unit: "slices" })).toBeNull();
    });

    it("refuses half a portion — a unit with no qty, a qty with no unit", () => {
      expect(p({ unit: "slices" })).toBeNull();
      expect(p({ qty: 4 })).toBeNull();
      expect(p({ qty: 4, unit: "   " })).toBeNull();
      expect(p({ qty: 4, unit: 12 })).toBeNull();
    });

    it("is null when the model returns none — no invented serving", () => {
      expect(p(null)).toBeNull();
      expect(p(undefined)).toBeNull();
      expect(normalize({ ...item(), portion: undefined })?.portion).toBeNull();
    });

    it("survives junk where the portion object should be", () => {
      expect(p("four slices")).toBeNull();
      expect(p(42)).toBeNull();
      expect(p([{ qty: 4, unit: "slices" }])).toBeNull();
    });

    it("truncates an absurdly long unit rather than storing an essay", () => {
      expect(p({ qty: 1, unit: "x".repeat(500) })?.unit).toHaveLength(24);
      expect(p({ qty: 1, unit: "  slices  " })?.unit).toBe("slices");
    });
  });
});
