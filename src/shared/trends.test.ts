import { describe, expect, it } from "vitest";
import {
  buildTrends,
  daysBetween,
  KCAL_PER_KG,
  MIN_LOGGED_DAYS,
  observedRateKgPerWeek,
  weekStart,
  type DayKcal,
  type TrendsProfile,
} from "./trends";
import { shiftDay, type WeighIn } from "./weight";

/* Fixture arithmetic, worked by hand once so the expectations below are
 * checkable rather than recorded:
 *
 *   BMR   = 10(80) + 6.25(180) − 5(36) + 5           = 1,750
 *   TDEE  = 1,750 × 1.55 (moderate)                  = 2,712.5 → 2,713
 *   base  = 2,712.5 − 500 (cut), floor 1,500         = 2,212.5 → 2,213
 *
 * Age is 36 for the whole of August 2026 against a 1990-01-01 birth date, so
 * nothing here drifts mid-window. */
const PROFILE: TrendsProfile = {
  sex: "male",
  birth_date: "1990-01-01",
  height_cm: 180,
  activity_level: "moderate",
  goal: "cut",
  deficit_kcal: 500,
  eat_back_pct: 50,
};
const BASE = 2213;

/** 2026-08-16 is a Sunday; the Monday of its week is 2026-08-10. */
const TODAY = "2026-08-16";

const run = (from: string, count: number) =>
  Array.from({ length: count }, (_, n) => shiftDay(from, n));

/** A weigh-in every day at a flat weight, so the trend is that weight and the
 *  budget arithmetic is the same on every day of the window. */
const flatWeighIns = (from: string, count: number, kg: number): WeighIn[] =>
  run(from, count).map((measured_on) => ({ measured_on, weight_kg: kg }));

const kcal = (days: string[], each: number): DayKcal[] =>
  days.map((day) => ({ day, kcal: each }));

describe("weekStart", () => {
  it("returns a Monday, and returns Mondays unchanged", () => {
    expect(weekStart("2026-08-10")).toBe("2026-08-10"); // Monday
    expect(weekStart("2026-08-11")).toBe("2026-08-10"); // Tuesday
    expect(weekStart("2026-08-16")).toBe("2026-08-10"); // Sunday
  });

  it("crosses months and years", () => {
    expect(weekStart("2026-03-01")).toBe("2026-02-23"); // Sunday → Feb
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // Thursday → Dec
  });
});

describe("daysBetween", () => {
  it("counts whole days in both directions", () => {
    expect(daysBetween("2026-08-01", "2026-08-08")).toBe(7);
    expect(daysBetween("2026-08-08", "2026-08-01")).toBe(-7);
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
  });

  it("crosses a leap day", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
});

describe("buildTrends — the window", () => {
  it("covers N Monday-start weeks ending on the client's today", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 4,
      weighIns: [],
      intake: [],
      runs: [],
      profile: PROFILE,
    });

    expect(t.from).toBe("2026-07-20");
    expect(t.to).toBe(TODAY);
    expect(t.weeks.map((w) => w.starts_on)).toEqual([
      "2026-07-20",
      "2026-07-27",
      "2026-08-03",
      "2026-08-10",
    ]);
  });

  it("marks the week being lived as partial, and the settled ones as not", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 4,
      weighIns: [],
      intake: [],
      runs: [],
      profile: PROFILE,
    });

    // the current week is 7 whole days here (today is a Sunday) and is STILL
    // partial: it is Sunday evening, not Monday morning — there is more day left
    expect(t.weeks.at(-1)).toMatchObject({ starts_on: "2026-08-10", days: 7, partial: true });
    expect(t.weeks.slice(0, 3).every((w) => w.partial)).toBe(false);
  });

  it("keeps the smoothing lead-in out of the drawn series", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      // six days before the window plus the window itself
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      intake: [],
      runs: [],
      profile: PROFILE,
    });

    expect(t.from).toBe("2026-08-10");
    expect(t.series[0]?.measured_on).toBe("2026-08-10");
    expect(t.series.at(-1)?.measured_on).toBe("2026-08-16");
  });
});

