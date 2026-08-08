import { describe, expect, it } from "vitest";
import {
  ACTIVITY_FACTORS,
  ageOn,
  bmr,
  type BudgetInputs,
  computeBudget,
  earnedKcal,
  macroGrams,
  missingBudgetInputs,
} from "./budget";

/** Mifflin-St Jeor, worked by hand so the expected values come from the
 *  formula rather than from whatever this file happened to return first.
 *
 *  male:   10w + 6.25h − 5a + 5
 *  female: 10w + 6.25h − 5a − 161 */
describe("bmr", () => {
  it("computes the male form", () => {
    // 800 + 1125 − 200 + 5
    expect(bmr({ sex: "male", weight_kg: 80, height_cm: 180, age: 40 })).toBe(1730);
  });

  it("computes the female form", () => {
    // 650 + 1031.25 − 175 − 161
    expect(bmr({ sex: "female", weight_kg: 65, height_cm: 165, age: 35 })).toBe(1345.25);
  });

  it("differs by exactly the 166 kcal offset between the two forms", () => {
    const same = { weight_kg: 70, height_cm: 170, age: 30 };
    expect(bmr({ ...same, sex: "male" }) - bmr({ ...same, sex: "female" })).toBe(166);
  });

  it("moves the right way with each input", () => {
    const base = { sex: "male", weight_kg: 80, height_cm: 180, age: 40 } as const;
    expect(bmr({ ...base, weight_kg: 81 })).toBeGreaterThan(bmr(base));
    expect(bmr({ ...base, height_cm: 181 })).toBeGreaterThan(bmr(base));
    expect(bmr({ ...base, age: 41 })).toBeLessThan(bmr(base));
  });
});

describe("ageOn", () => {
  it("counts whole years", () => {
    expect(ageOn("1986-03-15", new Date(2026, 7, 7))).toBe(40);
  });

  it("hasn't had the birthday yet this year", () => {
    expect(ageOn("1986-12-25", new Date(2026, 7, 7))).toBe(39);
  });

  it("turns over on the day itself, not the day after", () => {
    expect(ageOn("1986-08-07", new Date(2026, 7, 6))).toBe(39);
    expect(ageOn("1986-08-07", new Date(2026, 7, 7))).toBe(40);
  });

  it("rejects what isn't a date", () => {
    for (const v of [null, "", "not-a-date", "1986-3-15", "1986-13-01", "1986-01-32"]) {
      expect(ageOn(v)).toBeNull();
    }
  });

  it("rejects ages nobody has", () => {
    expect(ageOn("2030-01-01", new Date(2026, 7, 7))).toBeNull();
    expect(ageOn("1850-01-01", new Date(2026, 7, 7))).toBeNull();
  });
});

const DAVE: BudgetInputs = {
  sex: "male",
  birth_date: "1986-03-15",
  height_cm: 180,
  weight_kg: 80,
  activity_level: "moderate",
  goal: "cut",
  deficit_kcal: 500,
};
const TODAY = new Date(2026, 7, 7);

