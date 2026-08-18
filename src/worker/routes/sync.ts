import { Hono } from "hono";
import type { SyncRequest, SyncResponse } from "../../shared/api";
import { MAX_WEIGHT_KG, MIN_WEIGHT_KG } from "../../shared/weight";
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

/** How many days a single sync may remove before it is treated as evidence
 *  about the upstream response rather than about the user (#66).
 *
 *  Two, because someone deletes the morning the scale read them holding a
 *  dumbbell — they don't delete a fortnight. The failure this bounds is a
 *  partial or truncated Garmin response, which would otherwise reconcile away
 *  a month of real weigh-ins in one silent pass. */
const MAX_REMOVALS = 2;

/** Ceiling on the caller's own override. Raising the cap is a deliberate act
 *  (`--allow-removals`), but it must not become "delete everything". */
const MAX_REMOVALS_CEILING = 60;

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

  /* Readings the user has already rejected (#71).
   *
   * Loaded once rather than probed per row: the window is 30 days and this is
   * a machine caller running every half hour.
   *
   * Keyed by day AND value, which is what lets a tombstone be permanent
   * without becoming a trap — see migration 0005. Re-sending the rejected
   * number is ignored forever; a corrected re-weigh of the same day is a
   * different value and arrives normally. */
  const tombstoned = new Set(
    weights.length
      ? (
          await db
            .selectFrom("weight_tombstones")
            .select(["measured_on", "weight_kg"])
            .where("user_id", "=", caller.id)
            .execute()
        ).map((t) => `${t.measured_on}@${t.weight_kg}`)
      : [],
  );

  for (const [i, raw] of weights.entries()) {
    const w = validWeight(raw);
    if (!w) {
      rejected.push(`weights[${i}]`);
      continue;
    }

    // not a rejection — nothing was wrong with it; it lost to an explicit
    // decision the user already made, exactly like a typed correction (#68)
    if (tombstoned.has(`${w.measured_on}@${w.weight_kg}`)) {
      suppressed.push(`weights[${i}]`);
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

  /* Reconcile the declared window (#66).
   *
   * Garmin announces a deletion by never mentioning the day again — measured
   * against the live API, not assumed: no tombstone, no flag, the entry simply
   * stops appearing in `dateWeightList`. For one day that is identical to
   * "didn't weigh in". Over a window the caller vouches for, it isn't.
   *
   * Three conditions, each closing a way this could eat real data:
   *   - a window must be declared. No window, no deletion, ever.
   *   - the payload must be non-empty. An empty list is the shape an API
   *     hiccup takes, and it would otherwise mean "delete everything here".
   *   - only `source = 'garmin'` rows. #20's rule is untouched: the scale
   *     still cannot remove a number the user typed, and a manual row inside
   *     the window is invisible to this.
   */
  const removed: string[] = [];
  const removals_refused: string[] = [];
  const window = validWindow(body.weights_window);

  if (window && weights.length) {
    const sent = new Set(weights.map((w) => validWeight(w)?.measured_on).filter(Boolean));

    const stored = await db
      .selectFrom("weights")
      .select("measured_on")
      .where("user_id", "=", caller.id)
      .where("source", "=", "garmin")
      .where("measured_on", ">=", window.from)
      .where("measured_on", "<=", window.to)
      .execute();

    const missing = stored.map((r) => r.measured_on).filter((day) => !sent.has(day));

    if (missing.length > window.max_removals) {
      // Loud and inert: says exactly which days, changes nothing.
      removals_refused.push(...missing);
    } else if (missing.length) {
      await db
        .deleteFrom("weights")
        .where("user_id", "=", caller.id)
        // Redundant with the SELECT above, which is where the protection
        // actually lives — a manual day never reaches `missing` in the first
        // place. Kept anyway: this is a DELETE, and the cost of the belt is
        // one indexed predicate. Verified by experiment that removing the
        // SELECT's copy breaks a test and removing this one does not, so
        // don't mistake this line for the guard.
        .where("source", "=", "garmin")
        .where("measured_on", "in", missing)
        .execute();
      removed.push(...missing);
    }
  }

  // A new weigh-in moves the trend, and the trend is what the target follows
  // (#18). Skipped when only runs arrived: runs never touch the base target —
  // their calories are the earned bonus (#21), which is computed per-day at
  // read time rather than folded in here (build rule 7).
  // Removing a weigh-in moves the trend exactly as arriving does — often more,
  // since the row that gets deleted is usually the bad one that was dragging
  // it. Refreshing only on writes would leave the target computed from a
  // reading that no longer exists (#66).
  const budget = weightsWritten || removed.length ? await refreshTarget(db, caller.id) : null;

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
    removed,
    removals_refused,
    target_kcal: budget?.target_kcal ?? null,
  });
});

/** A window is only usable if it is a real, ordered date range. Anything else
 *  is dropped rather than corrected — a malformed window that got clamped into
 *  a valid one would authorize deletions over days the caller never claimed. */
function validWindow(raw: unknown) {
  const w = raw as Record<string, unknown> | undefined;
  if (!w || typeof w !== "object") return null;

  const from = isDay(w.from);
  const to = isDay(w.to);
  if (!from || !to || from > to) return null;

  const asked = isNum(w.max_removals) ? Math.floor(w.max_removals) : MAX_REMOVALS;
  return {
    from,
    to,
    // the caller may raise the cap deliberately, never below the default and
    // never past the ceiling
    max_removals: Math.min(Math.max(asked, MAX_REMOVALS), MAX_REMOVALS_CEILING),
  };
}

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
  // Same sanity bounds as manual entry: catches a slipped decimal or a
  // pounds-shaped number, both of which move the target hundreds of kcal.
  // Read from `shared/weight` since #99 — this was the fourth place stating
  // them, and it was found by fixing the other three.
  const weight_kg =
    isNum(w.weight_kg) && w.weight_kg >= MIN_WEIGHT_KG && w.weight_kg <= MAX_WEIGHT_KG
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
