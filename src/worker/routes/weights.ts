import { Hono } from "hono";
import type { WeightCreate, WeightsResponse } from "../../shared/api";
import { trendSeries, trendWeightKg } from "../../shared/weight";
import { refreshTarget } from "../budget";
import type { AppEnv } from "../types";
import { isDay, isNum } from "../validate";

const weights = new Hono<AppEnv>();

/** How much history a read returns. Enough for the trends screen's weekly
 *  view (#22) without paging, and the smoothing only ever needs the last
 *  seven days of it. */
const HISTORY_DAYS = 180;

/** Sanity bounds, not clinical ones — they exist to catch a slipped decimal
 *  or a pounds-shaped number typed into a kg field, both of which would move
 *  the target hundreds of kcal without looking wrong. */
const MIN_KG = 20;
const MAX_KG = 400;

const kg = (v: unknown) =>
  isNum(v) && v >= MIN_KG && v <= MAX_KG ? Math.round(v * 10) / 10 : undefined;

weights.get("/", async (c) => {
  const rows = await c.var.db
    .selectFrom("weights")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .orderBy("measured_on", "desc")
    .limit(HISTORY_DAYS)
    .execute();

  // oldest first for the chart; the query is desc so the limit keeps the
  // *recent* window rather than the first 180 days ever recorded
  const entries = [...rows].reverse();
  const latest = rows[0] ?? null;

  return c.json<WeightsResponse>({
    entries,
    series: trendSeries(entries),
    latest,
    trend_kg: latest ? trendWeightKg(entries, latest.measured_on) : null,
  });
});

/** Manual entry (#18). Garmin's sync (#20) writes the same table through
 *  /api/sync, which is why `source` is set here rather than accepted.
 *
 *  Upserts on (user_id, measured_on) — the schema's unique index. Weighing
 *  twice in a morning should correct the day, not create a second row that
 *  silently drags the mean. */
weights.post("/", async (c) => {
  const body = await c.req.json<WeightCreate>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const weight_kg = kg(body.weight_kg);
  if (weight_kg === undefined) return c.json({ error: "invalid_weight" }, 400);

  // the client owns the day (#44) but a manual entry may be back-dated
  const measured_on = isDay(body.measured_on);
  if (!measured_on) return c.json({ error: "invalid_date" }, 400);

  const body_fat_pct =
    body.body_fat_pct === undefined || body.body_fat_pct === null
      ? null
      : isNum(body.body_fat_pct) && body.body_fat_pct > 0 && body.body_fat_pct < 100
        ? Math.round(body.body_fat_pct * 10) / 10
        : undefined;
  if (body_fat_pct === undefined) return c.json({ error: "invalid_body_fat" }, 400);

  await c.var.db
    .insertInto("weights")
    .values({
      id: crypto.randomUUID(),
      // from the session, never the body
      user_id: c.var.user.id,
      measured_on,
      weight_kg,
      body_fat_pct,
      source: "manual",
    })
    .onConflict((oc) =>
      oc.columns(["user_id", "measured_on"]).doUpdateSet({ weight_kg, body_fat_pct, source: "manual" }),
    )
    .execute();

  // the whole point of logging a weight: the target follows the trend down
  const budget = await refreshTarget(c.var.db, c.var.user.id);

  return c.json({ ok: true, target_kcal: budget?.target_kcal ?? null }, 201);
});

/** Removing a mistyped weigh-in has to move the target back, so it goes
 *  through the same recompute rather than leaving a target derived from a
 *  number that no longer exists. */
weights.delete("/:date", async (c) => {
  const measured_on = isDay(c.req.param("date"));
  if (!measured_on) return c.json({ error: "invalid_date" }, 400);

  const result = await c.var.db
    .deleteFrom("weights")
    .where("user_id", "=", c.var.user.id)
    .where("measured_on", "=", measured_on)
    .executeTakeFirst();

  if (!result.numDeletedRows) return c.json({ error: "not_found" }, 404);

  await refreshTarget(c.var.db, c.var.user.id);
  return c.json({ ok: true });
});

export default weights;
