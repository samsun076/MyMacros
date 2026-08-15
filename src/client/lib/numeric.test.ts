import { describe, expect, it } from "vitest";
import { formatNumeric, parseNumeric } from "./numeric";

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
