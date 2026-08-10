/** The budget engine (#17). Pure arithmetic, no I/O, shared by both sides on
 *  purpose: onboarding previews the number live as you type, and the Worker
 *  recomputes it authoritatively on save. Two implementations of this would
 *  drift, and the drift would be invisible — the screen would just disagree
 *  with the database by a few hundred kcal.
 *
 *  Everything here is SI: kg and cm. Pounds and feet are a display concern
 *  (`profiles.units`), converted at the edge.
 */

import type { ActivityLevel, Goal, Sex } from "./api";

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

/** Protein defaults, g per kg of body weight, by goal (#77).
 *
 *  **A U, not a ladder**, and the two raised ends are raised for different
 *  reasons: in a deficit more amino acid is oxidised for fuel, so a cut needs
 *  more protein to *keep* existing tissue; a gain is adding tissue and the
 *  material has to come from somewhere; maintain is doing neither.
 *
 *  Two mistakes this table exists to prevent. Do not make protein ascend with
 *  calories — that is the percentage model this replaced. Do not make it
 *  descend from cut either: the literature puts a cut marginally above a
 *  gain, but by ~0.1–0.2 g/kg, which is inside the noise of everything else
 *  in the budget and not worth a distinct default. And the gain preset stops
 *  at 2.0 because beyond that protein displaces the carbohydrate that fuels
 *  the training driving the growth — displacement, not diminished value. */
export const PROTEIN_G_PER_KG: Record<Goal, number> = { cut: 2.0, maintain: 1.6, gain: 2.0 };

/** The slider's range. A preset is a default, not a lock — every other budget
 *  input on that screen is adjustable and this one matches. */
export const PROTEIN_G_PER_KG_RANGE = { min: 1.2, max: 2.6, step: 0.1 };

/** The fat floor, g per kg. High protein against an aggressive deficit
 *  squeezes fat, and below roughly this it starts to matter hormonally.
 *
 *  Same posture as MIN_TARGET_KCAL: a guardrail, not medical advice, and one
 *  that says so on screen when it bites — a clamp the user can't see is its
 *  own kind of wrong answer. Carbs absorb whatever the floor takes. */
export const MIN_FAT_G_PER_KG = 0.6;

export type MacroInputs = {
  /** The day's energy. Today passes the ADJUSTED total (base + earned), so
   *  the run's calories land on carbs and fat; onboarding passes the base. */
  kcal: number;
  /** The smoothed trend weight — the same number `refreshTarget` computes
   *  from. Never a second weight source (#78). Null before the first weigh-in,
   *  which is the one case with no anchor and therefore no answer. */
  weight_kg: number | null;
  protein_g_per_kg: number;
  /** Carbohydrate's share of the energy left after protein; fat takes the
   *  rest. One number, so the legs cannot fail to add up. */
  carb_ratio_pct: number;
};

export type MacroTargets = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** MIN_FAT_G_PER_KG raised fat above what the ratio alone would give. */
  fat_floored: boolean;
};

/** Grams of each macro for a day (#77).
 *
 *  **Protein is invariant to the day's energy.** That is the property this
 *  function exists to have, and the one a test pins: the same person at the
 *  same weight gets the same protein target on a 10-mile day as on a rest
 *  day, and the earned bonus moves carbs and fat only.
 *
 *  Null rather than a fabricated number when there is no weight to anchor to
 *  — the same posture as `computeBudget`, for the same reason: a guessed
 *  target is indistinguishable from a real one once it's on screen. */
export function macroTargets(i: MacroInputs): MacroTargets | null {
  if (!positive(i.weight_kg) || !positive(i.kcal)) return null;

  // clamped because this also runs on client-side slider input, where the
  // column's own bounds haven't applied yet
  const perKg = clamp(i.protein_g_per_kg, PROTEIN_G_PER_KG_RANGE.min, PROTEIN_G_PER_KG_RANGE.max);
  const protein_g = Math.round(perKg * i.weight_kg);

  // Protein alone can exceed a very small target (a floored budget against a
  // heavy body). The remainder is clamped at zero rather than going negative
  // and handing carbs a target below nothing.
  const remaining = Math.max(i.kcal - protein_g * KCAL_PER_G.protein, 0);
  const carbShare = clamp(i.carb_ratio_pct, 0, 100) / 100;

  const fromRatio = (remaining * (1 - carbShare)) / KCAL_PER_G.fat;
  const floor = MIN_FAT_G_PER_KG * i.weight_kg;
  // the floor can't spend energy that isn't there either — when the remainder
  // is smaller than the floor, fat simply takes all of it and carbs get none
  const fat = Math.min(Math.max(fromRatio, floor), remaining / KCAL_PER_G.fat);

  return {
    protein_g,
    carbs_g: Math.round((remaining - fat * KCAL_PER_G.fat) / KCAL_PER_G.carbs),
    fat_g: Math.round(fat),
    fat_floored: fromRatio < floor,
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(n) ? n : min, min), max);
}

function positive(n: number | null): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}
