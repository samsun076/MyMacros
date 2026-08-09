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

  /* PRESENT, not non-empty (#69).
   *
   * The heartbeat below records that a feed checked in, and the difference
   * between `{"runs": []}` and a payload with no `runs` key at all is the
   * whole signal: the first is a collector reporting a quiet week, the second
   * is a caller that doesn't speak for runs. Collapsing them would make a rest
   * week indistinguishable from a dead sync — which is the bug this issue
   * exists to fix, reintroduced one layer down. */
  const hasRuns = Array.isArray(body.runs);
  const hasWeights = Array.isArray(body.weights);
  const runs = hasRuns ? (body.runs ?? []) : [];
  const weights = hasWeights ? (body.weights ?? []) : [];
  if (runs.length > MAX_ITEMS || weights.length > MAX_ITEMS) {
    return c.json({ error: "too_many_items", max: MAX_ITEMS }, 413);
  }

  const rejected: string[] = [];
  /** Valid, but deliberately not written — today only the weigh-in a user has
   *  typed over. Not a rejection: nothing was wrong with it. See below. */
  const suppressed: string[] = [];
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
    const written = await db
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
      // Only ever overwrites a row the scale itself wrote.
      //
      // Without the WHERE, a manual weigh-in and the scale fight over the same
      // day and the scale always wins — not because it is more trusted, but
      // because it runs every 30 minutes forever. Measured in production: a
      // typed correction was reverted four minutes later and the target moved
      // with it. Someone who opens the app and types a number is correcting
      // something, and a correction that silently expires is worse than no
      // correction at all. `source` here is the stored row's, not the incoming
      // one (SQLite reads unqualified names in DO UPDATE from the existing
      // row), so a scale reading still updates a scale reading.
      .onConflict((oc) =>
        oc
          .columns(["user_id", "measured_on"])
          .doUpdateSet({
            weight_kg: w.weight_kg,
            body_fat_pct: w.body_fat_pct,
            source: "garmin",
          })
          .where("source", "=", "garmin"),
      )
      .executeTakeFirst();

    /* The WHERE above can decline the write, and until #68 the counter didn't
     * know — it incremented regardless, so a day the user had corrected was
     * reported as synced. That is the same failure `rejected` exists to
     * prevent, one field over, and in the single line the launchd log relies
     * on for evidence.
     *
     * SQLite reports 0 changes when an upsert neither inserts nor updates, so
     * the row count is the honest signal. Undefined counts as written: a
     * dialect that stops reporting it should degrade to the old behaviour, not
     * silently start claiming every write was suppressed. */
    if (Number(written?.numInsertedOrUpdatedRows ?? 1) === 0) {
      suppressed.push(`weights[${i}]`);
      continue;
    }
    weightsWritten++;
  }

  // A new weigh-in moves the trend, and the trend is what the target follows
  // (#18). Skipped when only runs arrived: runs never touch the base target —
  // their calories are the earned bonus (#21), which is computed per-day at
  // read time rather than folded in here (build rule 7).
  const budget = weightsWritten ? await refreshTarget(db, caller.id) : null;

  /* The heartbeat (#69).
   *
   * Stamped on the ATTEMPT, not on rows written — a collector that checked in
   * and found nothing new is healthy, and the commonest reason for an empty
   * runs payload is a rest day. Keying this on rows would mark the feed dead
   * every time it worked perfectly and had nothing to say.
   *
   * Rejections don't count as success either way: a payload that arrived and
   * was wholly invalid still proves the collector is running and can reach us,
   * which is the only thing this timestamp claims. */
  const now = new Date().toISOString();
  for (const [source, present, count] of [
    ["runs", hasRuns, runsWritten],
    ["weights", hasWeights, weightsWritten],
  ] as const) {
    if (!present) continue;
    await db
      .insertInto("sync_sources")
      .values({ user_id: caller.id, source, last_success_at: now, last_item_count: count })
      .onConflict((oc) =>
        oc
          .columns(["user_id", "source"])
          .doUpdateSet({ last_success_at: now, last_item_count: count }),
      )
      .execute();
  }

  await markSyncTokenUsed(db, caller.token_id);

  return c.json<SyncResponse>({
    runs: runsWritten,
    weights: weightsWritten,
    // named, so a script that silently drops half its payload is visible in
    // the launchd log rather than looking like a clean run
    rejected,
    suppressed,
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
