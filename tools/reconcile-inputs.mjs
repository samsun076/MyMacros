#!/usr/bin/env node
/**
 * Dump the inputs a build-rule-4b reconciliation needs, and never the answer (#83).
 *
 *   node tools/reconcile-inputs.mjs --date 2026-08-10 --weeks 1
 *   node tools/reconcile-inputs.mjs --weeks 4 --local
 *
 * Prints a markdown block ready to paste into RECONCILIATIONS.md.
 *
 * ── THE ONE RULE ──────────────────────────────────────────────────────────
 *
 * **This file must never print a computed figure.** No BMR, no TDEE, no
 * target, no trend weight, no earned bonus, no realized deficit, not even an
 * age derived from a birth date.
 *
 * That is not fussiness. RECONCILIATIONS.md's header is the constraint:
 * "Recompute independently; importing computeBudget to check computeBudget
 * proves nothing." A tool that prints the answer beside the inputs destroys
 * the check outright, because the reconciler reads the answer first and then
 * confirms it. That is not a reconciliation; it is the app agreeing with
 * itself in a file that claims otherwise.
 *
 * So `profiles.target_kcal` is not merely unprinted — it is not SELECTed.
 * A column that never arrives cannot be leaked by a later edit to the
 * renderer. `tools/reconcile-inputs.test.mjs` fails if any of the five
 * forbidden words reaches the output, or if any figure a reconciler would
 * derive from the fixture appears in it.
 *
 * **If you are here to add "helpfully, here's what the app thinks it should
 * be" — that is the change this comment exists to stop.** Rule 4b dies the
 * day it lands, and the file becomes a log of the app agreeing with itself.
 *
 * ── What this buys, and what it deliberately doesn't ──────────────────────
 *
 * Rule 4b costs 45–90 minutes and about half of that was writing these same
 * five queries again. Clearing the SQL does not replace the judgment — it
 * stops the mechanical half from competing with the thinking half for the
 * same hour, which it always won, because it is the part you know how to
 * finish.
 *
 * What actually found #74 was not arithmetic. It was noticing that a day's
 * intake of 77 kcal was a *whole logged day*, next to a "6/7 DAYS" label that
 * read as good coverage. No script finds that. The one concession made here
 * is printing the ROW COUNT beside each day's totals, so that a one-row day
 * is visible as a one-row day rather than as a small number.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DB = "mymacros-db";

/** The five words a derived figure would have to be labelled with. The test
 *  greps the rendered output for these; keeping the list here rather than in
 *  the test is deliberate, so the rule is legible at the place it binds. */
export const FORBIDDEN_LABELS = ["bmr", "tdee", "target", "trend", "earned"];

// ── data ────────────────────────────────────────────────────────────────────

/** Columns pulled from `profiles`.
 *
 *  `target_kcal` is absent on purpose and must stay absent: it is the answer
 *  to the commonest 4b question, and since #85 it is a write-only cache that
 *  is stale by however long since the last write — so printing it would be
 *  both a spoiler and a wrong one. */
const PROFILE_COLUMNS = [
  "sex",
  "birth_date",
  "height_cm",
  "activity_level",
  "goal",
  "deficit_kcal",
  "athlete_profile",
  "eat_back_pct",
  "protein_g_per_kg",
  "carb_ratio_pct",
  "focus_macro",
  "start_weight_kg",
  "goal_weight_kg",
  "units",
  "timezone",
  "updated_at",
];

export function queries({ from, to, trendFrom }) {
  return {
    profile: `SELECT ${PROFILE_COLUMNS.join(", ")} FROM profiles`,

    // Reaches back past the window: a 7-day trend on its FIRST day is
    // computed from the six days before it, so a pull that starts at `from`
    // silently hides half of what the earliest target was built on.
    weights:
      `SELECT measured_on, weight_kg, body_fat_pct, source FROM weights` +
      ` WHERE measured_on BETWEEN '${trendFrom}' AND '${to}' ORDER BY measured_on`,

    // Per-day sums of rows, plus the row count — see the #74 note above.
    days:
      `SELECT logged_on, COUNT(*) AS rows_n, SUM(kcal) AS kcal,` +
      ` ROUND(SUM(protein_g), 1) AS protein_g, ROUND(SUM(carbs_g), 1) AS carbs_g,` +
      ` ROUND(SUM(fat_g), 1) AS fat_g, SUM(edited) AS edited_n` +
      ` FROM food_logs WHERE logged_on BETWEEN '${from}' AND '${to}'` +
      ` GROUP BY logged_on ORDER BY logged_on`,

    runs:
      `SELECT ran_on, distance_m, duration_s, kcal, tss, source FROM runs` +
      ` WHERE ran_on BETWEEN '${from}' AND '${to}' ORDER BY ran_on`,

    // Cheap, and it stops sparse data being read as real: the M5 entry used
    // this to rule out #62's silent sync failures before drawing conclusions.
    sources: `SELECT source, last_success_at, last_item_count FROM sync_sources ORDER BY source`,
  };
}

/** One `wrangler d1 execute`. Read-only by construction — every query above
 *  is a SELECT — but nothing here enforces that, so don't add a writer.
 *
 *  **The remote API 7403s intermittently on a perfectly good session.**
 *  Observed on the first run of this tool: `code: 7403, "The given account is
 *  not valid or is not authorized to access this service"`, with the identical
 *  query succeeding by hand seconds later and on every attempt since. So it is
 *  retried once rather than reported as an auth problem, because "you are not
 *  authorized" sends you off to check credentials that were never wrong. */
