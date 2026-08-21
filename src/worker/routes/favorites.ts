import { Hono } from "hono";
import type { FavoritesResponse } from "../../shared/api";
import { favoriteName } from "../../shared/meals";
import type { AppEnv } from "../types";
import { isNum } from "../validate";

const favorites = new Hono<AppEnv>();

/** Favorites (#12): saved meals for one-tap re-logging. Most-used first —
 *  the whole point is that repeats float to the top. */
favorites.get("/", async (c) => {
  const rows = await c.var.db
    .selectFrom("favorites")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .orderBy("use_count", "desc")
    .orderBy("last_used_at", "desc")
    .execute();
  return c.json<FavoritesResponse>({ favorites: rows });
});

/** Star a meal. Idempotent by name: starring the same meal twice returns
 *  the existing favorite rather than duplicating it.
 *
 *  **The trim and the ceiling are `favoriteName`'s, not this route's** (#103).
 *  The confirm sheet's star has to know whether the meal in front of it is
 *  already starred, and it can only answer that by comparing against the name
 *  this route would store — so the rule is stated once, in `shared/meals.ts`,
 *  and both sides call it. */
favorites.post("/", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  const name = typeof body?.name === "string" ? favoriteName(body.name) : "";
  const kcal = isNum(body?.kcal) && body.kcal >= 0 && body.kcal <= 10000 ? Math.round(body.kcal) : null;
  const grams = (v: unknown) => (isNum(v) && v >= 0 && v <= 1000 ? Math.round(v * 10) / 10 : null);
  const protein = grams(body?.protein_g);
  const carbs = grams(body?.carbs_g);
  const fat = grams(body?.fat_g);
  if (!name || kcal === null || protein === null || carbs === null || fat === null) {
    return c.json({ error: "invalid_fields" }, 400);
  }

  const existing = await c.var.db
    .selectFrom("favorites")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .where("name", "=", name)
    .executeTakeFirst();
  if (existing) return c.json(existing);

  const row = {
    id: crypto.randomUUID(),
    user_id: c.var.user.id,
    name,
    kcal,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
  };
  await c.var.db.insertInto("favorites").values(row).execute();
  const created = await c.var.db
    .selectFrom("favorites")
    .selectAll()
    .where("id", "=", row.id)
    .executeTakeFirstOrThrow();
  return c.json(created, 201);
});

favorites.delete("/:id", async (c) => {
  await c.var.db
    .deleteFrom("favorites")
    .where("user_id", "=", c.var.user.id)
    .where("id", "=", c.req.param("id"))
    .execute();
  return c.json({ ok: true });
});

export default favorites;
