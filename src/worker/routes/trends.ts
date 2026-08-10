import { Hono } from "hono";
import type { TrendsResponse } from "../../shared/api";
import { buildTrends, weekStart, type DayKcal } from "../../shared/trends";
import { shiftDay, TREND_WINDOW_DAYS } from "../../shared/weight";
import { loadProfile } from "../profile";
import type { AppEnv } from "../types";
import { isDay } from "../validate";

const trends = new Hono<AppEnv>();

/** Ranges the screen offers, in weeks. 24 weeks is 168 days, which stays
 *  inside `/api/weights`'s own 180-day horizon — the two reads of the same
 *  table should not disagree about how much history exists. */
const RANGES = [4, 12, 24] as const;
const DEFAULT_WEEKS = 12;

/** GET /api/trends/:date — the "is this working?" screen (#22).
 *
 *  `:date` is the CLIENT's local day, exactly as `/api/day/:date` takes it and
 *  for the same reason (#44). It is also the trap Session F fell into: a
 *  server-derived day compared against a client-supplied one silently drops
 *  the newest data for several hours every evening. The client owns the day;
 *  this route never forms an opinion about it.
 *
 *  **The targets on this screen are reconstructed, not recalled.**
 *  `profiles.target_kcal` is one stored current value, so what the target was
 *  three weeks ago exists nowhere. `buildTrends` recomputes each day's target
 *  and maintenance from that day's smoothed weight and the profile as it
 *  stands *now* — which means changing your activity level or goal rewrites
 *  every week on this screen retroactively. That is a real property, not a
 *  bug: the alternative is a daily-snapshot table, and the numbers are honest
 *  as long as they are read as "what the model says those weeks were".
 *
 *  Four indexed reads. The weights query is the only interesting one — it
 *  reaches six days behind the window so the first day's trailing 7-day
 *  window is complete rather than quietly averaging a short one. It also does
 *  not go through `recentWeighIns`, whose 60-day cap is shorter than the
 *  24-week range.
 */
trends.get("/:date", async (c) => {
  const today = isDay(c.req.param("date"));
  if (!today) return c.json({ error: "invalid_date" }, 400);

  const requested = Number(c.req.query("weeks"));
  const weeks = (RANGES as readonly number[]).includes(requested) ? requested : DEFAULT_WEEKS;

  const from = shiftDay(weekStart(today), -7 * (weeks - 1));
  const weighInsFrom = shiftDay(from, -(TREND_WINDOW_DAYS - 1));

  const userId = c.var.user.id;

  const [profile, intakeRows, runRows, weighIns] = await Promise.all([
    loadProfile(c.var.db, userId),

    // one row per day that has at least one food log. A day absent from this
    // result was NOT logged, which the arithmetic treats very differently
    // from a day of zero intake.
    c.var.db
      .selectFrom("food_logs")
      .select(({ fn }) => ["logged_on as day", fn.sum<number>("kcal").as("kcal")])
      .where("user_id", "=", userId)
      .where("logged_on", ">=", from)
      .where("logged_on", "<=", today)
      .groupBy("logged_on")
      .execute(),

    /* Runs summed across a multi-week window — which is the exact thing #67
     * filed itself against ("deferred until trends sum runs"). Nothing removes
     * a run that vanishes upstream, so a workout re-dated out of
     * `sync-runs.mjs`'s 30-day SELECT keeps its stale date here and perturbs
     * one week's expenditure. Left in M8 deliberately: the weekly bars make
     * the perturbation visible rather than hiding it in a single day-number. */
    c.var.db
      .selectFrom("runs")
      .select(({ fn }) => ["ran_on as day", fn.sum<number>("kcal").as("kcal")])
      .where("user_id", "=", userId)
      .where("ran_on", ">=", from)
      .where("ran_on", "<=", today)
      .groupBy("ran_on")
      .execute(),

    c.var.db
      .selectFrom("weights")
      .select(["measured_on", "weight_kg"])
      .where("user_id", "=", userId)
      .where("measured_on", ">=", weighInsFrom)
      .where("measured_on", "<=", today)
      .orderBy("measured_on", "asc")
      .execute(),
  ]);

  // SUM() comes back as whatever D1 hands over; the arithmetic downstream
  // assumes numbers, and a string here would concatenate rather than add
  const kcalByDay = (rows: { day: string; kcal: number }[]): DayKcal[] =>
    rows.map((r) => ({ day: r.day, kcal: Number(r.kcal) }));

  return c.json<TrendsResponse>(
    buildTrends({
      today,
      weeks,
      weighIns,
      intake: kcalByDay(intakeRows),
      runs: kcalByDay(runRows),
      profile: {
        sex: profile.sex,
        birth_date: profile.birth_date,
        height_cm: profile.height_cm,
        activity_level: profile.activity_level,
        goal: profile.goal,
        deficit_kcal: profile.deficit_kcal,
        eat_back_pct: profile.eat_back_pct,
      },
    }),
  );
});

export default trends;
