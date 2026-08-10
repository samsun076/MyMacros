import { Hono } from "hono";
import type { FoodLogCreate, FoodLogsCreated, RecentsResponse } from "../../shared/api";
import { ownedPhotoKey } from "../photos";
import type { AppEnv } from "../types";
import { isDay, isNum, oneOf } from "../validate";

const foodLogs = new Hono<AppEnv>();

/** GET /api/food-logs/recent (#12): the last few distinct meals, newest
 *  first, each folded the same way the timeline folds them (rows sharing a
 *  logged_at instant are one meal). Deduped by name so "the usual" shows up
 *  once no matter how often it was logged. */
foodLogs.get("/recent", async (c) => {
  const rows = await c.var.db
    .selectFrom("food_logs")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .orderBy("logged_at", "desc")
    .limit(60)
    .execute();

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.logged_at}|${row.meal_slot}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const seen = new Set<string>();
  const meals = [];
  for (const group of groups.values()) {
    const name = group.map((r, i) => (i === 0 ? r.name : r.name.toLowerCase())).join(", ");
    const dedupe = name.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    meals.push({
      name,
      kcal: group.reduce((s, r) => s + r.kcal, 0),
      protein_g: round1(group.reduce((s, r) => s + r.protein_g, 0)),
      carbs_g: round1(group.reduce((s, r) => s + r.carbs_g, 0)),
      fat_g: round1(group.reduce((s, r) => s + r.fat_g, 0)),
    });
    if (meals.length >= 8) break;
  }
  return c.json<RecentsResponse>({ meals });
});

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** The two per-item number shapes, shared by the saved values and by #76's
 *  record of what the reader proposed — same bounds and same rounding on both
 *  sides, so a stored pair can be subtracted without one of them having been
 *  quantised differently from the other. `null` means "not a valid figure". */
const energy = (v: unknown) => (isNum(v) && v >= 0 && v <= 10000 ? Math.round(v) : null);
const grams = (v: unknown) => (isNum(v) && v >= 0 && v <= 1000 ? Math.round(v * 10) / 10 : null);

const slotOf = oneOf(["breakfast", "lunch", "dinner", "snack"] as const);
// the schema's four sources are all writable from M3 — the CHECK constraint
// in migration 0001 already named photo and barcode, so nothing migrates
const sourceOf = oneOf(["text", "favorite", "photo", "barcode"] as const);

/** POST /api/food-logs (#10): the confirm sheet's save. One row per item,
 *  all sharing one `logged_at` instant — that shared instant is what groups
 *  a save back into a single timeline meal entry on the Today screen.
 *
 *  `logged_on` comes from the client, which owns the local day (#44):
 *  midnight cutoff, set once at creation. There is no edit route yet; when
 *  one lands (desktop review surface), it must never recompute `logged_on`. */
foodLogs.post("/", async (c) => {
  const body = await c.req.json<FoodLogCreate>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const loggedOn = isDay(body.logged_on);
  const mealSlot = slotOf(body.meal_slot);
  const source = sourceOf(body.source);
  if (!loggedOn || !mealSlot || !source) {
    return c.json({ error: "invalid_fields" }, 400);
  }

  // The key was minted by POST /api/analyze/photo for this session, so a key
  // that isn't under this user's prefix is either a bug or someone else's
  // photo — refuse rather than store a pointer we'd then serve 404s for.
  let photoKey: string | null = null;
  if (body.photo_key !== undefined) {
    const owned = ownedPhotoKey(body.photo_key, c.var.user.id);
    if (!owned) return c.json({ error: "invalid_photo_key" }, 400);
    photoKey = owned;
  }

  // The code the scan produced, kept on the row so "what did I actually eat"
  // stays answerable later without a second lookup (#15).
  let scanned: string | null = null;
  if (body.barcode !== undefined) {
    if (typeof body.barcode !== "string" || !/^\d{8,14}$/.test(body.barcode)) {
      return c.json({ error: "invalid_barcode" }, 400);
    }
    scanned = body.barcode;
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return c.json({ error: "items_required" }, 400);
  }

  const now = new Date().toISOString();
  const rows = [];
  for (const item of body.items) {
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 120) : "";
    const kcal = energy(item?.kcal);
    const protein = grams(item?.protein_g);
    const carbs = grams(item?.carbs_g);
    const fat = grams(item?.fat_g);
    const confidence =
      item?.confidence === null
        ? null
        : isNum(item?.confidence) && item.confidence >= 0 && item.confidence <= 1
          ? item.confidence
          : undefined;
    if (!name || kcal === null || protein === null || carbs === null || fat === null || confidence === undefined) {
      return c.json({ error: "invalid_item" }, 400);
    }

    /* What the reader proposed, before this item was edited (#76).
     *
     * All four together or none at all. A partial set is refused rather than
     * stored with holes: the question these columns exist to answer is "by
     * how much, and in which direction", and a row holding three of four
     * macros answers it for none of them. The absent case is a real one and
     * stays legal — a favorite re-log and #16's blank recovery row never had
     * a read behind them.
     *
     * Not folded into the `edited` check: an UNEDITED save writes these equal
     * to the saved values, so that "the reader agreed" and "we never recorded
     * it" don't both look like null. */
    const raw = [item?.ai_kcal, item?.ai_protein_g, item?.ai_carbs_g, item?.ai_fat_g];
    const ai = raw.every((v) => v === undefined || v === null)
      ? null
      : {
          kcal: energy(item?.ai_kcal),
          protein_g: grams(item?.ai_protein_g),
          carbs_g: grams(item?.ai_carbs_g),
          fat_g: grams(item?.ai_fat_g),
        };
    if (ai && Object.values(ai).some((v) => v === null)) {
      return c.json({ error: "invalid_ai_estimate" }, 400);
    }
    rows.push({
      id: crypto.randomUUID(),
      user_id: c.var.user.id,
      logged_on: loggedOn,
      logged_at: now,
      meal_slot: mealSlot,
      name,
      kcal,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      source,
      // stamped on every row of the save, the same way logged_at is: the
      // timeline folds rows sharing an instant into one meal, and that meal
      // has one photo
      photo_key: photoKey,
      barcode: scanned,
      confidence,
      edited: item.edited === true ? 1 : 0,
      ai_kcal: ai?.kcal ?? null,
      ai_protein_g: ai?.protein_g ?? null,
      ai_carbs_g: ai?.carbs_g ?? null,
      ai_fat_g: ai?.fat_g ?? null,
    });
  }

  await c.var.db.insertInto("food_logs").values(rows).execute();

  // a re-log from a favorite records the use, so most-used sorting works
  if (typeof body.favorite_id === "string" && body.favorite_id.length > 0) {
    await c.var.db
      .updateTable("favorites")
      .set((eb) => ({ use_count: eb("use_count", "+", 1), last_used_at: now }))
      .where("user_id", "=", c.var.user.id)
      .where("id", "=", body.favorite_id)
      .execute();
  }

  // Keep profiles.timezone current from the device (#44) — M4's budget
  // engine runs server-side with no client present and needs a real value.
  if (typeof body.timezone === "string" && body.timezone.length > 0 && body.timezone.length <= 64) {
    await c.var.db
      .updateTable("profiles")
      .set({ timezone: body.timezone, updated_at: now })
      .where("user_id", "=", c.var.user.id)
      .execute();
  }

  const logs = await c.var.db
    .selectFrom("food_logs")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .where(
      "id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("logged_at", "asc")
    .execute();

  return c.json<FoodLogsCreated>({ logs }, 201);
});

export default foodLogs;
