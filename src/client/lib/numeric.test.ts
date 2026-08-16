import { describe, expect, it } from "vitest";
import { FOOD_LIMITS, type NumericCommit, formatNumeric, parseNumeric } from "./numeric";

describe("parseNumeric", () => {
  it("reads a plain number", () => {
    expect(parseNumeric("280")).toEqual({ kind: "value", value: 280, clamped: null });
  });

  // The whole bug in one assertion: the old handlers ran `Number("")`, which is
  // 0 and finite and >= 0, so clearing a macro field wrote a real zero into the
  // meal. Blank has to be its own answer, not a number.
  it("does not read blank as zero", () => {
    expect(parseNumeric("")).toEqual({ kind: "keep", why: "blank" });
    expect(parseNumeric("   ")).toEqual({ kind: "keep", why: "blank" });
  });

  it("reads blank as empty only where empty means something", () => {
    expect(parseNumeric("", { allowEmpty: true })).toEqual({ kind: "empty" });
  });

  it("keeps the old value rather than inventing one from junk", () => {
    for (const junk of ["abc", "12abc", "-", ".", "1.2.3", "0x1f", "1 2"]) {
      expect(parseNumeric(junk), junk).toEqual({ kind: "keep", why: "unparsable" });
    }
  });

  // `Number("0x1f")` is 31 and `Number(" ")` is 0. A field validated by
  // `Number()` alone accepts strings no keypad can produce.
  it("refuses what Number() would have accepted", () => {
    expect(Number("0x1f")).toBe(31);
    expect(parseNumeric("0x1f").kind).toBe("keep");
  });

  it("takes a comma as the decimal separator", () => {
    expect(parseNumeric("1,5", { decimals: 1 })).toEqual({ kind: "value", value: 1.5, clamped: null });
  });

  it("clamps rather than rejecting, and reports which end", () => {
    expect(parseNumeric("9000", { min: 1, max: 5000 })).toEqual({
      kind: "value",
      value: 5000,
      clamped: "max",
    });
    expect(parseNumeric("-5", { min: 0 })).toEqual({ kind: "value", value: 0, clamped: "min" });
    expect(parseNumeric("150", { min: 1, max: 5000 })).toEqual({
      kind: "value",
      value: 150,
      clamped: null,
    });
  });

  it("rounds to the field's decimals at commit, not before", () => {
    expect(parseNumeric("52.44", { decimals: 1 })).toEqual({ kind: "value", value: 52.4, clamped: null });
    expect(parseNumeric("52.6", { decimals: 0 })).toEqual({ kind: "value", value: 53, clamped: null });
  });

  // Half-typed text is the state the field spends most of its life in. It must
  // parse to something usable, because the sheet's totals follow it live —
  // what must NOT happen is the parse result being written back over the text.
  it("reads the half-typed forms the old field mangled", () => {
    expect(parseNumeric("0150")).toEqual({ kind: "value", value: 150, clamped: null });
    expect(parseNumeric("5.", { decimals: 1 })).toEqual({ kind: "value", value: 5, clamped: null });
    expect(parseNumeric(".5", { decimals: 1 })).toEqual({ kind: "value", value: 0.5, clamped: null });
  });
});

// These assert the shipped numbers, not a copy of them. The bounds live in
// `numeric.ts` rather than beside the fields precisely so this file can name
// them; if they were literals in JSX, this describe block would be a second
// statement of the rule agreeing with itself.
describe("FOOD_LIMITS", () => {
  it("catches a slipped thumb in the portion field", () => {
    // The old 5,000 was inherited from a handler that discarded out-of-range
    // input rather than clamping it, so nobody ever saw the ceiling fire.
    expect(parseNumeric("2500", FOOD_LIMITS.grams)).toEqual({ kind: "value", value: 2000, clamped: "max" });
    expect(parseNumeric("0", FOOD_LIMITS.grams)).toEqual({ kind: "value", value: 1, clamped: "min" });
    expect(parseNumeric("150", FOOD_LIMITS.grams)).toEqual({ kind: "value", value: 150, clamped: null });
  });

  it("catches a slipped thumb in KCAL, which had no ceiling at all", () => {
    expect(parseNumeric("28000", FOOD_LIMITS.kcal)).toEqual({ kind: "value", value: 10000, clamped: "max" });
    expect(parseNumeric("-5", FOOD_LIMITS.kcal)).toEqual({ kind: "value", value: 0, clamped: "min" });
  });

  it("catches a slipped thumb in a macro, and keeps their 1dp", () => {
    expect(parseNumeric("5200", FOOD_LIMITS.macro_g)).toEqual({ kind: "value", value: 1000, clamped: "max" });
    expect(parseNumeric("52.44", FOOD_LIMITS.macro_g)).toEqual({ kind: "value", value: 52.4, clamped: null });
  });

  // The point of the numbers is that honest food never reaches them. Nutella is
  // about the densest thing with a barcode, and even 2 kg of it — the portion
  // field's own new ceiling — leaves protein and fat well inside theirs.
  it("does not fire on a real product at a real portion", () => {
    // Reports the *kind* when the parse didn't produce a value at all, so a
    // failure here says which of the two things went wrong.
    const clampOf = (c: NumericCommit) => (c.kind === "value" ? c.clamped : c.kind);
    const per100 = { calories: 539, protein_g: 6.3, carbs_g: 57.5, fat_g: 30.9 };
    for (const grams of [30, 100, 250]) {
      const s = grams / 100;
      expect(clampOf(parseNumeric(String(per100.calories * s), FOOD_LIMITS.kcal)), `${grams}g kcal`).toBe(null);
      for (const g of [per100.protein_g, per100.carbs_g, per100.fat_g]) {
        expect(clampOf(parseNumeric(String(g * s), FOOD_LIMITS.macro_g)), `${grams}g macro`).toBe(null);
      }
    }
  });

  // Why blur must not commit text the field wrote itself. The portion row
  // rescales every macro from the pristine per-100g figures, so a field can
  // legitimately *hold* a number above its own ceiling — 2 kg of Nutella is
  // 10,780 kcal and 1,150 g of carbs. Re-parsing what such a field is merely
  // displaying is not a no-op; it is a clamp of a value nobody typed.
  it("a rescaled value can sit above the ceiling of the field showing it", () => {
    expect(parseNumeric(formatNumeric(539 * 20, 0), FOOD_LIMITS.kcal)).toEqual({
      kind: "value",
      value: 10000,
      clamped: "max",
    });
    expect(parseNumeric(formatNumeric(57.5 * 20, 1), FOOD_LIMITS.macro_g)).toEqual({
      kind: "value",
      value: 1000,
      clamped: "max",
    });
  });

  it("has a floor under every ceiling", () => {
    for (const [name, rule] of Object.entries(FOOD_LIMITS)) {
      expect(rule.min, name).toBeLessThan(rule.max);
    }
  });
});

describe("formatNumeric", () => {
  it("shows nothing for no value", () => {
    expect(formatNumeric(null, 1)).toBe("");
  });

  // A field showing "52.0" makes every edit start with deleting a zero.
  it("does not pad a whole number with its decimals", () => {
    expect(formatNumeric(52, 1)).toBe("52");
    expect(formatNumeric(52.4, 1)).toBe("52.4");
    expect(formatNumeric(52.44, 1)).toBe("52.4");
    expect(formatNumeric(280, 0)).toBe("280");
  });
});
