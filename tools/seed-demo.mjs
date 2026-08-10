#!/usr/bin/env node
/**
 * Seed a day of demo food logs into the LOCAL D1.
 *
 *   node tools/seed-demo.mjs                # today
 *   node tools/seed-demo.mjs 2026-08-06     # a specific day
 *   node tools/seed-demo.mjs --weeks 12     # a window of history, for #22
 *
 * Why this exists: a fresh clone signs in to an empty Today screen — an empty
 * ring, an empty timeline — which is a bad first impression and a useless
 * thing to screenshot. This fills one day with a plausible morning so the
 * screen has something to draw, and so `tools/screencast.mjs` starts from a
 * deterministic frame.
 *
 * `--weeks N` is the same argument one screen further out: the trends screen
 * (#22) draws weeks, so a one-day seed leaves every screenshot of it showing
 * the empty state. See seedWindow() at the bottom for what it fabricates and
 * why each irregularity in it is deliberate.
 *
 * It writes through `wrangler d1 execute --local` rather than opening the
 * sqlite file directly, and that is deliberate. Several sqlite files live
 * under .wrangler/state/v3/d1 — miniflare names each after the `database_id`
 * in wrangler.jsonc, so every time that id has changed a new one appeared and
 * the old one stayed on disk. Picking one with `find | head -1` (as
 * `npm run db:studio` does) can therefore land on an abandoned database that
 * looks plausible and is two migrations behind. Going through wrangler means
 * the config picks the file, which is the only thing that agrees with what the
 * running app reads.
 *
 * Dinner is deliberately left unlogged: it's the meal the recorded demo
 * photographs, so the timeline visibly gains a row and the budget meter
 * visibly moves.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The LOCAL date, not `toISOString().slice(0,10)`. `food_logs.logged_on` is
 *  "a day in the user's life" — local text — and the client is what owns it
 *  (#44). Using UTC here seeds tomorrow every evening after 8pm Eastern, which
 *  is a day the Today screen will never ask for. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const args = process.argv.slice(2);
const weeksFlag = args.indexOf("--weeks");
const WEEKS = weeksFlag === -1 ? 0 : Number(args[weeksFlag + 1]);
const DAY = args.filter((a, i) => !a.startsWith("--") && i !== weeksFlag + 1)[0] ?? localToday();

if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) {
  console.error(`Not a YYYY-MM-DD date: ${DAY}`);
  process.exit(1);
}
if (weeksFlag !== -1 && !(WEEKS > 0 && WEEKS <= 52)) {
  console.error(`--weeks wants 1-52, got: ${args[weeksFlag + 1]}`);
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const run = (sql) => {
  const file = join(mkdtempSync(join(tmpdir(), "seed-demo-")), "seed.sql");
  writeFileSync(file, sql);
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "mymacros-db", "--local", "--file", file, "--yes"],
    { stdio: "inherit" },
  );
};

if (WEEKS) {
  seedWindow(WEEKS);
  process.exit(0);
}

/** America/New_York is UTC-4 in August; the profile's timezone is the source
 *  of truth for `logged_on`, and `logged_at` is the UTC instant beside it. */
const utc = (localHour, localMin) =>
  `${DAY}T${String(localHour + 4).padStart(2, "0")}:${String(localMin).padStart(2, "0")}:00.000Z`;

const MEALS = [
  {
    slot: "breakfast",
    at: utc(7, 40),
    name: "Greek yogurt with blueberries",
    kcal: 230,
    protein: 20,
    carbs: 26,
    fat: 4,
    source: "text",
    confidence: 0.88,
  },
  {
    slot: "breakfast",
    at: utc(7, 41),
    name: "Granola",
    kcal: 180,
    protein: 4,
    carbs: 28,
    fat: 6,
    source: "text",
    confidence: 0.75,
  },
  {
    slot: "lunch",
    at: utc(12, 50),
    name: "Chipotle chicken bowl, no rice, extra beans",
    kcal: 620,
    protein: 58,
    carbs: 40,
    fat: 23,
    source: "text",
    confidence: 0.65,
  },
];

