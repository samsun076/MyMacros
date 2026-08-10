import { describe, expect, it } from "vitest";
import {
  ACTIVITY_FACTORS,
  ageOn,
  bmr,
  type BudgetInputs,
  computeBudget,
  earnedKcal,
  KCAL_PER_G,
  MIN_FAT_G_PER_KG,
  macroTargets,
  missingBudgetInputs,
  PROTEIN_G_PER_KG,
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

/** #77. The production case that raised it: 76.3 kg, cutting, 58:42 carb:fat
 *  preserved from the old 35:25 split. A 5.0 mi run earned 219 kcal, and
 *  under the percentage model that moved the protein target 191 g → 213 g. */
describe("macroTargets", () => {
  const DAVE = { weight_kg: 76.3, protein_g_per_kg: 2.0, carb_ratio_pct: 58 };

  it("anchors protein to body weight, not to the day's energy", () => {
    // 2.0 × 76.3 = 152.6 → 153
    expect(macroTargets({ ...DAVE, kcal: 1909 })?.protein_g).toBe(153);
  });

  /** THE REGRESSION THIS ISSUE EXISTS TO PREVENT. A run must move carbs and
   *  fat and leave protein exactly where it was — the old model gave 40% of
   *  the earned bonus to protein, which is what made the target jump 22 g on
   *  the days appetite and time are worst. */
  it("is invariant to the earned bonus, which moves carbs and fat only", () => {
    const rest = macroTargets({ ...DAVE, kcal: 1909 });
    const ran = macroTargets({ ...DAVE, kcal: 1909 + 219 });

    expect(ran?.protein_g).toBe(rest?.protein_g);
    expect(ran!.carbs_g).toBeGreaterThan(rest!.carbs_g);
    expect(ran!.fat_g).toBeGreaterThan(rest!.fat_g);

    // and all 219 of it landed somewhere — nothing was quietly dropped
    const spent = (t: NonNullable<ReturnType<typeof macroTargets>>) =>
      t.carbs_g * KCAL_PER_G.carbs + t.fat_g * KCAL_PER_G.fat;
    expect(spent(ran!) - spent(rest!)).toBeGreaterThan(210);
    expect(spent(ran!) - spent(rest!)).toBeLessThan(228);
  });

  it("divides the energy left after protein by the carb:fat ratio", () => {
    const t = macroTargets({ ...DAVE, kcal: 2128 })!;
    // 2128 − 153 × 4 = 1516 left; 42% of that is 636.7 kcal of fat → 70.7 g,
    // and carbs get what is actually left after the unrounded fat, 879.3 → 220
    expect(t.fat_g).toBe(71);
    expect(t.carbs_g).toBe(220);
    expect(t.fat_floored).toBe(false);
  });

  it("spends the whole target, give or take rounding", () => {
    const t = macroTargets({ ...DAVE, kcal: 2128 })!;
    const total =
      t.protein_g * KCAL_PER_G.protein + t.carbs_g * KCAL_PER_G.carbs + t.fat_g * KCAL_PER_G.fat;
    expect(Math.abs(total - 2128)).toBeLessThanOrEqual(6);
  });

  /** The floor exists because high protein against an aggressive deficit
   *  squeezes fat, and it has to be reported when it bites — the same
   *  contract MIN_TARGET_KCAL has with `floored`. */
  it("holds fat at the floor and lets carbs absorb the difference", () => {
    // a hard cut at a high protein anchor, with almost all the remainder
    // asked to be carbohydrate
    const t = macroTargets({ weight_kg: 90, protein_g_per_kg: 2.4, carb_ratio_pct: 95, kcal: 1600 })!;
    expect(t.fat_floored).toBe(true);
    expect(t.fat_g).toBe(Math.round(MIN_FAT_G_PER_KG * 90)); // 54
    // 1600 − 216 × 4 = 736 left, less 54 × 9 = 486 → 250 / 4
    expect(t.carbs_g).toBe(63);
  });

  it("does not report a floor that never bound", () => {
    expect(macroTargets({ ...DAVE, kcal: 2128 })?.fat_floored).toBe(false);
  });

  /** No weight, no anchor. Withhold rather than fabricate — the same posture
   *  `computeBudget` takes when onboarding hasn't finished. */
  it("returns null before the first weigh-in", () => {
    expect(macroTargets({ ...DAVE, weight_kg: null, kcal: 2000 })).toBeNull();
    expect(macroTargets({ ...DAVE, weight_kg: 0, kcal: 2000 })).toBeNull();
    expect(macroTargets({ ...DAVE, kcal: 0 })).toBeNull();
  });

  /** A floored budget against a heavy body: protein alone can outspend the
   *  target. Carbs and fat go to zero rather than negative. */
  it("never hands out a negative remainder", () => {
    const t = macroTargets({ weight_kg: 120, protein_g_per_kg: 2.6, carb_ratio_pct: 58, kcal: 1200 })!;
    expect(t.carbs_g).toBe(0);
    expect(t.fat_g).toBe(0);
  });

  it("keeps the goal presets a U rather than a ladder", () => {
    expect(PROTEIN_G_PER_KG.cut).toBeGreaterThan(PROTEIN_G_PER_KG.maintain);
    expect(PROTEIN_G_PER_KG.gain).toBeGreaterThan(PROTEIN_G_PER_KG.maintain);
  });
});
