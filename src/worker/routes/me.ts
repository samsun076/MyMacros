import { Hono } from "hono";
import type { Me, ProfileUpdate } from "../../shared/api";
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
  deficit_kcal: (v: unknown) => (isNum(v) && v >= 0 && v <= 1500 ? Math.round(v) : undefined),
  // the M2 base target (migration 0002) — sane-range guarded, not clinical
  target_kcal: (v: unknown) => (isNum(v) && v >= 500 && v <= 6000 ? Math.round(v) : undefined),
  start_weight_kg: positive,
  goal_weight_kg: positive,
  eat_back_pct: (v: unknown) => (isNum(v) && v >= 0 && v <= 100 ? Math.round(v) : undefined),
  protein_pct: pct,
  carb_pct: pct,
  fat_pct: pct,
  focus_macro: oneOf(["protein", "carbs", "fat"]),
  units: oneOf(["imperial", "metric"]),
  theme: oneOf(["night-athletic", "field-notes", "instrument"]),
  accent: oneOf(["coral", "gold", "mint"]),
  timezone: (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 64 ? v : undefined),
} satisfies Record<string, (v: unknown) => unknown>;

me.get("/", async (c) => {
  const user = c.var.user;
  const profile = await loadProfile(c.var.db, user.id);

  return c.json<Me>({
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    profile,
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

  // The macro split has to keep meaning "percent of kcal", so when any leg
  // moves, check all three against whatever is currently stored.
  const touchesSplit = ["protein_pct", "carb_pct", "fat_pct"].some((k) => k in patch);
  if (touchesSplit) {
    const current = await loadProfile(c.var.db, c.var.user.id);
    const leg = (key: "protein_pct" | "carb_pct" | "fat_pct") =>
      (patch[key] as number | undefined) ?? current[key];
    const split = leg("protein_pct") + leg("carb_pct") + leg("fat_pct");
    if (split !== 100) {
      return c.json({ error: "macro_split_must_total_100", got: split }, 400);
    }
  }

  await c.var.db
    .updateTable("profiles")
    .set({ ...patch, updated_at: new Date().toISOString() })
    // scoped to the session user — never to an id from the request
    .where("user_id", "=", c.var.user.id)
    .execute();

  return c.json(await loadProfile(c.var.db, c.var.user.id));
});

export default me;
