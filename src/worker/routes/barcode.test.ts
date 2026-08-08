import { describe, expect, it } from "vitest";
import { defaultGrams, macrosPer100g, nameOf } from "./barcode";

/** The portion a scan opens on. This function has already been wrong once in a
 *  way nothing visible reported: a CLIF bar opened at 368 kcal (100 g) instead
 *  of the 250 kcal printed on it — correct nutrition underneath, 47% over on
 *  the number the user actually logs. Every case below is a real product
 *  shape, not a synthetic edge. */
describe("defaultGrams", () => {
  it("uses the product's own serving — the CLIF bar regression", () => {
    expect(defaultGrams({ serving_quantity: 68, product_quantity: 68 })).toBe(68);
  });

  it("takes the serving when no package weight is listed at all", () => {
    expect(defaultGrams({ serving_quantity: 30 })).toBe(30);
  });

  it("refuses a serving bigger than the package — the Mars bar", () => {
    // the field says 100 g on a 51 g bar; nobody eats two bars because a
    // contributor typed the per-100g basis into the serving field
    expect(defaultGrams({ serving_quantity: 100, product_quantity: 51 })).toBe(51);
  });

  it("falls back to the whole package when it's plausibly one sitting", () => {
    expect(defaultGrams({ product_quantity: 150 })).toBe(150);
    expect(defaultGrams({ product_quantity: 200 })).toBe(200);
  });

  it("refuses to open on a package nobody eats in one go — the Nutella jar", () => {
    expect(defaultGrams({ product_quantity: 400 })).toBe(100);
    expect(defaultGrams({ product_quantity: 201 })).toBe(100);
  });

  it("falls back to 100 g when the product says nothing", () => {
    expect(defaultGrams({})).toBe(100);
  });

  it("parses numeric strings — OpenFoodFacts is not consistent about types", () => {
    expect(defaultGrams({ serving_quantity: "68" })).toBe(68);
    expect(defaultGrams({ product_quantity: "150" })).toBe(150);
  });

  it("ignores junk values rather than trusting them", () => {
    expect(defaultGrams({ serving_quantity: 0, product_quantity: 150 })).toBe(150);
    expect(defaultGrams({ serving_quantity: -5, product_quantity: 150 })).toBe(150);
    expect(defaultGrams({ serving_quantity: "one bar" })).toBe(100);
    expect(defaultGrams({ serving_quantity: null, product_quantity: undefined })).toBe(100);
  });

  it("returns whole grams", () => {
    expect(defaultGrams({ serving_quantity: 33.4 })).toBe(33);
    expect(defaultGrams({ serving_quantity: 33.6 })).toBe(34);
  });
});

describe("macrosPer100g", () => {
  it("reads the per-100g family", () => {
    expect(
      macrosPer100g({
        "energy-kcal_100g": 539,
        proteins_100g: 6.3,
        carbohydrates_100g: 57.5,
        fat_100g: 30.9,
      }),
    ).toEqual({ kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9 });
  });

  it("converts kilojoules when that's all a EU product carries", () => {
    const m = macrosPer100g({ energy_100g: 2252 });
    expect(m?.kcal).toBeCloseTo(2252 / 4.184, 5);
  });

  it("prefers kcal over kJ when both are present", () => {
    expect(macrosPer100g({ "energy-kcal_100g": 100, energy_100g: 2252 })?.kcal).toBe(100);
  });

  it("is null when there is no usable energy value — the caller's 'no nutrition'", () => {
    expect(macrosPer100g({})).toBeNull();
    expect(macrosPer100g({ proteins_100g: 6.3 })).toBeNull();
    expect(macrosPer100g({ "energy-kcal_100g": "unknown" })).toBeNull();
  });

  it("treats missing macros as zero, not as a missing product", () => {
    expect(macrosPer100g({ "energy-kcal_100g": 400 })).toEqual({
      kcal: 400,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });

  it("parses numeric strings", () => {
    expect(macrosPer100g({ "energy-kcal_100g": "539", proteins_100g: "6.3" })).toMatchObject({
      kcal: 539,
      protein: 6.3,
    });
  });
});

describe("nameOf", () => {
  it("reads brand-first, the way a label does", () => {
    expect(nameOf({ product_name: "Nutella", brands: "Ferrero" })).toBe("Ferrero Nutella");
  });

  it("doesn't say the brand twice", () => {
    expect(nameOf({ product_name: "Nutella Biscuits", brands: "nutella" })).toBe(
      "Nutella Biscuits",
    );
  });

  it("takes the first brand of a comma-separated list", () => {
    expect(nameOf({ product_name: "Bar", brands: "Clif Bar, Clif, Mondelez" })).toBe("Clif Bar Bar");
  });

  it("copes with either half missing", () => {
    expect(nameOf({ product_name: "Nutella" })).toBe("Nutella");
    expect(nameOf({ brands: "Ferrero" })).toBe("Ferrero");
    expect(nameOf({})).toBe("");
  });

  it("trims", () => {
    expect(nameOf({ product_name: "  Nutella  ", brands: "  Ferrero  " })).toBe("Ferrero Nutella");
  });
});
