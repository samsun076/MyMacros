import type { ActivityLevel, Accent, AthleteProfile, Goal, Macro, Theme, Units } from "./api";

/** The `profiles` column DEFAULTs, stated once for a form to seed from (#86).
 *
 *  **Every `?? <literal>` in a form is a second statement of a DEFAULT in
 *  `migrations/`,** correct only while someone keeps the two in step by hand.
 *  The register in CLAUDE.md names this as the trap that keeps producing
 *  one-quantity-two-sources defects, and it had already sprung once: Onboarding
 *  read `carb_ratio_pct ?? 62` against a default migration 0008 had rebuilt to
 *  58, stale within a day of being written and visible only in the window
 *  before `/api/me` answers — which is precisely why nobody caught it.
 *
 *  **This is not the source. `migrations/` is, and this restates it.** What
 *  keeps the two together is the "column defaults" block in
 *  `src/worker/routes/me.route.test.ts`, which inserts a bare profile row and
 *  asserts every value here is what SQLite actually wrote. Adding a column with
 *  a DEFAULT and forgetting this file is a failing test rather than a silent
 *  divergence.
 *
 *  **Two DEFAULTs are deliberately absent**, because a better source already
 *  owns them and listing them here would make a third copy:
 *
 *  - `protein_g_per_kg` (2.0) — coupled to `goal`'s own default, so it comes
 *    from `PROTEIN_G_PER_KG.cut`. Migration 0007 says so in its own comment.
 *  - `carb_ratio_pct` (58) — owned by the training preset, so it comes from
 *    `ATHLETE_PROFILES.general.carb_ratio_pct`.
 *
 *  The same test pins both against the inserted row, so their absence here
 *  costs no coverage.
 *
 *  `timezone` is absent for a different reason: its default is a *deployment*
 *  assumption (#37), not a value a client should ever seed a control from. It
 *  is mirrored from the device on every save (#44) and is read-only in the UI.
 */
export const PROFILE_DEFAULTS = {
  activity_level: "moderate",
  goal: "cut",
  athlete_profile: "general",
  deficit_kcal: 500,
  eat_back_pct: 50,
  focus_macro: "protein",
  units: "imperial",
  theme: "night-athletic",
  accent: "coral",
} as const satisfies {
  activity_level: ActivityLevel;
  goal: Goal;
  athlete_profile: AthleteProfile;
  deficit_kcal: number;
  eat_back_pct: number;
  focus_macro: Macro;
  units: Units;
  theme: Theme;
  accent: Accent;
};