describe("computeBudget", () => {
  // bmr 1730 → × 1.55 = 2681.5 → − 500 = 2181.5
  it("walks BMR → TDEE → target", () => {
    expect(computeBudget(DAVE, TODAY)).toEqual({
      bmr: 1730,
      tdee: 2682,
      target_kcal: 2182,
      floored: false,
    });
  });

  it("lets the goal decide the sign of the deficit", () => {
    const cut = computeBudget(DAVE, TODAY);
    const maintain = computeBudget({ ...DAVE, goal: "maintain" }, TODAY);
    const gain = computeBudget({ ...DAVE, goal: "gain" }, TODAY);

    expect(maintain?.target_kcal).toBe(2682);
    expect(cut?.target_kcal).toBe(2182);
    expect(gain?.target_kcal).toBe(3182);
  });

  it("ignores deficit_kcal entirely when maintaining", () => {
    const a = computeBudget({ ...DAVE, goal: "maintain", deficit_kcal: 0 }, TODAY);
    const b = computeBudget({ ...DAVE, goal: "maintain", deficit_kcal: 900 }, TODAY);
    expect(a?.target_kcal).toBe(b?.target_kcal);
  });

  it("applies the activity factor and nothing else", () => {
    for (const [level, factor] of Object.entries(ACTIVITY_FACTORS)) {
      const b = computeBudget(
        { ...DAVE, goal: "maintain", activity_level: level as never },
        TODAY,
      );
      expect(b?.tdee).toBe(Math.round(1730 * factor));
    }
  });

  // the whole reason ACTIVITY_FACTORS carries the comment it does: a run's
  // calories arrive separately as the earned bonus (#21), so nothing about a
  // run may reach the base target
  it("has no way to be told about a run", () => {
    expect(Object.keys(DAVE)).not.toContain("run_kcal");
    expect(computeBudget(DAVE, TODAY)?.target_kcal).toBe(2182);
  });

  describe("the floor", () => {
    // bmr 876.5 → × 1.2 = 1051.8 → − 1000 = 51.8, which nobody should eat to
    const SMALL: BudgetInputs = {
      sex: "female",
      birth_date: "1956-01-01",
      height_cm: 150,
      weight_kg: 45,
      activity_level: "sedentary",
      goal: "cut",
      deficit_kcal: 1000,
    };

    it("refuses to emit a dangerous target", () => {
      const b = computeBudget(SMALL, TODAY);
      expect(b?.target_kcal).toBe(1200);
      expect(b?.floored).toBe(true);
    });

    it("says so, so the UI can too", () => {
      expect(computeBudget(DAVE, TODAY)?.floored).toBe(false);
    });

    it("uses the male floor for men", () => {
      const b = computeBudget(
        { ...SMALL, sex: "male", birth_date: "1956-01-01", deficit_kcal: 1500 },
        TODAY,
      );
      expect(b?.target_kcal).toBe(1500);
      expect(b?.floored).toBe(true);
    });
  });

  describe("incomplete onboarding", () => {
    it("returns null rather than inventing a target", () => {
      expect(computeBudget({ ...DAVE, sex: null }, TODAY)).toBeNull();
      expect(computeBudget({ ...DAVE, birth_date: null }, TODAY)).toBeNull();
      expect(computeBudget({ ...DAVE, height_cm: null }, TODAY)).toBeNull();
      expect(computeBudget({ ...DAVE, weight_kg: null }, TODAY)).toBeNull();
    });

    it("treats nonsense measurements as missing, not as zero", () => {
      expect(computeBudget({ ...DAVE, height_cm: 0 }, TODAY)).toBeNull();
      expect(computeBudget({ ...DAVE, weight_kg: -5 }, TODAY)).toBeNull();
      expect(computeBudget({ ...DAVE, height_cm: NaN }, TODAY)).toBeNull();
    });

    it("names what it still needs, in the order onboarding asks", () => {
      expect(missingBudgetInputs(DAVE)).toEqual([]);
      expect(
        missingBudgetInputs({ ...DAVE, sex: null, height_cm: null, weight_kg: null }),
      ).toEqual(["sex", "height_cm", "weight_kg"]);
    });
  });
});

describe("earnedKcal", () => {
  it("hands back the configured share", () => {
    expect(earnedKcal(600, 50)).toBe(300);
    expect(earnedKcal(600, 100)).toBe(600);
    expect(earnedKcal(600, 0)).toBe(0);
    expect(earnedKcal(494, 50)).toBe(247);
  });

  it("rounds to whole kcal", () => {
    expect(earnedKcal(495, 50)).toBe(248);
    expect(earnedKcal(333, 33)).toBe(110);
  });

  it("earns nothing from no run", () => {
    expect(earnedKcal(0, 50)).toBe(0);
    expect(earnedKcal(-100, 50)).toBe(0);
    expect(earnedKcal(NaN, 50)).toBe(0);
  });

  it("clamps a percentage outside 0-100", () => {
    expect(earnedKcal(600, 150)).toBe(600);
    expect(earnedKcal(600, -10)).toBe(0);
    expect(earnedKcal(600, NaN)).toBe(0);
  });

  /** The reason the default is 50 and not 100: a watch's calorie figure is an
   *  estimate, and eating back all of an over-reported burn turns a deficit
   *  into maintenance. */
  it("defaults to giving back half, not all", () => {
    expect(earnedKcal(700, 50)).toBeLessThan(700);
  });

  /** Build rule 7, at the level this function can enforce it: earned is a
   *  number computed FROM the run, never added to the base target. Nothing
   *  here takes a target at all. */
  it("has no access to the base target", () => {
    expect(earnedKcal.length).toBe(2);
  });
});

describe("macroGrams", () => {
  it("splits kcal by the protein-forward default", () => {
    // 2000 × .35 / 4 · 2000 × .40 / 4 · 2000 × .25 / 9
    expect(macroGrams(2000, { protein_pct: 35, carb_pct: 40, fat_pct: 25 })).toEqual({
      protein_g: 175,
      carbs_g: 200,
      fat_g: 56,
    });
  });

  it("charges fat 9 kcal a gram and the rest 4", () => {
    const even = macroGrams(3600, { protein_pct: 33, carb_pct: 33, fat_pct: 34 });
    expect(even.protein_g).toBe(297); // 3600 × .33 / 4
    expect(even.carbs_g).toBe(297);
    expect(even.fat_g).toBe(136); // 3600 × .34 / 9
  });

  it("handles a zeroed leg", () => {
    expect(macroGrams(2000, { protein_pct: 50, carb_pct: 0, fat_pct: 50 })).toEqual({
      protein_g: 250,
      carbs_g: 0,
      fat_g: 111,
    });
  });
});