// One user locally (the dev email/password account). Resolved rather than
// hardcoded so this survives a database reset.
const sql = [
  "DELETE FROM food_logs WHERE logged_on = " + q(DAY) + ";",
  "UPDATE profiles SET target_kcal = 1810;",
  ...MEALS.map(
    (m, i) =>
      `INSERT INTO food_logs (id, user_id, logged_on, logged_at, meal_slot, name, kcal, protein_g, carbs_g, fat_g, source, confidence, edited)
       SELECT ${q(`demo-${DAY}-${i}`)}, id, ${q(DAY)}, ${q(m.at)}, ${q(m.slot)}, ${q(m.name)},
              ${m.kcal}, ${m.protein}, ${m.carbs}, ${m.fat}, ${q(m.source)}, ${m.confidence}, 0
       FROM users ORDER BY createdAt LIMIT 1;`,
  ),
].join("\n");

run(sql);

const eaten = MEALS.reduce((n, m) => n + m.kcal, 0);
console.log(`\nSeeded ${MEALS.length} logs on ${DAY} — ${eaten} kcal of 1810, dinner left open.`);

/* ── the trends window (#22) ──────────────────────────────────────────────
 *
 * The trends screen needs *weeks*, and the one-day seed above leaves every
 * PNG of it showing the empty state — which is how a screen ships looking
 * fine and reading as a placeholder. This fills a real window.
 *
 * Everything is deterministic: no Math.random, so re-running produces byte-
 * identical data and a screenshot diff means the code changed. `noise` is the
 * usual sin/fract hash, seeded off the day index.
 *
 * Three things are seeded ON PURPOSE rather than smoothly:
 *
 *  - **Unlogged days.** One or two a week, and one deliberately sparse week.
 *    They are the whole reason the screen averages over `logged_days`, and a
 *    demo where every day is logged never exercises that.
 *  - **A nine-day gap in weigh-ins**, five weeks back, so the trend line's
 *    segment break is visible instead of theoretical.
 *  - **The two rates disagreeing.** Intake and runs are set so the energy
 *    model predicts roughly twice the loss the scale actually shows. That is
 *    not a flaw in the fixture; it is the realistic case, and it is the
 *    reason the screen shows both numbers instead of one.
 */