describe("buildTrends — a day with no food logged is not a day of zero intake", () => {
  it("averages over logged days only", () => {
    const week = run("2026-08-10", 7);
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      // three days logged at 2,000; the other four never happened
      intake: kcal(week.slice(0, 3), 2000),
      runs: [],
      profile: PROFILE,
    });

    const w = t.weeks[0]!;
    expect(w.days).toBe(7);
    expect(w.logged_days).toBe(3);
    // 2,000 — not 6,000/7 = 857, which is what averaging the silence gives
    expect(w.intake_kcal).toBe(2000);
  });

  it("averages the target over the SAME days as the intake", () => {
    const week = run("2026-08-10", 7);
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      intake: kcal(week.slice(0, 3), 2000),
      // a run on a day that was never logged: it must not enter the week's
      // mean earned, or the bar compares two different weeks
      runs: [{ day: week[5]!, kcal: 800 }],
      profile: PROFILE,
    });

    expect(t.weeks[0]).toMatchObject({ target_kcal: BASE, earned_kcal: 0 });
    // …while the run itself is still a fact about the week
    expect(t.weeks[0]!.run_kcal).toBe(800);
  });
});

describe("buildTrends — a day logged in part is not a logged day (#74)", () => {
  /** The production week that found this. Target ≈ 1,905; the 77 is one
   *  entry standing in for a whole day. */
  const REAL_WEEK: [string, number][] = [
    ["2026-08-10", 742],
    ["2026-08-11", 652],
    ["2026-08-12", 77],
    ["2026-08-13", 1780],
    ["2026-08-14", 1040],
    ["2026-08-15", 1405],
  ];

  const week = () =>
    buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      intake: REAL_WEEK.map(([day, kcal]) => ({ day, kcal })),
      runs: [],
      profile: PROFILE,
    });

  it("counts only the days that reach 60% of their target", () => {
    const w = week().weeks[0]!;
    // 60% of the 2,213 base is 1,328 — so 1,780 and 1,405 survive and the
    // 742 / 652 / 77 / 1,040 days do not
    expect(w.logged_days).toBe(6);
    expect(w.counted_days).toBe(2);
    expect(w.intake_kcal).toBe(Math.round((1780 + 1405) / 2));
  });

  it("halves a deficit that was being driven by a 77-kcal day", () => {
    const w = week().weeks[0]!;
    // TDEE 2,713 against the two real days: (933 + 1308) / 2
    expect(w.deficit_kcal).toBe(1121);
    // averaging all six logged days instead gives 1,764 — the flattering
    // number this rule exists to stop reporting
    expect(w.deficit_kcal).toBeLessThan(1764);
  });

  it("never counts today, however much is on it", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      // a full day's eating, stamped today — it is still only lunchtime
      intake: [{ day: TODAY, kcal: 2000 }],
      runs: [],
      profile: PROFILE,
    });

    expect(t.weeks[0]).toMatchObject({ logged_days: 1, counted_days: 0, deficit_kcal: null });
    expect(t.rate.counted_days).toBe(0);
  });

  /** The production week also contained 2026-08-04: logged, but sitting before
   *  the first weigh-in, so no trend weight, so no target. The first cut
   *  treated "nothing to judge against" as a pass, which averaged it into the
   *  intake while the deficit — which needs a TDEE — excluded it. Two means,
   *  two denominators, from one week. */
  it("does not count a day it has no target for, so every mean shares a denominator", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      // weigh-ins start on the 12th, so the 11th has no trend weight at all
      weighIns: flatWeighIns("2026-08-12", 4, 80),
      intake: [
        { day: "2026-08-11", kcal: 2000 },
        { day: "2026-08-13", kcal: 2000 },
      ],
      runs: [],
      profile: PROFILE,
    });

    const w = t.weeks[0]!;
    expect(w.logged_days).toBe(2);
    expect(w.counted_days).toBe(1);
    // the 11th is in neither figure, rather than in one of them
    expect(w.intake_kcal).toBe(2000);
    expect(w.deficit_kcal).toBe(713);
  });

  it("reports nothing to average before onboarding, rather than a bare intake", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      intake: [{ day: "2026-08-11", kcal: 300 }],
      runs: [],
      profile: { ...PROFILE, height_cm: null },
    });

    // the logging is still acknowledged; there is just no target to weigh it
    // against, and the screen says "budget not set up" rather than averaging
    expect(t.weeks[0]).toMatchObject({ logged_days: 1, counted_days: 0, intake_kcal: null });
    expect(t.onboarded).toBe(false);
  });
});

