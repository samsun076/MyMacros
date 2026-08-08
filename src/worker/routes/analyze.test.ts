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
    expect(normalize(item())).toEqual({
      name: "Chicken burrito",
      calories: 640,
      protein_g: 41.2,
      carbs_g: 62.8,
      fat_g: 22.4,
      confidence: 0.62,
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
});
