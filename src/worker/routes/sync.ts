import { Hono } from "hono";
import type { SyncRequest, SyncResponse } from "../../shared/api";
import { refreshTarget } from "../budget";
import { createDb } from "../db";
import { bearerFrom, markSyncTokenUsed, userForSyncToken } from "../sync-token";
import type { AppEnv } from "../types";
import { isDay, isNum } from "../validate";

/** POST /api/sync (#19) — the one route a machine calls.
 *
 *  Mounted OUTSIDE the `secure` sub-app, because `requireAuth` looks for a
 *  session cookie and a launchd job has none. That is the only thing it does
 *  differently: it still resolves a caller to a real `user_id` before touching
 *  anything, and still writes every row scoped to that id and never to one
 *  from the body. The rule ("the user comes from the context, never the
 *  request") is extended to the machine caller, not relaxed for it.
 *
 *  Idempotent by construction. The launchd job re-sends a rolling window on
 *  every run and must be safe to run twice a minute forever: runs upsert on
 *  `(user_id, external_id)` and weights on `(user_id, measured_on)`, both of
 *  which the schema already makes unique.
 */
const sync = new Hono<AppEnv>();

/** Rolling windows are the point, but a runaway loop shouldn't be able to
 *  write unbounded rows in one request. */
const MAX_ITEMS = 500;

sync.post("/", async (c) => {
  const token = bearerFrom(c.req.header("Authorization"));
  if (!token) {
    // WWW-Authenticate so a misconfigured client gets told what it's missing
    return c.json({ error: "missing_token" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const db = createDb(c.env);
  const caller = await userForSyncToken(db, token);
  if (!caller) return c.json({ error: "invalid_token" }, 401, { "WWW-Authenticate": "Bearer" });

  const body = await c.req.json<SyncRequest>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const runs = Array.isArray(body.runs) ? body.runs : [];
  const weights = Array.isArray(body.weights) ? body.weights : [];
  if (runs.length > MAX_ITEMS || weights.length > MAX_ITEMS) {
    return c.json({ error: "too_many_items", max: MAX_ITEMS }, 413);
  }

  const rejected: string[] = [];
  let runsWritten = 0;
  let weightsWritten = 0;

  for (const [i, raw] of runs.entries()) {
    const run = validRun(raw);
    if (!run) {
      rejected.push(`runs[${i}]`);
      continue;
    }
    await db
      .insertInto("runs")
      .values({
        id: crypto.randomUUID(),
        user_id: caller.id,
        ran_on: run.ran_on,
        started_at: run.started_at,
        distance_m: run.distance_m,
        duration_s: run.duration_s,
        kcal: run.kcal,
        tss: run.tss,
        source: "debrief",
        external_id: run.external_id,
      })
      // The schema's unique index is (user_id, external_id) and SQLite keeps
      // NULLs distinct there, so a manually-added run never collides while a
      // synced one stays idempotent. Re-sending a workout updates it —
      // debrief revises TSS when a better calculation method arrives.
      .onConflict((oc) =>
        oc.columns(["user_id", "external_id"]).doUpdateSet({
          ran_on: run.ran_on,
          started_at: run.started_at,
          distance_m: run.distance_m,
          duration_s: run.duration_s,
          kcal: run.kcal,
          tss: run.tss,
        }),
      )
      .execute();
    runsWritten++;
  }

  for (const [i, raw] of weights.entries()) {
    const w = validWeight(raw);
    if (!w) {
      rejected.push(`weights[${i}]`);
      continue;
    }
    await db
      .insertInto("weights")
      .values({
        id: crypto.randomUUID(),
        user_id: caller.id,
        measured_on: w.measured_on,
        weight_kg: w.weight_kg,
        body_fat_pct: w.body_fat_pct,
        // set here, not accepted: a weight arriving on this route came from
        // the scale pipeline (#20). Manual entry is /api/weights.
        source: "garmin",
      })
      .onConflict((oc) =>
        oc.columns(["user_id", "measured_on"]).doUpdateSet({
          weight_kg: w.weight_kg,
          body_fat_pct: w.body_fat_pct,
          source: "garmin",
        }),
      )
      .execute();
    weightsWritten++;
  }

  // A new weigh-in moves the trend, and the trend is what the target follows
  // (#18). Skipped when only runs arrived: runs never touch the base target —
  // their calories are the earned bonus (#21), which is computed per-day at
  // read time rather than folded in here (build rule 7).
  const budget = weightsWritten ? await refreshTarget(db, caller.id) : null;

  await markSyncTokenUsed(db, caller.token_id);

  return c.json<SyncResponse>({
    runs: runsWritten,
    weights: weightsWritten,
    // named, so a script that silently drops half its payload is visible in
    // the launchd log rather than looking like a clean run
    rejected,
    target_kcal: budget?.target_kcal ?? null,
  });
});

function validRun(raw: unknown) {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== "object") return null;

  const ran_on = isDay(r.ran_on);
  const external_id = typeof r.external_id === "string" && r.external_id ? r.external_id : null;
  const distance_m = isNum(r.distance_m) && r.distance_m >= 0 ? r.distance_m : null;
  const kcal = isNum(r.kcal) && r.kcal >= 0 && r.kcal <= 20000 ? Math.round(r.kcal) : null;
  if (!ran_on || !external_id || distance_m === null || kcal === null) return null;

  return {
    ran_on,
    external_id,
    distance_m,
    kcal,
    started_at: typeof r.started_at === "string" ? r.started_at : null,
    duration_s: isNum(r.duration_s) && r.duration_s >= 0 ? Math.round(r.duration_s) : null,
    tss: isNum(r.tss) && r.tss >= 0 ? r.tss : null,
  };
}

function validWeight(raw: unknown) {
  const w = raw as Record<string, unknown>;
  if (!w || typeof w !== "object") return null;

  const measured_on = isDay(w.measured_on);
  // same sanity bounds as manual entry: catches a slipped decimal or a
  // pounds-shaped number, both of which move the target hundreds of kcal
  const weight_kg = isNum(w.weight_kg) && w.weight_kg >= 20 && w.weight_kg <= 400
    ? Math.round(w.weight_kg * 10) / 10
    : null;
  if (!measured_on || weight_kg === null) return null;

  const bf = w.body_fat_pct;
  return {
    measured_on,
    weight_kg,
    body_fat_pct: isNum(bf) && bf > 0 && bf < 100 ? Math.round(bf * 10) / 10 : null,
  };
}

export default sync;
