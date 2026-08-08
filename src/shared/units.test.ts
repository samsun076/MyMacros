import { describe, expect, it } from "vitest";
import { cmToFtIn, displayWeight, ftInToCm, kgToLb, lbToKg } from "./units";

describe("weight conversion", () => {
  it("matches the known factor", () => {
    expect(kgToLb(1)).toBeCloseTo(2.20462, 4);
    expect(lbToKg(220.462)).toBeCloseTo(100, 3);
  });

  it("round-trips", () => {
    for (const kg of [45, 62.5, 80, 113.4]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 9);
    }
  });
});

describe("cmToFtIn", () => {
  it("splits a height the way it is spoken", () => {
    expect(cmToFtIn(180)).toEqual({ ft: 5, in: 11 });
    expect(cmToFtIn(152.4)).toEqual({ ft: 5, in: 0 });
  });

  /** Flooring the feet and rounding the remainder separately gives 5'12" for
   *  anything just under six foot. Rounding to the inch first is what stops
   *  it, and this is the case that catches a regression. */
  it("never reads 12 inches", () => {
    for (let cm = 120; cm <= 220; cm += 0.1) {
      expect(cmToFtIn(cm).in).toBeLessThan(12);
    }
    expect(cmToFtIn(182.8)).toEqual({ ft: 6, in: 0 });
  });

  it("round-trips through whole inches", () => {
    for (const [ft, inches] of [
      [5, 0],
      [5, 11],
      [6, 2],
    ] as const) {
      expect(cmToFtIn(ftInToCm(ft, inches))).toEqual({ ft, in: inches });
    }
  });
});

describe("displayWeight", () => {
  it("shows pounds to imperial users and kilograms to metric ones", () => {
    expect(displayWeight(80, "imperial")).toEqual({ value: 176.4, unit: "lb" });
    expect(displayWeight(80, "metric")).toEqual({ value: 80, unit: "kg" });
  });
});
