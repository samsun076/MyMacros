#!/usr/bin/env node
/**
 * Push recent runs from debrief's runs.db into MyMacros (#19).
 *
 *   MYMACROS_SYNC_TOKEN=mms_… node tools/sync-runs.mjs
 *   node tools/sync-runs.mjs --days 90 --dry-run
 *
 * Runs on Dave's Mac beside debrief's own launchd job. It reads that
 * pipeline's SQLite directly rather than adding an export step — the file is
 * already there, already current, and already the thing debrief treats as
 * canonical.
 *
 * ── Conventions borrowed from debrief, not re-derived ──────────────────────
 *
 * **Runs are activity_id 1 and 53.** From `pipeline/src/weekly.js`, which
 * defines `RUN_ACTIVITY_IDS = [1, 53]`. The database holds cycling, hiking,
 * gym work and more; syncing all of it would put a 3-hour hike's calories
 * into a screen that says "your runs".
 *
 * **TSS is COALESCE(tss_hr, tss).** Also from weekly.js, whose comment is
 * blunt about why: raw `tss` changes calculation method across history and
 * "must never be aggregated". `tss_hr` is one method all the way back.
 *
 * ── The unit trap ─────────────────────────────────────────────────────────
 *
 * **`energy_kj` holds KILOCALORIES, despite its name.** It is populated from
 * Suunto's `energyConsumption` (pipeline/src/extract.js), and that field is
 * kcal. Checked rather than assumed: across recent runs the values land at
 * 56–63 kcal/km, exactly right for an ~80 kg runner. Read as kilojoules they
 * would be ~14 kcal/km, which no human achieves.
 *
 * So there is NO 4.184 conversion here. Dividing would understate every run
 * by 76%, and because eat-back (#21) hands back a share of these calories,
 * the visible symptom would be a bonus that is merely small — not a number
 * that looks broken.
 *
 * ── launchd ───────────────────────────────────────────────────────────────
 *
 * Idempotent by design: the endpoint upserts on (user_id, external_id), so
 * running this every 30 minutes forever is safe and re-sending a revised TSS
 * updates the row. Add it beside debrief's existing job, e.g.
 * ~/Library/LaunchAgents/run.debrief.mymacros-sync.plist with
 * StartInterval 1800, and put the token in the plist's EnvironmentVariables
 * (or have the job read it from Doppler). Never commit the token.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/** From debrief's pipeline/src/weekly.js. */
const RUN_ACTIVITY_IDS = [1, 53];

/** Floor for the batch's median kcal/km, below which this refuses to push
 *  (#63).
 *
 *  A tripwire for the unit trap above, not a physiological constant. The whole
 *  reason it is a MEDIAN over the batch rather than a bound on each run: a
 *  unit change upstream moves every value at once, while a single dropped HR
 *  strap moves one. Per-run bounds cannot tell those apart — see #64.
 *
 *  Derived from debrief's own history rather than picked: across 179 rolling
 *  30-day windows and 629 runs, the window median ranges 55.9–88.6 kcal/km.
 *  Read as kilojoules the same windows would land at 13.4–21.2. 35 sits in the
 *  empty middle, a factor of 1.6 clear of both edges.
 *
 *  That margin has to absorb real drift, and there is some: 2022 windows median
 *  ~88, 2026 windows ~56, as a runner gets more efficient. The floor leaves
 *  room for the median to fall another 37% before it cries wolf. If it ever
 *  does fire on honest data, the fix is to re-derive it from the history — not
 *  to delete it. */
const MIN_MEDIAN_KCAL_PER_KM = 35;

/** Below this many runs a median means nothing, so the guard steps aside and
 *  says so rather than pretending to have checked. */
const MIN_SAMPLE_FOR_GUARD = 3;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const DB = flag("db", join(homedir(), "Projects/debrief/pipeline/data/runs.db"));
const DAYS = Number(flag("days", "30"));
const API = (process.env.MYMACROS_API ?? "https://fuel.debrief.run").replace(/\/$/, "");
const TOKEN = process.env.MYMACROS_SYNC_TOKEN;
const DRY = has("dry-run");

if (!DRY && !TOKEN) {
  console.error("MYMACROS_SYNC_TOKEN is not set. Issue one in Settings → Sync.");
  process.exit(2);
}
if (!Number.isFinite(DAYS) || DAYS <= 0) {
  console.error(`--days must be a positive number, got ${flag("days", "30")}`);
  process.exit(2);
}

const sinceMs = Date.now() - DAYS * 86400_000;

/* `ran_on` is a day in the user's life, so it is the LOCAL date of the start
 * instant — not `toISOString().slice(0,10)`, which would file an evening run
 * under tomorrow for anyone west of UTC. This script runs on the user's own
 * machine, so the machine's timezone IS the user's (#44). */
const localDay = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/* Not `-readonly`, deliberately, and this cost a debugging round.
 *
 * debrief's pipeline writes this database, which puts it in WAL mode, and a
 * read-only open of a WAL database fails — SQLite needs to create the `-shm`
 * shared-memory file to read the log, and read-only forbids it:
 *   Error: in prepare, unable to open database file (14)
 *
 * It passes whenever the database happens to be quiescent, which is why an
 * earlier run of this same script worked and the next one didn't. Nothing here
 * issues anything but SELECT; the only files a default open creates are
 * SQLite's own `-shm`/`-wal` housekeeping, never a change to a row. */
