import { describe, expect, it } from "vitest";
import { isDay, isNum, oneOf, pct, positive } from "./validate";

/** The convention these all share: the normalized value on success,
 *  `undefined` on rejection, so a route's allowlist can treat `undefined`
 *  uniformly as "invalid field". A validator that returned `0` or `""` where
 *  it meant "no" would quietly write that value instead. */
describe("isNum", () => {
  it("accepts finite numbers including zero and negatives", () => {
    for (const v of [0, -1, 1.5, 1e6]) expect(isNum(v)).toBe(true);
  });

  it("rejects the numbers that aren't", () => {
    for (const v of [NaN, Infinity, -Infinity]) expect(isNum(v)).toBe(false);
  });

  it("rejects numeric strings — JSON bodies are not coerced here", () => {
    for (const v of ["1", "", null, undefined, {}, [], true]) expect(isNum(v)).toBe(false);
  });
});

describe("positive", () => {
  it("takes anything above zero", () => {
    expect(positive(0.1)).toBe(0.1);
    expect(positive(180)).toBe(180);
  });

  it("rejects zero and below", () => {
    expect(positive(0)).toBeUndefined();
    expect(positive(-1)).toBeUndefined();
  });

  it("rejects non-numbers", () => {
    expect(positive("180")).toBeUndefined();
    expect(positive(NaN)).toBeUndefined();
  });
});

describe("pct", () => {
  it("accepts the closed range 0–100", () => {
    expect(pct(0)).toBe(0);
    expect(pct(50)).toBe(50);
    expect(pct(100)).toBe(100);
  });

  it("rounds to a whole percent", () => {
    expect(pct(50.4)).toBe(50);
    expect(pct(50.6)).toBe(51);
  });

  it("rejects out of range rather than clamping", () => {
    expect(pct(-1)).toBeUndefined();
    expect(pct(101)).toBeUndefined();
    expect(pct(NaN)).toBeUndefined();
  });
});

describe("isDay", () => {
  it("accepts YYYY-MM-DD", () => {
    expect(isDay("2026-08-07")).toBe("2026-08-07");
  });

  it("rejects a timestamp — a day in the user's life is not an instant", () => {
    expect(isDay("2026-08-07T12:00:00Z")).toBeUndefined();
  });

  it("rejects unpadded and malformed dates", () => {
    for (const v of ["2026-8-7", "26-08-07", "2026/08/07", "", "today"]) {
      expect(isDay(v)).toBeUndefined();
    }
  });

  it("rejects non-strings", () => {
    expect(isDay(20260807)).toBeUndefined();
    expect(isDay(null)).toBeUndefined();
  });
});

describe("oneOf", () => {
  const slot = oneOf(["breakfast", "lunch", "dinner", "snack"] as const);

  it("passes a member through with its narrowed type", () => {
    expect(slot("lunch")).toBe("lunch");
  });

  it("rejects a non-member", () => {
    expect(slot("brunch")).toBeUndefined();
    expect(slot("")).toBeUndefined();
    expect(slot(null)).toBeUndefined();
  });

  it("is case-sensitive — it allowlists, it doesn't guess", () => {
    expect(slot("Lunch")).toBeUndefined();
  });
});
