#!/usr/bin/env node
/**
 * Seed a day of demo food logs into the LOCAL D1.
 *
 *   node tools/seed-demo.mjs              # today
 *   node tools/seed-demo.mjs 2026-08-06   # a specific day
 *
 * Why this exists: a fresh clone signs in to an empty Today screen — an empty
 * ring, an empty timeline — which is a bad first impression and a useless
 * thing to screenshot. This fills one day with a plausible morning so the
 * screen has something to draw, and so `tools/screencast.mjs` starts from a
 * deterministic frame.
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

const DAY = process.argv[2] ?? localToday();
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) {
  console.error(`Not a YYYY-MM-DD date: ${DAY}`);
  process.exit(1);
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

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

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

const file = join(mkdtempSync(join(tmpdir(), "seed-demo-")), "seed.sql");
writeFileSync(file, sql);

execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "mymacros-db", "--local", "--file", file, "--yes"],
  { stdio: "inherit" },
);

const eaten = MEALS.reduce((n, m) => n + m.kcal, 0);
console.log(`\nSeeded ${MEALS.length} logs on ${DAY} — ${eaten} kcal of 1810, dinner left open.`);
