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
export type RunSource = "debrief" | "manual";
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