function seedWindow(weeks) {
  const shift = (day, delta) => {
    const [y, m, d] = day.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + delta));
    const p = (n) => String(n).padStart(2, "0");
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
  };
  const dow = (day) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };
  const noise = (n) => {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  const monday = shift(DAY, -((dow(DAY) + 6) % 7));
  const from = shift(monday, -7 * (weeks - 1));
  const total = Math.round((Date.parse(DAY) - Date.parse(from)) / 86_400_000);
  const days = Array.from({ length: total + 1 }, (_, n) => shift(from, n));

  // ~0.25 kg/week off the scale — what actually happens, not what the model
  // predicts. 82.6 down to about 79.6 across twelve weeks.
  const trueWeight = (n) => 82.6 - (n / 7) * 0.25;

  const weighIns = [];
  const meals = [];
  const runs = [];

  days.forEach((day, n) => {
    const gap = n >= total - 40 && n < total - 31; // the nine-day silence

    // day-to-day water swing of ±0.6 kg on top of the real trend: the noise
    // the 7-day smoothing exists to see through
    if (!gap && noise(n) > 0.12) {
      weighIns.push({ day, kg: Math.round((trueWeight(n) + (noise(n * 3) - 0.5) * 1.2) * 10) / 10 });
    }

    // one sparse week, five weeks back, plus a scattering of missed days
    const sparseWeek = n >= total - 34 && n < total - 27;
    const logged = sparseWeek ? noise(n * 7) > 0.6 : noise(n * 5) > 0.16;
    if (logged) {
      /* Roughly one day in eight is logged and then abandoned — a breakfast
       * and nothing after it. Deliberate: these are what #74's threshold
       * exists to set aside, and a fixture where every logged day is complete
       * never renders the PARTIAL label at all. Well under 60% of a ~2,210
       * target, so they land on the right side of the rule without sitting on
       * the boundary. */
      const abandoned = noise(n * 29) > 0.87;
      const dayKcal = abandoned
        ? Math.round(420 + noise(n * 31) * 460)
        : Math.round(2320 + (noise(n * 11) - 0.4) * 620);
      meals.push({ day, kcal: dayKcal });
    }

    // Mon / Wed / Fri / Sun, the way a marathon block actually falls
    if ([1, 3, 5, 0].includes(dow(day)) && noise(n * 13) > 0.2) {
      runs.push({
        day,
        kcal: Math.round(430 + noise(n * 17) * 520),
        distance_m: Math.round(7000 + noise(n * 19) * 9000),
        duration_s: Math.round(2400 + noise(n * 23) * 2600),
      });
    }
  });

  const SPLIT = [
    { slot: "breakfast", share: 0.24, hour: 7, name: "Oats, whey and banana" },
    { slot: "lunch", share: 0.34, hour: 12, name: "Chicken, rice and greens" },
    { slot: "dinner", share: 0.42, hour: 19, name: "Salmon, potatoes, salad" },
  ];
  const at = (day, hour) => `${day}T${String(hour + 4).padStart(2, "0")}:10:00.000Z`;

  const sql = [
    // only ever removes what this script wrote — real synced rows are keyed by
    // uuid and are untouched
    "DELETE FROM food_logs WHERE id LIKE 'demo-w-%';",
    "DELETE FROM weights WHERE id LIKE 'demo-w-%';",
    "DELETE FROM runs WHERE id LIKE 'demo-w-%';",
    // the budget engine needs its Mifflin-St Jeor inputs or every deficit on
    // the screen is null. COALESCE so a profile you've already set up locally
    // keeps its own numbers.
    `UPDATE profiles SET
       sex = COALESCE(sex, 'male'),
       birth_date = COALESCE(birth_date, '1990-01-01'),
       height_cm = COALESCE(height_cm, 180),
       goal_weight_kg = COALESCE(goal_weight_kg, 77.0),
       activity_level = 'moderate', goal = 'cut', deficit_kcal = 500, eat_back_pct = 50;`,

    ...weighIns.map(
      (w) => `INSERT INTO weights (id, user_id, measured_on, weight_kg, source)
       SELECT ${q(`demo-w-wt-${w.day}`)}, id, ${q(w.day)}, ${w.kg}, 'garmin'
       FROM users ORDER BY createdAt LIMIT 1;`,
    ),

    ...runs.map(
      (r) => `INSERT INTO runs (id, user_id, ran_on, started_at, distance_m, duration_s, kcal, source, external_id)
       SELECT ${q(`demo-w-run-${r.day}`)}, id, ${q(r.day)}, ${q(at(r.day, 6))}, ${r.distance_m}, ${r.duration_s}, ${r.kcal}, 'debrief', ${q(`demo-w-${r.day}`)}
       FROM users ORDER BY createdAt LIMIT 1;`,
    ),

    ...meals.flatMap((m) =>
      SPLIT.map(
        (s) => `INSERT INTO food_logs (id, user_id, logged_on, logged_at, meal_slot, name, kcal, protein_g, carbs_g, fat_g, source, confidence, edited)
       SELECT ${q(`demo-w-${m.day}-${s.slot}`)}, id, ${q(m.day)}, ${q(at(m.day, s.hour))}, ${q(s.slot)}, ${q(s.name)},
              ${Math.round(m.kcal * s.share)}, ${Math.round((m.kcal * s.share * 0.32) / 4)}, ${Math.round((m.kcal * s.share * 0.4) / 4)}, ${Math.round((m.kcal * s.share * 0.28) / 9)},
              'text', 0.8, 0
       FROM users ORDER BY createdAt LIMIT 1;`,
      ),
    ),
  ].join("\n");

  run(sql);

  const meanIntake = Math.round(meals.reduce((n, m) => n + m.kcal, 0) / meals.length);
  console.log(
    `\nSeeded ${weeks} weeks, ${from} → ${DAY}:` +
      `\n  ${weighIns.length} weigh-ins of ${days.length} days (one 9-day gap, on purpose)` +
      `\n  ${meals.length} logged days, mean ${meanIntake} kcal` +
      `\n  ${runs.length} runs` +
      `\n\nRe-run to reproduce exactly — nothing here is random.`,
  );
}