describe("buildTrends — the realized deficit", () => {
  /** The assertion most likely to be silently "corrected" later, so it is
   *  stated as one number with the wrong answer named next to it. */
  it("subtracts intake from TDEE plus the FULL run calories, not the eaten-back share", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      intake: [{ day: "2026-08-10", kcal: 2000 }],
      runs: [{ day: "2026-08-10", kcal: 600 }],
      profile: PROFILE,
    });

    // 2,713 TDEE + 600 burned − 2,000 eaten
    expect(t.weeks[0]!.deficit_kcal).toBe(1313);
    // eat_back_pct is 50, so the earned bonus is half the run — a budgeting
    // hedge, and NOT what the deficit above used. Applying it there would give
    // 2,713 + 300 − 2,000 = 1,013.
    expect(t.weeks[0]!.earned_kcal).toBe(300);
    expect(t.weeks[0]!.deficit_kcal).not.toBe(1013);
  });

  it("reports no deficit for a week with nothing logged", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      intake: [],
      runs: [],
      profile: PROFILE,
    });

    expect(t.weeks[0]).toMatchObject({ intake_kcal: null, deficit_kcal: null, logged_days: 0 });
  });

  it("has nothing to say before onboarding", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 1,
      weighIns: flatWeighIns("2026-08-04", 13, 80),
      intake: [{ day: "2026-08-10", kcal: 2000 }],
      runs: [],
      // no height: computeBudget declines rather than guessing (#17)
      profile: { ...PROFILE, height_cm: null },
    });

    expect(t.onboarded).toBe(false);
    expect(t.weeks[0]).toMatchObject({ target_kcal: null, deficit_kcal: null });
    expect(t.rate.predicted_kg_per_week).toBeNull();
    // No mean either: with no target there is nothing to judge the day's
    // completeness against, and averaging what may be half a day's food is the
    // #74 defect in miniature. The logging is still acknowledged.
    expect(t.weeks[0]!.intake_kcal).toBeNull();
    expect(t.weeks[0]!.logged_days).toBe(1);
  });
});

