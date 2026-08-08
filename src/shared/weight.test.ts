import { describe, expect, it } from "vitest";
import { shiftDay, trendSeries, trendWeightKg, type WeighIn } from "./weight";

describe("shiftDay", () => {
  it("moves whole days", () => {
    expect(shiftDay("2026-08-07", -6)).toBe("2026-08-01");
    expect(shiftDay("2026-08-07", 1)).toBe("2026-08-08");
    expect(shiftDay("2026-08-07", 0)).toBe("2026-08-07");
  });

  it("crosses months and years", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("knows about leap years", () => {
    expect(shiftDay("2028-03-01", -1)).toBe("2028-02-29");
  });

  /** The reason this is UTC-only: a local Date built from a plain date lands
   *  on the previous day for anyone west of Greenwich, which would make the
   *  window one day short for some users some of the year. */
  it("is independent of the machine's timezone", () => {
    expect(shiftDay("2026-08-07", -6)).toBe("2026-08-01");
    expect(shiftDay("2026-01-01", 0)).toBe("2026-01-01");
  });
});

const series = (...pairs: [string, number][]): WeighIn[] =>
  pairs.map(([measured_on, weight_kg]) => ({ measured_on, weight_kg }));

describe("trendWeightKg", () => {
  it("means the trailing 7 days, end inclusive", () => {
    const w = series(["2026-08-01", 80], ["2026-08-04", 79], ["2026-08-07", 78]);
    expect(trendWeightKg(w, "2026-08-07")).toBe(79); // (80+79+78)/3
  });

  it("excludes the day that just fell out of the window", () => {
    const w = series(["2026-08-01", 90], ["2026-08-08", 80]);
    // window for the 8th is 02–08, so the 90 is gone
    expect(trendWeightKg(w, "2026-08-08")).toBe(80);
  });

  it("includes the far edge of the window", () => {
    const w = series(["2026-08-02", 90], ["2026-08-08", 80]);
    expect(trendWeightKg(w, "2026-08-08")).toBe(85);
  });

  it("ignores the future", () => {
    const w = series(["2026-08-05", 80], ["2026-08-09", 70]);
    expect(trendWeightKg(w, "2026-08-07")).toBe(80);
  });

  it("smooths a single noisy day rather than following it", () => {
    const steady = series(
      ["2026-08-01", 80],
      ["2026-08-02", 80],
      ["2026-08-03", 80],
      ["2026-08-04", 80],
      ["2026-08-05", 80],
      ["2026-08-06", 80],
    );
    const spike = [...steady, { measured_on: "2026-08-07", weight_kg: 87 }];
    // a 7 kg swing moves the trend by one seventh of it, not by all of it
    expect(trendWeightKg(spike, "2026-08-07")).toBe(81);
  });

  it("falls back to the last weigh-in when the window is empty", () => {
    const w = series(["2026-07-01", 82]);
    expect(trendWeightKg(w, "2026-08-07")).toBe(82);
  });

  it("is null only when there is nothing at all to go on", () => {
    expect(trendWeightKg([], "2026-08-07")).toBeNull();
    expect(trendWeightKg(series(["2026-08-09", 80]), "2026-08-07")).toBeNull();
  });

  it("rounds to a tenth", () => {
    const w = series(["2026-08-06", 80], ["2026-08-07", 81]);
    expect(trendWeightKg(w, "2026-08-07")).toBe(80.5);
  });
});

describe("trendSeries", () => {
  it("gives one point per day with data, oldest first", () => {
    const w = series(["2026-08-03", 79], ["2026-08-01", 80], ["2026-08-02", 81]);
    expect(trendSeries(w).map((p) => p.measured_on)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
  });

  it("carries the raw weight and its smoothed value", () => {
    const w = series(["2026-08-01", 80], ["2026-08-02", 82]);
    expect(trendSeries(w)).toEqual([
      { measured_on: "2026-08-01", weight_kg: 80, trend_kg: 80 },
      { measured_on: "2026-08-02", weight_kg: 82, trend_kg: 81 },
    ]);
  });

  it("draws no point on a day nobody weighed in", () => {
    const w = series(["2026-08-01", 80], ["2026-08-07", 78]);
    expect(trendSeries(w)).toHaveLength(2);
  });

  it("is empty for no data", () => {
    expect(trendSeries([])).toEqual([]);
  });
});
