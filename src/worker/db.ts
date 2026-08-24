import { Kysely, type Generated } from "kysely";
import { D1Dialect } from "kysely-d1";

/** Typed mirror of migrations/0001_schema_v1.sql.
 *
 * Keep in step with the migrations by hand — they're the source of truth,
 * this is the type-level shadow of them. Auth tables are intentionally absent:
 * better-auth reads and writes those itself and nothing else should.
 */

/** ISO-8601 UTC instant, e.g. 2026-08-02T19:40:04.546Z */
type Instant = string;
/** YYYY-MM-DD in the user's local day. */
type Day = string;

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type FoodSource = "photo" | "barcode" | "text" | "favorite";
export type WeightSource = "garmin" | "manual";
/** How a run row got here. `sync` means POST /api/sync from whatever feed this
 *  deployment has wired up; `manual` means a person typed it. Renamed from
 *  `debrief` in 0010 — that was the maintainer's own upstream pipeline welded
 *  into a CHECK constraint every self-hosted instance inherited (#37). */
export type RunSource = "sync" | "manual";
export type Macro = "protein" | "carbs" | "fat";
export type Theme = "night-athletic" | "field-notes" | "instrument";
export type Accent = "coral" | "gold" | "mint";
export type Units = "imperial" | "metric";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Goal = "cut" | "maintain" | "gain";
export type AthleteProfile = "runner" | "general";

export type ProfileTable = {
  user_id: string;
  sex: "male" | "female" | null;
  birth_date: Day | null;
  height_cm: number | null;
  activity_level: Generated<ActivityLevel>;
  goal: Generated<Goal>;
  /** #79 (migration 0008). Sets carb:fat and eat-back — never
   *  `activity_level`, which would double-count every run. */
  athlete_profile: Generated<AthleteProfile>;
  deficit_kcal: Generated<number>;
  start_weight_kg: number | null;
  goal_weight_kg: number | null;
  eat_back_pct: Generated<number>;
  /** #77 (migration 0007) replaced the three percent-of-kcal legs with these
   *  two: protein anchored to body weight, and one ratio splitting whatever
   *  energy is left. */
  protein_g_per_kg: Generated<number>;
  carb_ratio_pct: Generated<number>;
  focus_macro: Generated<Macro>;
  /** M2's static base target (migration 0002). M4 (#17) changes how it's
   *  calculated, not where it lives. */
  target_kcal: Generated<number>;
  units: Generated<Units>;
  theme: Generated<Theme>;
  accent: Generated<Accent>;
  timezone: Generated<string>;
  created_at: Generated<Instant>;
  updated_at: Generated<Instant>;
};

export type FoodLogTable = {
  id: string;
  user_id: string;
  logged_on: Day;
  logged_at: Instant;
  meal_slot: MealSlot;
  name: string;
  kcal: number;
  protein_g: Generated<number>;
  carbs_g: Generated<number>;
  fat_g: Generated<number>;
  source: FoodSource;
  photo_key: string | null;
  barcode: string | null;
  confidence: number | null;
  /** 0/1 — SQLite has no boolean. */
  edited: Generated<number>;
  /** What the reader proposed, before the user touched it (#76). All four
   *  move together — null only when no read produced numbers (a favorite
   *  re-log, #16's blank row, or a row older than migration 0006). */
  ai_kcal: number | null;
  ai_protein_g: number | null;
  ai_carbs_g: number | null;
  ai_fat_g: number | null;
  /** How much of this food the row's numbers describe (migration 0009, #104)
   *  — the count and the thing counted, "4" and "slices". `unit` is a label
   *  and never a conversion. All three move together; null means "not
   *  recorded", never "one serving". */
  portion_qty: number | null;
  portion_unit: string | null;
  /** What the reader counted before the user scaled it. Part of the `ai_*`
   *  family and written EQUAL to `portion_qty` on an unscaled save — a
   *  portion change is not an `edited` correction (#58), so this column is
   *  the only thing that records the reader was ever asked. */
  ai_portion_qty: number | null;
  notes: string | null;
  created_at: Generated<Instant>;
  updated_at: Generated<Instant>;
};

export type WeightTable = {
  id: string;
  user_id: string;
  measured_on: Day;
  weight_kg: number;
  body_fat_pct: number | null;
  source: WeightSource;
  created_at: Generated<Instant>;
};

export type RunTable = {
  id: string;
  user_id: string;
  ran_on: Day;
  started_at: Instant | null;
  distance_m: number;
  duration_s: number | null;
  kcal: number;
  tss: number | null;
  source: Generated<RunSource>;
  external_id: string | null;
  created_at: Generated<Instant>;
};

export type FavoriteTable = {
  id: string;
  user_id: string;
  name: string;
  kcal: number;
  protein_g: Generated<number>;
  carbs_g: Generated<number>;
  fat_g: Generated<number>;
  photo_key: string | null;
  use_count: Generated<number>;
  last_used_at: Instant | null;
  created_at: Generated<Instant>;
};

