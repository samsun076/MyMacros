import { Hono } from "hono";
import type { DayResponse } from "../../shared/api";
import { missingBudgetInputs } from "../../shared/budget";
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

  return c.json<DayResponse>({
    logs,
    totals,
    target_kcal: profile.target_kcal,
    run: null,
    onboarded,
  });
});

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export default day;
