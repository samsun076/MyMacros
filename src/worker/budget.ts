import type { Budget } from "../shared/budget";
import { computeBudget } from "../shared/budget";
import type { Db } from "./db";
import { loadProfile } from "./profile";

/** The server side of the budget engine (#17): read the inputs, run the
 *  shared arithmetic, store the result.
 *
 *  `profiles.target_kcal` stays a stored column — M4 changes how it is
 *  calculated, not where it lives — so it has to be refreshed whenever an
 *  input to it moves. Two of those inputs live outside `profiles`: the
 *  latest weigh-in (#18), and nothing else. Runs deliberately are not an
 *  input; their calories arrive as the earned bonus (#21) and never touch the
 *  base target (build rule 7).
 */

/** The weight the engine should use: the most recent weigh-in on or before
 *  `on`, or the newest overall when that finds nothing.
 *
 *  Not `profiles.start_weight_kg` — that is where the journey began, and
 *  budgeting against it would freeze the target at day one, which is the
 *  opposite of PLAN.md's "targets recompute as logged weight drops". */
export async function latestWeightKg(db: Db, userId: string, on?: string) {
  const q = db
    .selectFrom("weights")
    .select(["weight_kg", "measured_on"])
    .where("user_id", "=", userId);

  const row = await (on ? q.where("measured_on", "<=", on) : q)
    .orderBy("measured_on", "desc")
    .executeTakeFirst();

  return row?.weight_kg ?? null;
}

/** Recompute and persist `target_kcal`. Returns the budget, or null when
 *  onboarding hasn't supplied enough to compute one.
 *
 *  **Leaves the stored value alone when it can't compute.** A user who hasn't
 *  onboarded keeps the migration's default rather than having their target
 *  zeroed by a half-filled profile — the engine declines to answer rather
 *  than answering badly. */
export async function refreshTarget(
  db: Db,
  userId: string,
  today = new Date(),
): Promise<Budget | null> {
  const profile = await loadProfile(db, userId);
  const weight_kg = await latestWeightKg(db, userId);

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
    today,
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
