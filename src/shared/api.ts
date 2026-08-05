/** Wire types shared by the Worker and the client. */

export type Health = {
  ok: boolean;
  /** D1 reachable and answering queries. */
  db: boolean;
  /** Newest applied migration, or null if the database has never been migrated. */
  migration: string | null;
  time: string;
};

/** Which sign-in methods this deployment can actually offer. Google depends
 *  on credentials that only exist once Session B2 has run, so the client asks
 *  rather than assuming. */
export type AuthMethods = {
  google: boolean;
  passkey: boolean;
  /** Dev-only email/password bootstrap; always false in production builds. */
  devEmail: boolean;
};

export type Macro = "protein" | "carbs" | "fat";
export type Theme = "night-athletic" | "field-notes" | "instrument";
export type Accent = "coral" | "gold" | "mint";
export type Units = "imperial" | "metric";

export type Profile = {
  user_id: string;
  sex: "male" | "female" | null;
  birth_date: string | null;
  height_cm: number | null;
  activity_level: "sedentary" | "light" | "moderate" | "active" | "very_active";
  goal: "cut" | "maintain" | "gain";
  deficit_kcal: number;
  start_weight_kg: number | null;
  goal_weight_kg: number | null;
  eat_back_pct: number;
  protein_pct: number;
  carb_pct: number;
  fat_pct: number;
  focus_macro: Macro;
  /** The static base target (M2). M4's TDEE engine recalculates it; the
   *  earned run bonus is never folded in (build rule 7). */
  target_kcal: number;
  units: Units;
  theme: Theme;
  accent: Accent;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  profile: Profile;
};

/** Any subset of the writable profile fields. */
export type ProfileUpdate = Partial<
  Omit<Profile, "user_id" | "created_at" | "updated_at">
>;

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type FoodSource = "photo" | "barcode" | "text" | "favorite";

export type FoodLog = {
  id: string;
  user_id: string;
  /** YYYY-MM-DD in the device's local day at creation — set once, never
   *  recomputed on edit (#44). */
  logged_on: string;
  /** ISO-8601 UTC instant of capture. */
  logged_at: string;
  meal_slot: MealSlot;
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  source: FoodSource;
  photo_key: string | null;
  barcode: string | null;
  /** AI 0..1; null for barcode/favorite. */
  confidence: number | null;
  /** 0/1 — the user changed the AI's numbers before saving. */
  edited: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** One food the AI read out of a description (#9). Editable on the confirm
 *  sheet before anything is saved. */
export type AnalyzedItem = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** 0..1, range-checked server-side (structured outputs drop numeric
   *  bounds — #45). */
  confidence: number;
};

/** POST /api/analyze/text response. */
export type AnalyzeResponse = { items: AnalyzedItem[] };

/** One item of a save from the confirm sheet (#10). */
export type FoodLogItemInput = {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** AI confidence; null when the number wasn't AI-estimated (favorites). */
  confidence: number | null;
  /** True when the user changed the AI's numbers before saving. */
  edited: boolean;
};

/** POST /api/food-logs body. One save = one meal = one shared `logged_at`
 *  instant, which is what groups the rows back into a single timeline entry. */
export type FoodLogCreate = {
  /** Device-local date (#44) — the client owns the day boundary. */
  logged_on: string;
  /** Device IANA timezone, mirrored into profiles.timezone (#44). */
  timezone?: string;
  meal_slot: MealSlot;
  /** photo/barcode arrive with M3. */
  source: "text" | "favorite";
  /** When the save is a one-tap re-log (#12): bumps that favorite's
   *  use_count so most-used sorting works. */
  favorite_id?: string;
  items: FoodLogItemInput[];
};

/** POST /api/food-logs response: the created rows. */
export type FoodLogsCreated = { logs: FoodLog[] };

/** A starred meal (#12). */
export type Favorite = {
  id: string;
  user_id: string;
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  photo_key: string | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
};

/** GET /api/favorites — most-used first. */
export type FavoritesResponse = { favorites: Favorite[] };

/** One recent meal, folded the way the timeline folds it. */
export type RecentMeal = {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

/** GET /api/food-logs/recent — newest first, deduped by name. */
export type RecentsResponse = { meals: RecentMeal[] };

export type DayTotals = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

/** GET /api/day/:date — everything the Today screen needs in one round trip
 *  (#48). Deliberately M4-ready: #19/#21 fill `run` and the adjusted-target
 *  arithmetic into this same shape instead of rewriting the client. */
export type DayResponse = {
  logs: FoodLog[];
  totals: DayTotals;
  target_kcal: number;
  /** M4: the day's run + earned kcal; always null in M2. */
  run: null;
};
