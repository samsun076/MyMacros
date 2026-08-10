import { Hono } from "hono";
import type { DayResponse, DayRun, FeedHealth } from "../../shared/api";
import { computeBudget, earnedKcal, missingBudgetInputs } from "../../shared/budget";
import { dayInTimezone } from "../../shared/day";
import { feedStale } from "../../shared/sync";
import { currentTrendWeightKg, trendWeightKg } from "../../shared/weight";
import { recentWeighIns } from "../budget";
import { loadProfile } from "../profile";
import type { AppEnv } from "../types";
import { isDay } from "../validate";

const day = new Hono<AppEnv>();

/** The Today screen's one read (#48): the day's logs, their totals, and the
 *  base target in a single round trip. `:date` comes from the client, which
 *  owns the local day (#44). The shape is M4-ready — #19/#21 fill `run` and
 *  the adjusted-target arithmetic here instead of rewriting the client. */
day.get("/:date", async (c) => {
  const date = isDay(c.req.param("date"));
  if (!date) return c.json({ error: "invalid_date" }, 400);

  const logs = await c.var.db
    .selectFrom("food_logs")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .where("logged_on", "=", date)
    .orderBy("logged_at", "asc")
    .execute();

  const totals = logs.reduce(
    (t, log) => ({
      kcal: t.kcal + log.kcal,
      protein_g: t.protein_g + log.protein_g,
      carbs_g: t.carbs_g + log.carbs_g,
      fat_g: t.fat_g + log.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
  // grams are REAL columns — keep float noise out of the wire
  totals.protein_g = round1(totals.protein_g);
  totals.carbs_g = round1(totals.carbs_g);
  totals.fat_g = round1(totals.fat_g);

  const profile = await loadProfile(c.var.db, c.var.user.id);

  // Whether the stored target was computed for this person or is still the
  // migration's default (#17). The weigh-in is part of the answer, so this
  // can't be read off `profiles` alone.
  //
  // "Has this person ever weighed in", not "as of this date" — onboarding is
  // a question about setup, not about the day being viewed. Asking as-of
  // would report an un-onboarded past, and would disagree with refreshTarget
  // about a weigh-in dated ahead of the server's day.
  const weighIns = await recentWeighIns(c.var.db, c.var.user.id);
  const onboarded =
    missingBudgetInputs({
      sex: profile.sex,
      birth_date: profile.birth_date,
      height_cm: profile.height_cm,
      weight_kg: weighIns[0]?.weight_kg ?? null,
      activity_level: profile.activity_level,
      goal: profile.goal,
      deficit_kcal: profile.deficit_kcal,
    }).length === 0;

  // The day's runs, folded into one earned figure (#21). Scoped to the same
  // local day the meals are, so a run and the meals it earns back always
  // agree about which day they belong to (#44).
  const runs = await c.var.db
    .selectFrom("runs")
    .select(["kcal", "distance_m"])
    .where("user_id", "=", c.var.user.id)
    .where("ran_on", "=", date)
    .execute();

  const runKcal = runs.reduce((s, r) => s + r.kcal, 0);
  const run: DayRun | null = runs.length
    ? {
        count: runs.length,
        kcal: runKcal,
        distance_m: Math.round(runs.reduce((s, r) => s + r.distance_m, 0)),
        earned_kcal: earnedKcal(runKcal, profile.eat_back_pct),
        eat_back_pct: profile.eat_back_pct,
      }
    : null;

  /* Is `run: null` above a rest day or a dead sync (#69)?
   *
   * Only asserted for the day being LIVED. A feed that died last night doesn't
   * make last Tuesday's runs incomplete — they arrived, on time, and marking a
   * settled day as doubtful would put a warning on screen that syncing can
   * never clear.
   *
   * `>=` rather than `===` because the client owns its local day and this
   * timezone is a stored default until it says otherwise (#44); the two sit on
   * opposite sides of midnight for several hours each evening. Erring toward
   * the client's day keeps the marker working during exactly that window. */
  const source = await c.var.db
    .selectFrom("sync_sources")
    .select(["last_success_at", "last_item_count"])
    .where("user_id", "=", c.var.user.id)
    .where("source", "=", "runs")
    .executeTakeFirst();

  const runs_feed: FeedHealth | null = source
    ? {
        last_success_at: source.last_success_at,
        last_item_count: source.last_item_count,
        stale:
          date >= dayInTimezone(new Date(), profile.timezone) &&
          feedStale(source.last_success_at, new Date()),
      }
    : null;

  /* Computed here, not read from `profiles.target_kcal` (#85).
   *
   * The stored column is refreshed on write — a profile PATCH, a weight write,
   * or a sync that carried weights. But the 7-day window slides with *time*, so
   * on a day when nothing is written the readings age out, the real trend moves
   * and the stored number does not. Measured: a stored 2,154 against a live
   * 2,183, converging only when the next PATCH happened to fire refreshTarget.
   *
   * Trends already recomputes rather than reading the column
   * (`shared/trends.ts`), so this is what makes the two screens agree by
   * construction instead of by coincidence — the same "one quantity, two
   * answers" defect as #78, one layer down.
   *
   * Costs no extra query: `weighIns` and `profile` are both already loaded.
   *
   * As-of for a past date, anchored for the current one. Anchoring forward to
   * a weigh-in dated ahead of the day is only right when the day IS today;
   * for a past date it would answer with a weight from after it. */
  const asOfToday = date >= dayInTimezone(new Date(), profile.timezone);
  const trendKg = asOfToday
    ? currentTrendWeightKg(weighIns, date)
    : trendWeightKg(
        weighIns.filter((w) => w.measured_on <= date),
        date,
      );

  const budget = computeBudget(
    {
      sex: profile.sex,
      birth_date: profile.birth_date,
      height_cm: profile.height_cm,
      weight_kg: trendKg,
      activity_level: profile.activity_level,
      goal: profile.goal,
      deficit_kcal: profile.deficit_kcal,
    },
    // age is a calendar question, answered on the day being viewed
    new Date(`${date}T12:00:00Z`),
  );

  return c.json<DayResponse>({
    logs,
    totals,
    /* Falls back to the stored value when the engine declines, which keeps
     * #17's un-onboarded behaviour: Today deliberately shows the deployment's
     * default target until the inputs exist (`Today.tsx:120`). */
    target_kcal: budget?.target_kcal ?? profile.target_kcal,
    run,
    onboarded,
    runs_feed,
  });
});

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export default day;