describe("buildTrends — the honesty gates", () => {
  // ends the day BEFORE today: today is never counted (#74), so a fortnight
  // that runs up to and including it is only thirteen days of evidence
  const twoWeeks = run("2026-08-02", 14);

  it("withholds the mean deficit and the modelled rate below 14 logged days", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 4,
      weighIns: flatWeighIns("2026-07-14", 34, 80),
      intake: kcal(twoWeeks.slice(0, MIN_LOGGED_DAYS - 1), 2000),
      runs: [],
      profile: PROFILE,
    });

    expect(t.rate.counted_days).toBe(13);
    expect(t.rate.deficit_kcal).toBeNull();
    expect(t.rate.predicted_kg_per_week).toBeNull();
  });

  it("does not let thin days make up the fortnight", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 4,
      weighIns: flatWeighIns("2026-07-14", 34, 80),
      intake: [
        ...kcal(twoWeeks.slice(0, MIN_LOGGED_DAYS - 1), 2000),
        // a fourteenth day, logged — but at a fifth of the target
        { day: twoWeeks[MIN_LOGGED_DAYS - 1]!, kcal: 420 },
      ],
      runs: [],
      profile: PROFILE,
    });

    expect(t.rate.logged_days).toBe(14);
    expect(t.rate.counted_days).toBe(13);
    expect(t.rate.deficit_kcal).toBeNull();
  });

  it("reports them at 14", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 4,
      weighIns: flatWeighIns("2026-07-14", 34, 80),
      intake: kcal(twoWeeks, 2000),
      runs: [],
      profile: PROFILE,
    });

    expect(t.rate.logged_days).toBe(14);
    // every day is identical, so the mean is the day: 2,713 − 2,000
    expect(t.rate.deficit_kcal).toBe(713);
    expect(t.rate.predicted_kg_per_week).toBeCloseTo(-(713 * 7) / KCAL_PER_KG, 2);
  });

  /** The two rates sit side by side on screen, both rendered as magnitudes.
   *  If they don't agree about which direction is negative, the reader
   *  compares "0.23" to "0.72" as though they pointed the same way. */
  it("signs the modelled rate the same way as the measured one", () => {
    // a real deficit and a genuinely falling weight
    const t = buildTrends({
      today: TODAY,
      weeks: 4,
      weighIns: run("2026-07-20", 28).map((measured_on, n) => ({
        measured_on,
        weight_kg: 82 - n * 0.05,
      })),
      intake: kcal(run("2026-07-20", 28), 2000),
      runs: [],
      profile: PROFILE,
    });

    expect(t.rate.deficit_kcal).toBeGreaterThan(0); // eating under expenditure
    expect(t.rate.observed_kg_per_week).toBeLessThan(0); // scale going down
    expect(t.rate.predicted_kg_per_week).toBeLessThan(0); // …and so must this
  });

  it("flips the modelled rate when the window ran a surplus", () => {
    const t = buildTrends({
      today: TODAY,
      weeks: 4,
      weighIns: flatWeighIns("2026-07-14", 34, 80),
      // well over the ~2,713 kcal expenditure
      intake: kcal(run("2026-07-20", 28), 3400),
      runs: [],
      profile: PROFILE,
    });

    expect(t.rate.deficit_kcal).toBeLessThan(0);
    expect(t.rate.predicted_kg_per_week).toBeGreaterThan(0);
  });
});

describe("observedRateKgPerWeek", () => {
  const point = (measured_on: string, trend_kg: number) => ({ measured_on, trend_kg });

  it("refuses a slope from a span shorter than a fortnight", () => {
    const short = run("2026-08-01", 13).map((d, n) => point(d, 80 - n * 0.1));
    expect(observedRateKgPerWeek(short)).toBeNull();
    expect(observedRateKgPerWeek([point("2026-08-01", 80)])).toBeNull();
  });

  it("fits a straight line exactly", () => {
    // 0.1 kg down per day over 21 days = 0.7 kg/week
    const line = run("2026-08-01", 21).map((d, n) => point(d, 80 - n * 0.1));
    expect(observedRateKgPerWeek(line)).toBe(-0.7);
  });

  it("is not moved by one dehydrated morning the way endpoints are", () => {
    const days = run("2026-08-01", 21);
    const clean = days.map((d, n) => point(d, 80 - n * 0.1));
    const noisy = clean.map((p, n) => (n === 20 ? point(p.measured_on, p.trend_kg - 1) : p));

    // last-minus-first would read (78.0 − 1 − 80)/3 weeks = −1.0 kg/week
    expect(observedRateKgPerWeek(noisy)!).toBeGreaterThan(-0.85);
    expect(observedRateKgPerWeek(noisy)!).toBeLessThan(-0.7);
  });

  it("declines when every weigh-in landed on the same day", () => {
    const sameDay = [point("2026-08-01", 80), point("2026-08-01", 80)];
    expect(observedRateKgPerWeek(sameDay)).toBeNull();
  });
});
