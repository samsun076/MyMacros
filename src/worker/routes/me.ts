import { Hono } from "hono";
import type { Me, ProfileUpdate } from "../../shared/api";
import { PROTEIN_G_PER_KG_RANGE } from "../../shared/budget";
import { dayInTimezone } from "../../shared/day";
import { currentTrendWeightKg } from "../../shared/weight";
import { recentWeighIns, refreshTarget } from "../budget";
import { loadProfile } from "../profile";
import type { AppEnv } from "../types";
import { isDay, isNum, oneOf, pct, positive } from "../validate";

const me = new Hono<AppEnv>();

/** Fields a user is allowed to change about themselves, and how to validate
 *  each. Anything absent from this map is simply not writable over the wire —
 *  an allowlist, so adding a column never accidentally exposes it. */
const EDITABLE = {
  sex: (v: unknown) => (v === "male" || v === "female" ? v : undefined),
  birth_date: isDay,
  height_cm: positive,
  activity_level: oneOf(["sedentary", "light", "moderate", "active", "very_active"]),
  goal: oneOf(["cut", "maintain", "gain"]),
  // #79. Runner and General only, matching the column's own CHECK — a value
  // the app can't serve is refused here rather than stored and rendered as a
  // profile that does nothing.
  athlete_profile: oneOf(["runner", "general"]),
  deficit_kcal: (v: unknown) => (isNum(v) && v >= 0 && v <= 1500 ? Math.round(v) : undefined),
  // `target_kcal` is deliberately NOT here any more (#17). It is derived from
  // the profile plus the latest weigh-in and rewritten by refreshTarget, so
  // accepting a hand-set value would give one number two writers — and the
  // derived one wins silently, on the next weigh-in, with nothing on screen
  // to say the user's choice was discarded. If a manual override is ever
  // wanted it needs its own column, so that both values stay visible.
  start_weight_kg: positive,
  goal_weight_kg: positive,
  eat_back_pct: (v: unknown) => (isNum(v) && v >= 0 && v <= 100 ? Math.round(v) : undefined),
  // #77. Bounds are the slider's, so a value the UI can't produce is refused
  // rather than clamped silently; the tenth is the stored resolution.
  protein_g_per_kg: (v: unknown) =>
    isNum(v) && v >= PROTEIN_G_PER_KG_RANGE.min && v <= PROTEIN_G_PER_KG_RANGE.max
      ? Math.round(v * 10) / 10
      : undefined,
  carb_ratio_pct: pct,
  focus_macro: oneOf(["protein", "carbs", "fat"]),
  units: oneOf(["imperial", "metric"]),
  theme: oneOf(["night-athletic", "field-notes", "instrument"]),
  accent: oneOf(["coral", "gold", "mint"]),
  timezone: (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : undefined),
} satisfies Record<string, (v: unknown) => unknown>;

me.get("/", async (c) => {
  const user = c.var.user;
  const profile = await loadProfile(c.var.db, user.id);

  /* The weight the budget is actually computed from (#78).
   *
   * Reported rather than left to the client to derive, because the client
   * previously derived it from `profiles.start_weight_kg` — the number typed
   * at onboarding and never updated — and the Settings preview and the Today
   * screen showed two different base targets, each arithmetically perfect.
   * Same function `refreshTarget` uses, so the previewed budget and the
   * stored one cannot disagree.
   *
   * Null when there is no weigh-in to go on. First-run onboarding is exactly
   * that case, and it must keep asking for a typed weight. */
  const entries = await recentWeighIns(c.var.db, user.id);
  const trend_weight_kg = currentTrendWeightKg(entries, dayInTimezone(new Date(), profile.timezone));

  return c.json<Me>({
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    profile,
    trend_weight_kg,
  });
});

me.patch("/profile", async (c) => {
  const body = await c.req.json<ProfileUpdate>().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "invalid_body" }, 400);
  }

  const patch: Record<string, unknown> = {};
  const rejected: string[] = [];
  for (const [key, validate] of Object.entries(EDITABLE)) {
    if (!(key in body)) continue;
    const value = validate((body as Record<string, unknown>)[key]);
    if (value === undefined) rejected.push(key);
    else patch[key] = value;
  }

  if (rejected.length) return c.json({ error: "invalid_fields", fields: rejected }, 400);
  if (!Object.keys(patch).length) return c.json({ error: "nothing_to_update" }, 400);

  /* No cross-field macro check any more (#77).
   *
   * The old three percent legs had to be validated against each other on
   * every write, because two of them could be saved in a state that meant
   * nothing. Protein is now anchored to body weight and fat is the remainder
   * of the remainder, so there is no sum to police: any pair of values the
   * validators above accept describes a real day. The invariant did not move
   * somewhere else — it stopped existing. */

  await c.var.db
    .updateTable("profiles")
    .set({ ...patch, updated_at: new Date().toISOString() })
    // scoped to the session user — never to an id from the request
    .where("user_id", "=", c.var.user.id)
    .execute();

  // Any of sex/birth_date/height_cm/activity_level/goal/deficit_kcal moves the
  // target, so recompute rather than making each caller remember to (#17).
  // Cheap, and a no-op write when the number hasn't changed.
  await refreshTarget(c.var.db, c.var.user.id);

  return c.json(await loadProfile(c.var.db, c.var.user.id));
});

export default me;
