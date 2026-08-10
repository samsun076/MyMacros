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

/** Named so the budget engine can refer to them without restating the union
 *  (#17). The values are the `profiles` CHECK constraints — changing either
 *  side alone puts a migration and a type out of step. */
export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Goal = "cut" | "maintain" | "gain";

export type Profile = {
  user_id: string;
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  activity_level: ActivityLevel;
  goal: Goal;
  deficit_kcal: number;
  start_weight_kg: number | null;
  goal_weight_kg: number | null;
  eat_back_pct: number;
  /** Protein's anchor, g per kg of trend weight (#77). Not a percent of
   *  energy: a run must not inflate the protein target. */
  protein_g_per_kg: number;
  /** Carbohydrate's share of the energy left after protein; fat takes the
   *  rest. One number, so the legs cannot fail to add up to anything. */
  carb_ratio_pct: number;
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
  /** The smoothed weight the budget is computed from — **not**
   *  `profile.start_weight_kg`, which is frozen at onboarding.
   *
   *  Served so a screen previewing a budget uses the same number the Worker
   *  stored. #78 is what the alternative looked like: Settings previewed
   *  1,889 from the onboarding weight while Today showed 1,909 from the
   *  trend, both arithmetically exact.
   *
   *  Null when no weigh-in exists yet — first-run onboarding, where the typed
   *  weight is the only input there is. */
  trend_weight_kg: number | null;
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
  /** What the reader proposed before the user touched it (#76) — so the row
   *  records *by how much* and *in which direction* an estimate was wrong,
   *  which `edited` alone cannot. Equal to the saved values on an unedited
   *  save; null only when no read produced numbers (a favorite re-log, #16's
   *  blank recovery row, or a row predating migration 0006). */
  ai_kcal: number | null;
  ai_protein_g: number | null;
  ai_carbs_g: number | null;
  ai_fat_g: number | null;
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
   *  bounds — #45). **null when the numbers were not AI-estimated** — a
   *  barcode's exact-match nutrition has no confidence to report (#15). */
  confidence: number | null;
};

/** POST /api/analyze/text and /api/analyze/photo response — one contract for
 *  every input mode, so the confirm sheet, the save route and the toast never
 *  learn which one produced the items (#13/#14).
 *
 *  `photo_key` is set only by the photo path. The Worker writes R2 *before*
 *  calling Claude, so the key comes back even when the read finds nothing —
 *  that ordering is what makes #16's "never lose the photo" structural rather
 *  than something an error path has to remember. */
export type AnalyzeResponse = {
  items: AnalyzedItem[];
  photo_key?: string;
  /** Barcode reads only (#15): the scanned code, and the gram weight the
   *  numbers above are scaled to. The sheet's grams field rescales linearly
   *  from there, so no separate per-100g basis has to cross the wire. */
  barcode?: string;
  grams?: number;
};

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
  /** The reader's own numbers for this item, before any edit (#76). Send all
   *  four or none — the route refuses a partial set, because a row carrying
   *  three of the four is a silently unusable record. Omit them when nothing
   *  read the item (a favorite re-log, #16's blank row). */
  ai_kcal?: number | null;
  ai_protein_g?: number | null;
  ai_carbs_g?: number | null;
  ai_fat_g?: number | null;
};

/** POST /api/food-logs body. One save = one meal = one shared `logged_at`
 *  instant, which is what groups the rows back into a single timeline entry. */