const query = (sql) => {
  try {
    const out = execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8" });
    return out.trim() ? JSON.parse(out) : [];
  } catch (err) {
    console.error(`Couldn't read ${DB}`);
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
};

const rows = query(`
  SELECT workout_key, start_time_ms, total_distance_m, total_time_s,
         energy_kj, COALESCE(tss_hr, tss) AS tss
    FROM workouts
   WHERE activity_id IN (${RUN_ACTIVITY_IDS.join(",")})
     AND start_time_ms >= ${sinceMs}
   ORDER BY start_time_ms DESC;`);

/* The denominator (#65).
 *
 * `RUN_ACTIVITY_IDS` is copied from debrief rather than imported — MyMacros
 * reads that database as an outside consumer and coupling the repos would be
 * worse. But a copied constant drifts, and the symptom of drift is zero rows,
 * which is indistinguishable from a quiet fortnight. debrief's database holds
 * 14 distinct activity ids; if Suunto ever files runs under a new one, this
 * script matches nothing and every screen downstream stays plausible.
 *
 * So report the ratio, never either number alone: 0-of-0 is a rest week,
 * 0-of-12 is a broken filter. */
const activityMix = query(`
  SELECT activity_id, COUNT(*) AS n
    FROM workouts
   WHERE start_time_ms >= ${sinceMs}
   GROUP BY activity_id
   ORDER BY n DESC;`);
const workoutsInWindow = activityMix.reduce((t, a) => t + a.n, 0);

const runs = rows
  .map((r) => ({
    external_id: r.workout_key,
    ran_on: localDay(r.start_time_ms),
    started_at: new Date(r.start_time_ms).toISOString(),
    distance_m: r.total_distance_m ?? 0,
    duration_s: r.total_time_s == null ? null : Math.round(r.total_time_s),
    // NOT divided by 4.184 — see the unit note above
    kcal: r.energy_kj == null ? null : Math.round(r.energy_kj),
    tss: r.tss ?? null,
  }))
  // a run with no calorie figure has nothing to contribute to a calorie
  // budget, and the endpoint would reject it anyway
  .filter((r) => r.kcal !== null);

const skipped = rows.length - runs.length;

console.log(
  `${runs.length} run(s) matched of ${workoutsInWindow} workout(s) ` +
    `in the last ${DAYS} days from ${DB}`,
);
if (skipped) console.log(`  ${skipped} skipped for having no energy figure`);
for (const r of runs.slice(0, 5)) {
  console.log(
    `  ${r.ran_on}  ${(r.distance_m / 1000).toFixed(2)} km  ${r.kcal} kcal  tss ${r.tss ?? "—"}`,
  );
}
if (runs.length > 5) console.log(`  … and ${runs.length - 5} more`);

/* Suspicion, not proof — so it warns rather than exits (#65). A month of
 * cycling through an injury looks exactly like this and is entirely honest.
 * The activity mix is printed because it is the thing that answers the
 * question: if runs are now being filed under an id we don't match, it is
 * sitting right there in the list. */
if (!runs.length && workoutsInWindow > 0) {
  const mix = activityMix.map((a) => `${a.activity_id}×${a.n}`).join(" ");
  console.warn(
    `\nWARNING: 0 runs matched, but ${workoutsInWindow} workout(s) are in the window.\n` +
      `  Looking for activity_id ${RUN_ACTIVITY_IDS.join(" or ")}; the window holds: ${mix}\n` +
      `  If debrief has re-filed runs under another id, RUN_ACTIVITY_IDS here is stale.`,
  );
}

/* The unit tripwire (#63). Runs before the push, so a corrupted batch is never
 * sent — an upsert would overwrite good stored values with bad ones, and the
 * rolling window means the next run would do it again. */
if (runs.length >= MIN_SAMPLE_FOR_GUARD) {
  const perKm = runs
    .filter((r) => r.distance_m > 0)
    .map((r) => r.kcal / (r.distance_m / 1000))
    .sort((a, b) => a - b);
  const mid = perKm.length >> 1;
  const median = perKm.length % 2 ? perKm[mid] : (perKm[mid - 1] + perKm[mid]) / 2;

  if (perKm.length && median < MIN_MEDIAN_KCAL_PER_KM) {
    console.error(
      `\nREFUSING TO SYNC: median ${median.toFixed(1)} kcal/km is below ${MIN_MEDIAN_KCAL_PER_KM}.\n` +
        `  Every honest 30-day window in debrief's history sits at 56-89 kcal/km.\n` +
        `  ${(median * 4.184).toFixed(1)} would be normal — which is what this batch\n` +
        `  looks like if energy_kj has started holding actual kilojoules.\n` +
        `  Nothing was sent. See tools/sync-runs.mjs (#63) before overriding.`,
    );
    process.exit(1);
  }
  console.log(`  median ${median.toFixed(1)} kcal/km`);
} else if (runs.length) {
  console.log(`  (fewer than ${MIN_SAMPLE_FOR_GUARD} runs — median unit check skipped)`);
}

if (DRY) {
  console.log("\n--dry-run: nothing sent.");
  process.exit(0);
}
if (!runs.length) {
  console.log("Nothing to send.");
  process.exit(0);
}

const res = await fetch(`${API}/api/sync`, {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ runs }),
});

const body = await res.json().catch(() => null);
if (!res.ok) {
  // the token never reaches the log; a 401 here means "reissue it in Settings"
  console.error(`\nsync failed: ${res.status} ${JSON.stringify(body)}`);
  process.exit(1);
}

console.log(`\nsynced ${body.runs} run(s)`);
// runs upsert unconditionally, so this should always be empty — which is
// exactly why it is worth printing if it ever isn't (#68)
if (body.suppressed?.length) {
  console.log(`  ${body.suppressed.length} left alone: ${body.suppressed.join(", ")}`);
}
if (body.rejected?.length) {
  // loud on purpose: silently dropping half a payload is the failure mode
  // that looks exactly like a clean run
  console.error(`REJECTED ${body.rejected.length}: ${body.rejected.join(", ")}`);
  process.exit(1);
}
