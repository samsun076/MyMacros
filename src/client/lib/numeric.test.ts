import { describe, expect, it } from "vitest";
import {
  FOOD_LIMITS,
  type NumericCommit,
  type NumericRule,
  commitOnBlur,
  commitWhileTyping,
  formatNumeric,
  parseNumeric,
} from "./numeric";

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

/** A field, driven the way a finger drives one (#100).
 *
 *  Everything that *decides* anything here is imported: `commitWhileTyping` and
 *  `commitOnBlur` are the same two functions `NumericField` calls, in the same
 *  order, on the same arguments. What this adds is only the wiring the DOM
 *  would otherwise provide — hold the current value, hand it back in, remember
 *  the value at focus — which is four lines of the component and the only part
 *  of it a Node test can't have. A harness that restated the rules would be a
 *  test of itself; reverting the source has to be able to turn this red, and
 *  the red run in the report is what says it does.
 *
 *  `type()` takes the **whole string the element would hold**, not a keystroke,
 *  because that is what `onChange` receives and the entire defect lived in the
 *  strings between a start and an end state. */
function field(start: number | null, rule: NumericRule, { live = false } = {}) {
  let value = start;
  let atFocus: number | null = null;
  let focused = false;
  return {
    get value() {
      return value;
    },
    focus() {
      atFocus = value;
      focused = true;
    },
    /** Returns what the rest of the app can see after this keystroke — which
     *  for a live field is the number the sheet header and footer are drawing. */
    type(text: string) {
      if (!focused) throw new Error("typed into a field that never took focus");
      if (live) {
        const action = commitWhileTyping(text, rule, value);
        if (action) value = action.value;
      }
      return value;
    },
    blur(text: string) {
      const action = commitOnBlur(text, rule, { value, atFocus });
      if (action.do === "commit") value = action.value;
      if (action.do === "clear") value = null;
      focused = false;
      return { value, note: action.note };
    },
  };
}

describe("clearing a live field (#100)", () => {
  // THE ISSUE. Not `parseNumeric("")` — every string on this path parses, and
  // that is exactly why it shipped. The assertion that matters is the last one,
  // but the middle one is the mechanism: by the time the field is empty the
  // stored number is 1, so "revert to the previous value" has nothing true left
  // to revert to unless somebody wrote it down at focus.
  it("walks 17.1 down to empty and puts 17.1 back, not the 1 left standing", () => {
    const carbs = field(17.1, FOOD_LIMITS.macro_g, { live: true });
    carbs.focus();

    const seen = ["17.", "17", "1", ""].map((text) => carbs.type(text));

    // What the row header and the footer total were showing at each step —
    // `1C` with the keyboard still up is the visible tell in the report.
    expect(seen).toEqual([17, 17, 1, 1]);
    expect(carbs.blur("")).toEqual({ value: 17.1, note: "KEPT 17.1" });
  });

  // Same walk, on a figure the field is only displaying because the portion row
  // rescaled it past the field's own ceiling. A restore is not an entry, so it
  // must not clamp on the way back — 1150 out, 1150 in, not MAX 1000.
  it("puts back a value that sits above the field's own ceiling", () => {
    const carbs = field(1150, FOOD_LIMITS.macro_g, { live: true });
    carbs.focus();
    for (const text of ["115", "11", "1", ""]) carbs.type(text);
    expect(carbs.blur("")).toEqual({ value: 1150, note: "KEPT 1150" });
  });

  // The decision, asserted rather than implied: unparsable takes the same route
  // as blank. 12 was fully typed and is thrown away on purpose — see the
  // component's note for the three reasons. If that is ever revisited, this is
  // the test that has to be argued with first.
  it("sends a stray character back to the focus value too, deliberately", () => {
    const fat = field(7, FOOD_LIMITS.macro_g, { live: true });
    fat.focus();
    expect(fat.type("1")).toBe(1);
    expect(fat.type("12")).toBe(12);
    expect(fat.blur("12a")).toEqual({ value: 7, note: "KEPT 7" });
  });

  // The half-typed decimals a numeric keypad can actually produce. "Keep the
  // last good keystroke" would restore 5 and 1.2 here and call them KEPT.
  it("does not salvage a half-built decimal", () => {
    for (const [path, junk, kept] of [
      [["5"], "5..", 52],
      [["1", "1.", "1.2"], "1.2.3", 52],
    ] as const) {
      const f = field(52, FOOD_LIMITS.macro_g, { live: true });
      f.focus();
      for (const text of path) f.type(text);
      expect(f.blur(junk), junk).toEqual({ value: kept, note: "KEPT 52" });
    }
  });

  // The revert must not fire on an edit that worked, or every correction on the
  // sheet would bounce back. #96's clamp has to survive it too: a clamp is a
  // commit of what you typed, not a refusal of it.
  it("still commits what you actually typed, and still clamps it", () => {
    const kcal = field(280, FOOD_LIMITS.kcal, { live: true });
    kcal.focus();
    for (const text of ["3", "34", "342"]) kcal.type(text);
    expect(kcal.blur("342")).toEqual({ value: 342, note: null });

    const fat = field(7, FOOD_LIMITS.macro_g, { live: true });
    fat.focus();
    expect(["5", "59", "599", "5999"].map((t) => fat.type(t))).toEqual([5, 59, 599, 599]);
    expect(fat.blur("5999")).toEqual({ value: 1000, note: "MAX 1000" });
  });

  // GoalWeightField: blur-only, so its `value` cannot move under the typing and
  // capturing at focus is a no-op that happens to also be correct. Asserted
  // because "unaffected either way" is a claim, and this is the call site the
  // component note says the rule is unconditional for.
  it("leaves a blur-only field where it already was", () => {
    const rule: NumericRule = { min: 1, decimals: 1, allowEmpty: true };

    const junk = field(78, rule);
    junk.focus();
    for (const text of ["7", "7a"]) junk.type(text);
    expect(junk.blur("7a")).toEqual({ value: 78, note: "KEPT 78" });

    // Empty is a *value* here, not a revert — clearing the goal weight is how
    // you turn the goal line off, and #100 must not have made that a KEPT.
    const cleared = field(78, rule);
    cleared.focus();
    cleared.type("");
    expect(cleared.blur("")).toEqual({ value: null, note: null });

    // …and with nothing there to begin with, there is no number to name.
    const fresh = field(null, rule);
    fresh.focus();
    fresh.type("abc");
    expect(fresh.blur("abc")).toEqual({ value: null, note: "NEEDS A NUMBER" });
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