/** Machine credentials for /api/sync (#19). Only the hash is stored — see
 *  migrations/0003_sync_tokens.sql for why SHA-256 and not a password hash. */
export type SyncTokenTable = {
  id: string;
  user_id: string;
  token_hash: string;
  name: string;
  created_at: Generated<Instant>;
  last_used_at: Instant | null;
};

/** better-auth owns this table and nothing else should write it. It is
 *  declared here read-only-by-convention so a sync token can be joined back
 *  to the user it authenticates, which is what lets /api/sync put a real
 *  `c.var.user` on the context instead of a synthetic one. */
export type UserTable = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

/** Which feed, matching the top-level keys of a /api/sync payload. */
export type SyncSource = "runs" | "weights";

/** When each feed last checked in (migration 0004, #69). Per source rather
 *  than per token: one token carries both, so `sync_tokens.last_used_at` goes
 *  on looking healthy while half the pipeline is dead. */
export type SyncSourceTable = {
  user_id: string;
  source: SyncSource;
  last_success_at: Instant;
  last_item_count: Generated<number>;
};

/** A reading the user rejected (migration 0005, #71). Keyed by value as well
 *  as day, so a corrected re-weigh of the same date still gets through. */
export type WeightTombstoneTable = {
  user_id: string;
  measured_on: Day;
  weight_kg: number;
  created_at: Generated<Instant>;
};

export type Database = {
  users: UserTable;
  sync_tokens: SyncTokenTable;
  sync_sources: SyncSourceTable;
  weight_tombstones: WeightTombstoneTable;
  profiles: ProfileTable;
  food_logs: FoodLogTable;
  weights: WeightTable;
  runs: RunTable;
  favorites: FavoriteTable;
};

/** A Kysely instance for this request's D1 binding. Cheap to construct —
 *  D1 has no connection pool, so there's nothing to reuse across requests. */
export function createDb(env: Env): Kysely<Database> {
  return new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) });
}

export type Db = Kysely<Database>;

/** How many bound parameters D1 will take in one statement.
 *
 *  **Found by driving the route, not by reading a doc** (#81, 2026-08-21).
 *  `POST /api/food-logs` builds one multi-row INSERT and the row is 22 columns
 *  wide, so five foods is 110 placeholders and D1 answers
 *  `too many SQL variables at offset 606: SQLITE_ERROR` — a 500, which on this
 *  route discards a confirm sheet that exists in the browser's memory and
 *  nowhere else. Measured across 1…21 items against real workerd and real D1:
 *  **1–4 returned 201, 5–20 returned 500**, 21 returned the route's own 400.
 *
 *  It has been there since #10 (4218111, 2026-08-04) and had never fired,
 *  because until #81 a save was one read and a read is usually one or two
 *  foods. That is CLAUDE.md's "a bound that has never been reached has never
 *  been tested" with the roles reversed — the route's own `MAX_ITEMS = 20` was
 *  the bound *stating* a capacity, and the real ceiling four rows down was the
 *  one doing the work. A photograph of a plate returning five foods reaches it
 *  today, with no basket involved.
 *
 *  Kept as a number rather than a computed probe: D1 does not report its own
 *  limit, and a value discovered by binary search at runtime would be a second
 *  source for a constant the platform owns. If Cloudflare raises it, the
 *  symptom of this staying at 100 is one extra round trip per five foods. */
export const D1_MAX_BOUND_PARAMS = 100;

/** Split a multi-row insert into statements D1 will actually run.
 *
 *  **Chunked rather than looped one row at a time**, because the round trip is
 *  what costs: twenty foods is five statements here and twenty there, on a
 *  route a person is standing still waiting for.
 *
 *  **The width is read off the first row**, so it cannot drift from the
 *  columns being written — a hand-counted 22 is a literal that rots the next
 *  time a migration adds a column, which is precisely how the ceiling above
 *  went unnoticed. Rows in one call are the same shape by construction: they
 *  are built by one loop from one object literal.
 *
 *  **This is not atomic and the caller has to be able to live with that.** The
 *  house pattern already is — nothing in `src/worker/` uses `batch()` or a
 *  transaction — and for `food_logs` the partial state is coherent rather than
 *  torn: every row of a save carries the same `logged_at`, so a failure after
 *  the first chunk leaves a *shorter* meal that still folds into one timeline
 *  entry and can be corrected in #60's edit sheet. What it must never be used
 *  for is a set of rows that are meaningless apart. */
export function insertChunks<T extends object>(rows: readonly T[], limit = D1_MAX_BOUND_PARAMS): T[][] {
  const width = Object.keys(rows[0] ?? {}).length;
  const per = Math.max(1, Math.floor(limit / Math.max(width, 1)));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += per) chunks.push(rows.slice(i, i + per) as T[]);
  return chunks;
}