export function d1(sql, { local = false, attempts = 2 } = {}) {
  const args = ["wrangler", "d1", "execute", DB, "--json", "--command", sql];
  args.push(local ? "--local" : "--remote");

  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync("npx", args, {
        encoding: "utf8",
        // wrangler's banner goes to stderr; --json puts the payload on stdout
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 32 * 1024 * 1024,
      });
      return JSON.parse(out)[0]?.results ?? [];
    } catch (err) {
      // wrangler reports API failures as JSON on stdout with a non-zero exit
      const detail = wranglerError(err) ?? String(err.message ?? err).split("\n")[0];
      if (attempt >= attempts) {
        throw new Error(`wrangler d1 execute failed after ${attempt} attempt(s): ${detail}`);
      }
      process.stderr.write(`  ${detail} — retrying\n`);
    }
  }
}

function wranglerError(err) {
  try {
    const body = JSON.parse(String(err.stdout ?? ""));
    const notes = (body.error?.notes ?? []).map((n) => n.text).join("; ");
    return [body.error?.text, notes].filter(Boolean).join(" ") || null;
  } catch {
    return null;
  }
}

// ── rendering ───────────────────────────────────────────────────────────────

const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

function table(columns, rows) {
  const head = `| ${columns.join(" | ")} |`;
  const rule = `|${columns.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${columns.map((c) => dash(r[c])).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

/** "3 rows" / "no rows" — never an empty section.
 *
 *  Same principle as #69's sync heartbeat: nothing-to-report and
 *  failed-to-report must not look identical. A window that came back short is
 *  a fact about the pull, and it belongs on the page as a number. */
const count = (rows, noun = "row") =>
  rows.length === 0 ? `**no ${noun}s**` : `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}`;

/** The paste-ready block. Pure — takes data, returns a string, touches
 *  nothing — which is what lets the test assert on its whole output. */
export function render({ date, weeks, from, to, trendFrom, profile, weights, days, runs, sources, local = false }) {
  const p = profile ?? {};
  const spanDays = weeks * 7;

  // Never claims production when it came from a dev database — a paste-ready
  // block carries its own provenance into a file that will outlive the run.
  const where = local ? "LOCAL D1 — not production" : "production D1";

  return `**Inputs, pulled from ${where}** — ${from} … ${to} (${weeks} week${weeks === 1 ? "" : "s"}), generated by:

\`\`\`
node tools/reconcile-inputs.mjs --date ${date} --weeks ${weeks}${local ? " --local" : ""}
\`\`\`

*Inputs only, by design (#83) — nothing below is computed, so that recomputing
by hand stays an independent check rather than a second opinion from the same
source.*

**profiles** — ${profile ? "1 row" : "**no row**"}

${
  profile
    ? table(["column", "value"], PROFILE_COLUMNS.map((c) => ({ column: `\`${c}\``, value: dash(p[c]) })))
    : "_No profile row. Everything else below is uninterpretable until that is explained._"
}

**weights** — ${count(weights)}, ${trendFrom} … ${to} (the window plus the six days before it, which the earliest day's 7-day smoothing reads)

${weights.length ? table(["measured_on", "weight_kg", "body_fat_pct", "source"], weights) : "_None in range._"}

**food_logs, by day** — ${count(days, "logged day")} of ${spanDays}

${days.length ? table(["logged_on", "rows_n", "kcal", "protein_g", "carbs_g", "fat_g", "edited_n"], days) : "_None in range._"}

**runs** — ${count(runs)}

${runs.length ? table(["ran_on", "distance_m", "duration_s", "kcal", "tss", "source"], runs) : "_None in range._"}

**sync_sources** — ${count(sources)}

${sources.length ? table(["source", "last_success_at", "last_item_count"], sources) : "_None. A feed that never reported cannot be told from one that died (#69)._"}
`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/** `--date` is the window's LAST day, inclusive, and `--weeks × 7` days end
 *  on it. Both ends are printed in the output so the range is never inferred
 *  from the flags. */
export function windowFor(date, weeks) {
  const shift = (d, byDays) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + byDays);
    return t.toISOString().slice(0, 10);
  };
  return { from: shift(date, -(weeks * 7 - 1)), to: date, trendFrom: shift(date, -(weeks * 7 + 5)) };
}

function parseArgs(argv) {
  const opts = { date: new Date().toISOString().slice(0, 10), weeks: 1, local: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date") opts.date = argv[++i];
    else if (argv[i] === "--weeks") opts.weeks = Number(argv[++i]);
    else if (argv[i] === "--local") opts.local = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  // Also the injection guard: both values are interpolated into SQL below.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error(`--date must be YYYY-MM-DD, got ${opts.date}`);
  if (!Number.isInteger(opts.weeks) || opts.weeks < 1 || opts.weeks > 52) {
    throw new Error(`--weeks must be a whole number 1–52, got ${opts.weeks}`);
  }
  return opts;
}

function main() {
  const { date, weeks, local } = parseArgs(process.argv.slice(2));
  const span = windowFor(date, weeks);
  const q = queries(span);

  process.stderr.write(`reading ${local ? "LOCAL" : "production"} D1 — ${span.from} … ${span.to}\n`);
  const rows = Object.fromEntries(
    Object.entries(q).map(([key, sql]) => [key, d1(sql, { local })]),
  );

  process.stdout.write(
    render({
      date,
      weeks,
      local,
      ...span,
      profile: rows.profile[0] ?? null,
      weights: rows.weights,
      days: rows.days,
      runs: rows.runs,
      sources: rows.sources,
    }),
  );

  if (rows.profile.length > 1) {
    process.stderr.write(
      `\n${rows.profile.length} profile rows — this deployment has more than one user, and the block above shows only the first.\n`,
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (err) {
    // A tool run once a milestone should fail in one legible line, not in a
    // stack trace that buries wrangler's own message forty lines down.
    process.stderr.write(`\n${err.message}\n`);
    process.exit(1);
  }
}
