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

export type ProfileTable = {
  user_id: string;
  sex: "male" | "female" | null;
  birth_date: Day | null;
  height_cm: number | null;
  activity_level: Generated<ActivityLevel>;
  goal: Generated<Goal>;
  deficit_kcal: Generated<number>;
  start_weight_kg: number | null;
  goal_weight_kg: number | null;
  eat_back_pct: Generated<number>;
  protein_pct: Generated<number>;
  carb_pct: Generated<number>;
  fat_pct: Generated<number>;
  focus_macro: Generated<Macro>;
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

export type Database = {
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
