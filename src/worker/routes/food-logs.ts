import { Hono } from "hono";
import type { FoodLogCreate, FoodLogsCreated } from "../../shared/api";
import type { AppEnv } from "../types";
import { isDay, isNum, oneOf } from "../validate";

const foodLogs = new Hono<AppEnv>();

const slotOf = oneOf(["breakfast", "lunch", "dinner", "snack"] as const);
// photo and barcode become writable when M3's flows exist to send them
const sourceOf = oneOf(["text", "favorite"] as const);

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
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return c.json({ error: "items_required" }, 400);
  }

  const now = new Date().toISOString();
  const rows = [];
  for (const item of body.items) {
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 120) : "";
    const kcal = isNum(item?.kcal) && item.kcal >= 0 && item.kcal <= 10000 ? Math.round(item.kcal) : null;
    const grams = (v: unknown) => (isNum(v) && v >= 0 && v <= 1000 ? Math.round(v * 10) / 10 : null);
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
      confidence,
      edited: item.edited === true ? 1 : 0,
    });
  }

  await c.var.db.insertInto("food_logs").values(rows).execute();

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
