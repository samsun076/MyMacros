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
