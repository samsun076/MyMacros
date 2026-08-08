/** The budget engine (#17). Pure arithmetic, no I/O, shared by both sides on
 *  purpose: onboarding previews the number live as you type, and the Worker
 *  recomputes it authoritatively on save. Two implementations of this would
 *  drift, and the drift would be invisible — the screen would just disagree
 *  with the database by a few hundred kcal.
 *
 *  Everything here is SI: kg and cm. Pounds and feet are a display concern
 *  (`profiles.units`), converted at the edge.
 */

import type { ActivityLevel, Goal, MacroSplit, Sex } from "./api";

/** Activity multipliers applied to BMR (Mifflin-St Jeor's own companion
 *  table).
 *
 *  **These describe life *excluding* purposeful exercise.** That is not the
 *  usual reading of the table, and getting it wrong is the single easiest way
 *  to make this app quietly lie: `runs` calories are added to the day
 *  separately as the earned bonus (#21), so a multiplier that already
 *  contained the running would count every mile twice — a plausible-looking
 *  budget several hundred kcal too generous, every day, with nothing visibly
 *  broken. The onboarding copy has to say "not counting workouts" for the
 *  same reason; if that wording ever goes, this comment is the record of why
 *  it was there. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** kcal per gram, by macro. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** The lowest base target the app will set for itself, by sex — the
 *  conventional floors for a self-directed deficit.
 *
 *  A guardrail, not medical advice: it exists so that a large deficit against
 *  a small TDEE can't silently produce a number no one should eat to. When it
 *  bites, `floored` says so and the UI says so — a clamp the user can't see
 *  is its own kind of wrong answer. */
export const MIN_TARGET_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

/** What the engine needs. Every Mifflin-St Jeor input is nullable because
 *  `profiles` leaves them null until onboarding fills them in, and `weight_kg`
 *  is nullable because it isn't a profile column at all — it's the latest
 *  `weights` row, so that a number which changes daily has exactly one home
 *  (#18). */
export type BudgetInputs = {
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: ActivityLevel;
  goal: Goal;
  deficit_kcal: number;
};

export type Budget = {
  /** Basal metabolic rate, kcal/day. */
  bmr: number;
  /** Maintenance: BMR × activity factor, excluding logged exercise. */
  tdee: number;
  /** The BASE daily target. The earned run bonus is never folded in — base
   *  and earned always draw separately (PLAN.md build rule 7). */
  target_kcal: number;
  /** True when MIN_TARGET_KCAL raised the target above deficit-from-TDEE. */
  floored: boolean;
};

/** Which inputs onboarding still needs, in the order it asks for them.
 *  Empty means `computeBudget` will return a number. */
export function missingBudgetInputs(i: BudgetInputs): (keyof BudgetInputs)[] {
  const missing: (keyof BudgetInputs)[] = [];
  if (i.sex !== "male" && i.sex !== "female") missing.push("sex");
  if (ageOn(i.birth_date) === null) missing.push("birth_date");
  if (!positive(i.height_cm)) missing.push("height_cm");
  if (!positive(i.weight_kg)) missing.push("weight_kg");
  return missing;
}

/** Whole years, or null if the date is unusable.
 *
 *  Compared component-wise in local time rather than by subtracting
 *  timestamps: `birth_date` is a calendar date, not an instant, and dividing
 *  an elapsed-milliseconds figure by 365.25 puts people on the wrong side of
 *  their birthday for a day at a time. */
export function ageOn(birthDate: string | null, today = new Date()): number | null {
  if (typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  let age = today.getFullYear() - y;
  const month = today.getMonth() + 1;
  // birthday hasn't come round yet this year
  if (month < m || (month === m && today.getDate() < d)) age -= 1;

  return age >= 0 && age < 130 ? age : null;
}

/** Mifflin-St Jeor. The modern default over Harris-Benedict; PLAN.md locks
 *  it. Sex enters as a flat offset, which is the whole of its role here. */
export function bmr(input: {
  sex: Sex;
  weight_kg: number;
  height_cm: number;
  age: number;
}): number {
  const base = 10 * input.weight_kg + 6.25 * input.height_cm - 5 * input.age;
  return base + (input.sex === "male" ? 5 : -161);
}

/** BMR × activity, then the goal's adjustment, then the floor.
 *
 *  Null when onboarding hasn't supplied everything — the caller shows the
 *  onboarding prompt rather than a fabricated target. It never guesses a
 *  missing input, because a guessed TDEE is indistinguishable from a real one
 *  once it's a number on a screen. */
export function computeBudget(i: BudgetInputs, today = new Date()): Budget | null {
  if (missingBudgetInputs(i).length) return null;

  const age = ageOn(i.birth_date, today);
  // narrowed by missingBudgetInputs above; re-checked so the types hold
  if (age === null || (i.sex !== "male" && i.sex !== "female")) return null;
  if (!positive(i.height_cm) || !positive(i.weight_kg)) return null;

  const basal = bmr({ sex: i.sex, weight_kg: i.weight_kg, height_cm: i.height_cm, age });
  const maintenance = basal * ACTIVITY_FACTORS[i.activity_level];

  // `deficit_kcal` is a magnitude; `goal` decides its sign. Maintaining
  // ignores it entirely rather than storing a second zero the user can't see.
  const adjustment =
    i.goal === "cut" ? -i.deficit_kcal : i.goal === "gain" ? i.deficit_kcal : 0;

  const raw = maintenance + adjustment;
  const floor = MIN_TARGET_KCAL[i.sex];

  return {
    bmr: Math.round(basal),
    tdee: Math.round(maintenance),
    target_kcal: Math.round(Math.max(raw, floor)),
    floored: raw < floor,
  };
}

/** The share of a day's run calories that extends the budget (#21).
 *
 *  Partial by default (PLAN.md locks 50%) for a reason worth keeping in view:
 *  a watch's calorie estimate is itself an estimate, and eating back 100% of
 *  an over-reported burn is how a deficit quietly becomes maintenance. Half
 *  is the conventional hedge.
 *
 *  This is the ONLY place run calories enter the budget. They never reach
 *  `target_kcal` — base and earned always draw separately (build rule 7), so
 *  the earned figure is computed per-day at read time and the stored target
 *  stays the answer to "what do I eat on a day I don't run". */
export function earnedKcal(runKcal: number, eatBackPct: number): number {
  if (!Number.isFinite(runKcal) || runKcal <= 0) return 0;
  // the column is CHECKed 0-100, but this also runs on client-side input
  const pct = Math.min(Math.max(Number.isFinite(eatBackPct) ? eatBackPct : 0, 0), 100);
  return Math.round((runKcal * pct) / 100);
}

/** Grams of each macro for a target, from the percent-of-kcal split.
 *
 *  Rounded to whole grams for display; the percentages remain the stored
 *  truth, so rounding here never accumulates anywhere. */
export function macroGrams(targetKcal: number, split: MacroSplit) {
  return {
    protein_g: Math.round((targetKcal * split.protein_pct) / 100 / KCAL_PER_G.protein),
    carbs_g: Math.round((targetKcal * split.carb_pct) / 100 / KCAL_PER_G.carbs),
    fat_g: Math.round((targetKcal * split.fat_pct) / 100 / KCAL_PER_G.fat),
  };
}

function positive(n: number | null): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}
