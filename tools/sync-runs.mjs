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

let rows;
try {
  const sql = `
    SELECT workout_key, start_time_ms, total_distance_m, total_time_s,
           energy_kj, COALESCE(tss_hr, tss) AS tss
      FROM workouts
     WHERE activity_id IN (${RUN_ACTIVITY_IDS.join(",")})
       AND start_time_ms >= ${sinceMs}
     ORDER BY start_time_ms DESC;`;
  /* Not `-readonly`, deliberately, and this cost a debugging round.
   *
   * debrief's pipeline writes this database, which puts it in WAL mode, and
   * a read-only open of a WAL database fails — SQLite needs to create the
   * `-shm` shared-memory file to read the log, and read-only forbids it:
   *   Error: in prepare, unable to open database file (14)
   *
   * It passes whenever the database happens to be quiescent, which is why an
   * earlier run of this same script worked and the next one didn't. Nothing
   * here issues anything but SELECT; the only files a default open creates
   * are SQLite's own `-shm`/`-wal` housekeeping, never a change to a row. */
  const out = execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8" });
  rows = out.trim() ? JSON.parse(out) : [];
} catch (err) {
  console.error(`Couldn't read ${DB}`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

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

console.log(`${runs.length} run(s) in the last ${DAYS} days from ${DB}`);
if (skipped) console.log(`  ${skipped} skipped for having no energy figure`);
for (const r of runs.slice(0, 5)) {
  console.log(
    `  ${r.ran_on}  ${(r.distance_m / 1000).toFixed(2)} km  ${r.kcal} kcal  tss ${r.tss ?? "—"}`,
  );
}
if (runs.length > 5) console.log(`  … and ${runs.length - 5} more`);

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
if (body.rejected?.length) {
  // loud on purpose: silently dropping half a payload is the failure mode
  // that looks exactly like a clean run
  console.error(`REJECTED ${body.rejected.length}: ${body.rejected.join(", ")}`);
  process.exit(1);
}