export type FoodLogCreate = {
  /** Device-local date (#44) — the client owns the day boundary. */
  logged_on: string;
  /** Device IANA timezone, mirrored into profiles.timezone (#44). */
  timezone?: string;
  meal_slot: MealSlot;
  source: FoodSource;
  /** R2 object key from POST /api/analyze/photo, stamped on every row of the
   *  save so the timeline can show the meal's own photo. */
  photo_key?: string;
  /** The scanned code, when the meal came from GET /api/barcode/:code. */
  barcode?: string;
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

/** A weigh-in row (#18). `measured_on` is YYYY-MM-DD local to the user, and
 *  unique per user per day — weighing twice in a morning corrects the day
 *  rather than adding a second row that would drag the mean. */
export type Weight = {
  id: string;
  user_id: string;
  measured_on: string;
  weight_kg: number;
  /** The Garmin Index reports it; manual entry usually won't. */
  body_fat_pct: number | null;
  source: "garmin" | "manual";
  created_at: string;
};

/** POST /api/weights. `source` is not accepted — a manual entry is manual by
 *  virtue of arriving here, and the sync endpoint (#19/#20) writes 'garmin'. */
export type WeightCreate = {
  measured_on: string;
  weight_kg: number;
  body_fat_pct?: number | null;
};

/** One point of the trend line: the day's raw weight and its smoothed value. */
export type WeightPoint = {
  measured_on: string;
  weight_kg: number;
  trend_kg: number;
};

/** GET /api/weights — recent history, oldest first, plus the smoothed series
 *  the trends screen draws and the single number the budget engine uses. */
export type WeightsResponse = {
  entries: Weight[];
  series: WeightPoint[];
  latest: Weight | null;
  /** 7-day smoothed weight as of the latest weigh-in; null with no data. */
  trend_kg: number | null;
};

/** One calendar week on the trends screen (#22), Monday-start.
 *
 *  **Every average below is over `logged_days`, not over `days`.** A day with
 *  no food logged is not a day of zero intake, and averaging it in is a
 *  whole-day-sized lie — the single largest way this screen can be wrong. The
 *  target and earned means use the same denominator on purpose: comparing
 *  "intake on the days I logged" against "target across every day" would
 *  inflate the comparison by whatever happened on the unlogged ones. */
export type TrendWeek = {
  /** Monday of the week, YYYY-MM-DD. */
  starts_on: string;
  /** How many of this week's days fall inside the window — 7 except at the
   *  window's edges. Distinct from `partial` below: a week can hold all seven
   *  days and still be unfinished, which is every Sunday evening. */
  days: number;
  /** Days with at least one food log. **Not** the denominator — see below. */
  logged_days: number;
  /** Days logged thoroughly enough to be a record of what was eaten, and so
   *  the denominator for every mean here (#74). A day is counted when its
   *  intake reaches `MIN_LOGGED_SHARE` of that day's base target, and today
   *  is never counted because it is incomplete by definition.
   *
   *  `logged_days − counted_days` is the number of partial days, which the
   *  screen shows beside this: the judgement is on display rather than applied
   *  silently, because a day dropping out of a denominator with nothing said
   *  is the same silence that made the original defect possible. */
  counted_days: number;
  /** The week being lived: its bar covers fewer days than the ones above it. */
  partial: boolean;
  /** Mean daily intake over the logged days; null when there were none. */
  intake_kcal: number | null;
  /** Mean daily BASE target. Never includes the earned bonus — base and
   *  earned draw separately (build rule 7). Null before onboarding. */
  target_kcal: number | null;
  /** Mean daily earned bonus: run kcal × eat_back_pct (#21). */
  earned_kcal: number;
  /** Mean daily realized deficit — expenditure minus intake.
   *
   *  **Expenditure uses the FULL run calories, not the eaten-back share.**
   *  `eat_back_pct` is a budgeting hedge that decides what you may eat; it is
   *  not a claim about physiology. Applying it here would apply the hedge
   *  twice and understate every deficit by half a run. So the bar (a budget
   *  view) and this number (a physiology view) use different run figures on
   *  purpose. */
  deficit_kcal: number | null;
  /** Total run calories in the week as the watch reported them — the figure
   *  the deficit is built on, exposed so it can be checked rather than
   *  trusted. */
  run_kcal: number;
};

/** How fast the weight is actually moving, answered twice (#22).
 *
 *  The two answers are independent and will disagree. The screen ranks them
 *  rather than reconciling them: the scale is measurement, the model is a
 *  model, and closing the gap between them is #28's job, not this screen's. */
export type TrendRate = {
  /** Least-squares slope of the smoothed trend across the window. The
   *  measured answer. Null until the weigh-ins span enough days that a slope
   *  means anything. */
  observed_kg_per_week: number | null;
  /** Mean deficit converted at KCAL_PER_KG. The modelled answer. Null until
   *  there are enough logged days to average. */
  predicted_kg_per_week: number | null;
  /** Mean daily realized deficit across the window. Same gate as above — an
   *  average over four days is exactly as misleading as the rate from it. */
  deficit_kcal: number | null;
  /** Days in the window with any food logged at all. */
  logged_days: number;
  /** Days logged thoroughly enough to average (#74), and the figure the
   *  14-day floor is actually applied to — a fortnight of coffees was never a
   *  fortnight of evidence. The reason the two fields above are present or
   *  absent, so the screen can say which. */
  counted_days: number;
  /** Days the weigh-ins span, which gates `observed_kg_per_week`. */
  weigh_in_span_days: number;
};

/** GET /api/trends/:date — the "is this working?" screen (#22).
 *
 *  Carries only what `/api/me` can't: the profile fields this screen needs
 *  (units, goal, goal_weight_kg, focus) already come from there, the way the
 *  Today screen already pairs `/api/day` with `/api/me`. */
export type TrendsResponse = {
  /** Monday of the oldest week in the window. */
  from: string;
  /** The client's own today (#44) — the window ends where the user is. */
  to: string;
  /** Oldest first. */
  weeks: TrendWeek[];
  /** The weight trend, one point per day with a weigh-in (#18). Reuses the
   *  shape `/api/weights` already returns; the smoothing is not redone. */
  series: WeightPoint[];
  rate: TrendRate;
  /** False when the budget engine has no inputs (#17), which makes every
   *  target and deficit above null. The screen sends you to onboarding
   *  rather than drawing empty bars it can't explain. */
  onboarded: boolean;
};

/** One run as the debrief pipeline pushes it (#19). `external_id` is the
 *  Suunto workout key and is what makes a re-send an update rather than a
 *  duplicate. */
export type SyncRun = {
  ran_on: string;
  external_id: string;
  distance_m: number;
  kcal: number;
  started_at?: string | null;
  duration_s?: number | null;
  tss?: number | null;
};

/** One weigh-in from the scale pipeline (#20). `source` is not accepted —
 *  arriving on /api/sync is what makes it 'garmin'. */
export type SyncWeight = {
  measured_on: string;
  weight_kg: number;
  body_fat_pct?: number | null;
};

/** POST /api/sync body. Both arrays are optional; the script sends a rolling
 *  window and the endpoint is idempotent, so re-sending is the normal case. */
export type SyncRequest = {
  runs?: SyncRun[];
  weights?: SyncWeight[];
  /** Present when the caller can honestly claim to know every weigh-in in a
   *  date range, which lets the endpoint remove ones that have disappeared
   *  upstream (#66). Omit it and nothing is ever deleted. */
  weights_window?: SyncWeightsWindow;
};

/** A claim of completeness over a date range (#66).
 *
 *  Garmin reports a deletion by simply not mentioning the day again — measured
 *  against the real API: no tombstone, no flag, the entry is just absent from
 *  `dateWeightList`. For any single day that is indistinguishable from "didn't
 *  weigh in", which is most days. A *window* is the smallest claim a collector
 *  can honestly make that carries the information, so it is what the endpoint
 *  requires before it will delete anything. */
export type SyncWeightsWindow = {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  /** Raise the removal cap for one run, for the rare case where the user
   *  really did delete several days upstream. Omitted means the default. */
  max_removals?: number;
};

export type SyncResponse = {
  runs: number;
  weights: number;
  /** Paths of items that failed validation, e.g. "runs[3]" — so a script
   *  silently dropping half its payload shows up in the launchd log. */
  rejected: string[];
  /** Paths of items that were valid but deliberately not written, e.g. a
   *  weigh-in for a day the user has typed over (#68). Distinct from
   *  `rejected` — nothing was wrong with these, they simply lost to a value
   *  that outranks them, and reporting them as written was a lie the sync
   *  scripts repeated into the log. */
  suppressed: string[];
  /** Days whose scale reading was removed because it has disappeared upstream
   *  (#66), e.g. ["2026-07-27"]. Only ever `source = 'garmin'` rows inside a
   *  declared window; a weigh-in the user typed is never touched. */
  removed: string[];
  /** Days that WOULD have been removed but weren't, because the batch asked to
   *  delete more than the cap allows. A person deletes one bad reading, not
   *  fourteen — a mass removal is evidence about the upstream response, not
   *  about the user, so the endpoint declines and says which days. */
  removals_refused: string[];
  /** Recomputed when a weigh-in arrived, otherwise null. */
  target_kcal: number | null;
};

/** A machine credential, as listed back to its owner. The token itself is
 *  never included — only its hash is stored (#19). */
export type SyncToken = {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
};

/** One feed, as Settings → Sources lists it (#69). */
export type SyncSourceHealth = FeedHealth & {
  /** Which feed — matches the top-level keys of a /api/sync payload. */
  source: "runs" | "weights";
};

export type SyncTokensResponse = {
  tokens: SyncToken[];
  /** Per-feed health, distinct from any token's `last_used_at`: one token
   *  carries both feeds, so a credential goes on looking healthy while half
   *  the pipeline is dead. Empty until something has actually synced. */
  sources: SyncSourceHealth[];
};

/** The one and only time the plaintext token exists outside the client. */
export type SyncTokenCreated = SyncToken & { token: string };

/** Every run on a given day, folded into one figure (#21).
 *
 *  Distance crosses the wire in metres, not as a formatted label: whether it
 *  reads "6.2 mi" or "10.0 km" is a display concern the client settles from
 *  `profiles.units`, the same way every other measurement does. */
export type DayRun = {
  /** How many runs — the label says "2 runs" rather than pretending to one. */
  count: number;
  /** Total kcal burned, as reported by the watch. */
  kcal: number;
  distance_m: number;
  /** The share of `kcal` that actually extends today's budget: kcal ×
   *  eat_back_pct. Never folded into target_kcal (build rule 7). */
  earned_kcal: number;
  /** The percentage applied, so the UI can explain the number rather than
   *  just assert it. */
  eat_back_pct: number;
};

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
  /** The day's runs, folded (#21). Null when nothing was run that day, which
   *  is what keeps "no runs" and "a run that earned nothing" distinguishable. */
  run: DayRun | null;
  /** False until the budget engine has every Mifflin-St Jeor input (#17) —
   *  meaning `target_kcal` above is the deployment's default, not a number
   *  computed for this person. The Today screen says so rather than drawing a
   *  made-up budget as though it were real. */
  onboarded: boolean;
  /** The runs feed's own health (#69). Null when it has never checked in —
   *  a feed that was never set up isn't broken, and a fresh install must not
   *  be told its runs are stale.
   *
   *  Exists because `run: null` above means two very different things: a rest
   *  day, and a sync that died three days ago. Only this can tell them
   *  apart. */
  runs_feed: FeedHealth | null;
};

/** When a sync feed last checked in, and whether that was long enough ago to
 *  stop trusting what's on screen (#69). */
export type FeedHealth = {
  /** ISO-8601 UTC instant of the last check-in — an attempt, not a write. A
   *  collector that ran and found nothing new is healthy. */
  last_success_at: string;
  /** How many items came with it. Zero is a normal, healthy answer. */
  last_item_count: number;
  /** Past the staleness threshold, and relevant to the day being viewed.
   *  False for past days: a feed that died last night doesn't make last
   *  Tuesday's runs incomplete. */
  stale: boolean;
};
