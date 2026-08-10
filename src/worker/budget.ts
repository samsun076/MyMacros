import type { Budget } from "../shared/budget";
import { computeBudget } from "../shared/budget";
import { dayInTimezone } from "../shared/day";
import {
  currentTrendWeightKg,
  TREND_WINDOW_DAYS,
  trendWeightKg,
  type WeighIn,
} from "../shared/weight";
import type { Db } from "./db";
import { loadProfile } from "./profile";

/** The server side of the budget engine (#17): read the inputs, run the
 *  shared arithmetic, store the result.
 *
 *  `profiles.target_kcal` stays a stored column — M4 changes how it is
 *  calculated, not where it lives — so it has to be refreshed whenever an
 *  input moves. One of those inputs lives outside `profiles`: the weigh-ins
 *  (#18). Runs deliberately are not an input; their calories arrive as the
 *  earned bonus (#21) and never touch the base target (build rule 7).
 */

/** How far back to read weigh-ins. The trend needs the 7-day window, and the
 *  fallback for a sparse logger needs whatever came before it — 60 days is
 *  wide enough for both and small enough to stay one cheap indexed read. */
const WEIGH_IN_LOOKBACK_DAYS = 60;

/** Recent weigh-ins, newest first. `on` bounds the query for an as-of read
 *  (the trends screen asking what the trend was on some past day); omit it to
 *  get the newest regardless of date. */
export async function recentWeighIns(db: Db, userId: string, on?: string): Promise<WeighIn[]> {
  const q = db
    .selectFrom("weights")
    .select(["measured_on", "weight_kg"])
    .where("user_id", "=", userId);

  return (on ? q.where("measured_on", "<=", on) : q)
    .orderBy("measured_on", "desc")
    .limit(WEIGH_IN_LOOKBACK_DAYS)
    .execute();
}

/** The weight the engine budgets against: the 7-day smoothed trend, not the
 *  last number on the scale.
 *
 *  #18 is explicit that recalculation follows the trend, and the reason is
 *  that raw bodyweight swings several pounds on water and salt — budgeting
 *  against it would move the daily target by a few hundred kcal for reasons
 *  that have nothing to do with fat.
 *
 *  Not `profiles.start_weight_kg` either: that is where the journey began,
 *  and budgeting against it would freeze the target at day one, the opposite
 *  of PLAN.md's "targets recompute as logged weight drops". */
export async function trendWeightFor(db: Db, userId: string, on: string) {
  return trendWeightKg(await recentWeighIns(db, userId, on), on);
}

/** Recompute and persist `target_kcal`. Returns the budget, or null when
 *  onboarding hasn't supplied enough to compute one.
 *
 *  **Leaves the stored value alone when it can't compute.** A user who hasn't
 *  onboarded keeps the migration's default rather than having their target
 *  derived from missing inputs — the engine declines to answer rather than
 *  answering badly.
 *
 *  `now` is an instant; the *day* it belongs to comes from the profile's
 *  timezone, because this runs with no client present and a Worker's own
 *  clock is UTC (#44). For a user in New York that is tomorrow for the last
 *  five hours of every evening. */
export async function refreshTarget(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<Budget | null> {
  const profile = await loadProfile(db, userId);
  const today = dayInTimezone(now, profile.timezone);

  /* The anchoring rule this used to spell out inline now lives in
   * `currentTrendWeightKg` — `/api/me` has to answer the same question so the
   * Settings preview and the stored target agree, and two copies of it would
   * drift. That drift is #78: the preview read `start_weight_kg` instead and
   * the two screens showed different base targets. */
  const entries = await recentWeighIns(db, userId);
  const weight_kg = currentTrendWeightKg(entries, today);

  const budget = computeBudget(
    {
      sex: profile.sex,
      birth_date: profile.birth_date,
      height_cm: profile.height_cm,
      weight_kg,
      activity_level: profile.activity_level,
      goal: profile.goal,
      deficit_kcal: profile.deficit_kcal,
    },
    // age is a calendar question, and `today` already answers it in the
    // user's own timezone
    new Date(`${today}T12:00:00Z`),
  );

  if (!budget) return null;
  if (budget.target_kcal === profile.target_kcal) return budget;

  await db
    .updateTable("profiles")
    .set({ target_kcal: budget.target_kcal, updated_at: new Date().toISOString() })
    .where("user_id", "=", userId)
    .execute();

  return budget;
}

export { TREND_WINDOW_DAYS };
