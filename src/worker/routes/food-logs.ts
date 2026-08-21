import { Hono } from "hono";
import type { FoodLogCreate, FoodLogsCreated, RecentsResponse } from "../../shared/api";
import { foldMeals } from "../../shared/meals";
import { ownedPhotoKey } from "../photos";
import type { AppEnv } from "../types";
import { isDay, isInstant, isNum, oneOf } from "../validate";

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

  // Folded by the same function the Today timeline folds with (#86) — the two
  // used to carry separate copies of this, which could disagree about what
  // counts as one meal without anything failing.
  const seen = new Set<string>();
  const meals = [];
  for (const meal of foldMeals(rows)) {
    const dedupe = meal.name.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    meals.push({
      name: meal.name,
      kcal: meal.kcal,
      protein_g: round1(meal.protein_g),
      carbs_g: round1(meal.carbs_g),
      fat_g: round1(meal.fat_g),
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

/** The portion's two shapes (#104) — the saved count and #58's as-read one,
 *  same bounds on both, so a stored pair can be compared without one of them
 *  having been quantised differently from the other.
 *
 *  **`MAX_QTY_COUNTED`, `MAX_QTY_MEASURED`, `MEASURED_PORTION_UNITS` and
 *  `MAX_UNIT` restate `normalize()`'s bounds in `routes/analyze.ts`**, which
 *  themselves restate `FOOD_LIMITS.portion_qty`, `FOOD_LIMITS.portion_qty_measured`
 *  and `MEASURED_PORTION_UNITS` in `src/client/lib/numeric.ts`. Carried, not
 *  derived — the same deliberate case #86 records for the pair above them, and
 *  for the same reason analyze.ts spells out: FOOD_LIMITS is a client module
 *  the Worker must not import, and this file's own 10000/1000 already restate
 *  the kcal and macro ceilings from there. Three statements of one rule.
 *  #109 is what that costs when the carried value turns out to be wrong — say
 *  so if any of it moves, and read `portion-limits.route.test.ts`, which fails
 *  if the three copies disagree.
 *
 *  **This route already did #109's other half and needed no change for it:**
 *  `portionQty` returns null on out of range and the route 400s
 *  `invalid_portion`, where `normalize()` used to clamp. Refusing is the
 *  honest answer to a number nobody can see being rewritten.
 *
 *  A bad qty is REFUSED and an over-long unit is TRUNCATED, which is not an
 *  inconsistency but this route's existing split: every number here is
 *  refused when out of range (`energy`, `grams`, and the 400 on `ai_kcal:
 *  99_000`), and every free-text label the reader chose is trimmed to fit
 *  (`name` at 120). `unit` is a label. */
const MAX_QTY_COUNTED = 100;
const MAX_QTY_MEASURED = 2000;
const MAX_UNIT = 24;

/** Units a portion is MEASURED in, as opposed to counted (#109).
 *
 *  **Reading `unit` to pick a bound is not converting between units.** #58 is
 *  emphatic that `unit` is *a label, never a conversion*, and this is the
 *  first thing in the app that reads it for anything. Nothing here turns oz
 *  into g or ml into l; no qty is ever rescaled by a factor derived from a
 *  label. The only thing the label decides is which typo-catcher applies to
 *  the number sitting next to it.
 *
 *  **The line is "read off a scale or a pack" vs "counted".** A measured unit
 *  carries a number somebody read from a food scale or a package label, so
 *  honest input runs into the hundreds and thousands — 200 g of chicken is not
 *  a slipped thumb, it is Tuesday. A counted unit counts household-sized
 *  things, so honest input stays in single or low double digits. Note that
 *  `cups`, `tbsp` and `tsp` are standard volumes and still belong on the
 *  counted side: you count scoops, and 2,000 cups is a typo nothing else in
 *  the app would catch.
 *
 *  **Volume is in, and that was the judgement call.** #109 named only the
 *  weights, `g` and `oz`. But "250 ml of milk" is the same sentence as "200 g
 *  of chicken" with a different label on it, and #109's whole finding is that
 *  the *enumeration* was short while the reasoning was sound. Shipping another
 *  short list would be shipping the same bug. `kg`, `lb` and `l` are here for
 *  completeness rather than need — honest input in those never approaches
 *  either ceiling, so their entry changes no outcome — but they are what a
 *  pack prints, and a list assembled by asking "which ones do we actually
 *  need?" is precisely how the first one came out short.
 *
 *  **To add a unit, ask one question: does its number come off a scale or a
 *  pack, or does it count things?** Nothing else about the label matters.
 *  Restated verbatim in `src/client/lib/numeric.ts` and `routes/analyze.ts`. */
export const MEASURED_PORTION_UNITS = [
  "g",
  "gram",
  "kg",
  "kilogram",
  "oz",
  "ounce",
  "fl oz",
  "floz",
  "fluid ounce",
  "lb",
  "pound",
  "ml",
  "milliliter",
  "millilitre",
  "l",
  "liter",
  "litre",
] as const;

/** Lower-case, no periods, single-spaced, singular. The reader emits "grams",
 *  a hand-edit produces "Oz." and a pack says "fl. oz." — all one unit. */
function unitKey(unit: string) {
  return unit
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");
}

/** The ceiling for a qty counted in `unit`. Exported for its tests (#47) —
 *  it is one of the three copies `portion-limits.route.test.ts` pins together. */
export function maxPortionQty(unit: string | null | undefined): number {
  const measured =
    typeof unit === "string" && (MEASURED_PORTION_UNITS as readonly string[]).includes(unitKey(unit));
  return measured ? MAX_QTY_MEASURED : MAX_QTY_COUNTED;
}

/** **`unit` is an argument, not an afterthought** (#109): the qty and the
 *  reader's qty are bounded by the unit *on their own row*, because they count
 *  the same thing. Passing one row's unit to another row's qty would be the
 *  register's defect in miniature. A `null` unit takes the counted ceiling and
 *  the whole portion is refused a few lines below regardless — `portionUnit`
 *  having returned null is itself a 400. */
const portionQty = (v: unknown, unit: string | null) => {
  if (!isNum(v)) return null;
  // Rounded first, then tested — at BOTH ends, matching `portion()` in
  // analyze.ts line for line. `0.04` is a positive number that becomes 0 at
  // one decimal place and a zero qty is a divide-by-zero for anything that
  // later rescales from it; `2000.04` is an over-range number that becomes
  // 2000. The guard has to sit on the value that is actually stored, and 1dp
  // is the resolution the column holds — so landing on the ceiling *through
  // rounding* is quantisation, not a clamp.
  const qty = Math.round(v * 10) / 10;
  return qty > 0 && qty <= maxPortionQty(unit) ? qty : null;
};

const portionUnit = (v: unknown) => {
  if (typeof v !== "string") return null;
  const unit = v.trim().slice(0, MAX_UNIT);
  // "1 of something unnamed" is the invented portion #58 forbids, so a count
  // with nothing to count is not half a portion — it is no portion.
  return unit ? unit : null;
};

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

  /* Normally the instant of the save. Undo supplies the original instead (#52).
   *
   * `logged_at` is what `foldMeals` groups a meal by, and since #80 the
   * timeline renders newest first — so an undo that re-stamped to now would
   * put a restored breakfast at the top of the day, above dinner, claiming you
   * ate it just now. The undo would visibly lie about the thing it was undoing.
   *
   * Client-supplied, which is consistent rather than new: `logged_on` has come
   * from the client since #44 because the device owns the local day. Nothing
   * here is a privilege — a user can already log any food to any day of their
   * own; this only decides where within one day it sits. Refused unless it
   * parses as a real instant, so a malformed undo fails loudly instead of
   * writing "Invalid Date" into a column the timeline sorts on. */
  const restored = body.logged_at === undefined ? null : isInstant(body.logged_at);
  if (body.logged_at !== undefined && !restored) {
    return c.json({ error: "invalid_fields", fields: ["logged_at"] }, 400);
  }
  const now = new Date().toISOString();
  // The rows' instant. `now` stays the real one — it also stamps
  // profiles.updated_at below, which must not be back-dated by an undo.
  const loggedAt = restored ?? now;
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

    /* How much of it, and how much the reader said it was (#104).
     *
     * All three together or none at all, the same all-or-nothing the `ai_*`
     * macros above get, and here it is load-bearing twice over. A qty with no
     * unit is "1 of something unnamed" — the invented portion #58 refuses to
     * draw. A saved qty with no `ai_portion_qty` beside it recreates 0006's
     * forbidden ambiguity exactly: "the reader agreed" and "we never recorded
     * it" would both be null, on the one field that can never be recovered
     * afterwards. And an `ai_portion_qty` with no portion on the row describes
     * nothing that is there.
     *
     * The absent case is a real one and stays legal: a read with no natural
     * amount to count ("had lunch out"), a favorite re-log — the fold has no
     * per-item portion to send — and #16's blank recovery row. */
    const rawPortion = [item?.portion_qty, item?.portion_unit, item?.ai_portion_qty];
    // Resolved first because both quantities are bounded BY it (#109), and
    // both are bounded by the same one — `ai_portion_qty` counts the same
    // thing on the same row, so a unit-aware ceiling that only reached one of
    // them would refuse an honest reading of 200 g while accepting the edit.
    const portionLabel = portionUnit(item?.portion_unit);
    const portion = rawPortion.every((v) => v === undefined || v === null)
      ? null
      : {
          qty: portionQty(item?.portion_qty, portionLabel),
          unit: portionLabel,
          ai_qty: portionQty(item?.ai_portion_qty, portionLabel),
        };
    if (portion && Object.values(portion).some((v) => v === null)) {
      return c.json({ error: "invalid_portion" }, 400);
    }

    rows.push({
      id: crypto.randomUUID(),
      user_id: c.var.user.id,
      logged_on: loggedOn,
      logged_at: loggedAt,
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
      portion_qty: portion?.qty ?? null,
      portion_unit: portion?.unit ?? null,
      ai_portion_qty: portion?.ai_qty ?? null,
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

/** DELETE /api/food-logs (#52): remove one timeline entry.
 *
 *  **An entry is a save, not a row.** One meal is every row sharing a
 *  `logged_at` instant (#10's grouping convention), so the client sends the id
 *  list it already holds from `/api/day` and the whole group goes at once.
 *  Per-item deletion belongs to a future edit sheet, not to a gesture with one
 *  possible outcome.
 *
 *  **`user_id` is on the DELETE itself, not checked before it.** The ids come
 *  from the request, so the scope has to be part of the statement that does the
 *  work — a "does this belong to them" read followed by an unscoped delete is
 *  two statements that can disagree, and this is the one route where the
 *  disagreement destroys data. Someone else's id simply matches nothing.
 *
 *  Deletion recomputes nothing: the day's totals are summed from the rows on
 *  read, and #44's set-once rules are about `logged_on`, which no longer
 *  exists for a deleted row. There is no interaction with the budget engine.
 */
foodLogs.delete("/", async (c) => {
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v) => typeof v === "string") : [];
  if (!ids.length || ids.length !== (body?.ids as unknown[]).length) {
    return c.json({ error: "invalid_fields", fields: ["ids"] }, 400);
  }
  // A gesture deletes one meal. A list this long is a client bug or a probe,
  // and either way is not something to run unbounded against the table.
  if (ids.length > 50) return c.json({ error: "too_many_ids" }, 400);

  const result = await c.var.db
    .deleteFrom("food_logs")
    .where("user_id", "=", c.var.user.id)
    .where("id", "in", ids)
    .executeTakeFirst();

  const deleted = Number(result?.numDeletedRows ?? 0);
  /* 404 on nothing deleted, and it is not pedantry: the undo toast is shown on
     the strength of this response, so "deleted nothing" must not read as
     "deleted it". A double-tap through a slow network is the ordinary way
     here. */
  if (!deleted) return c.json({ error: "not_found" }, 404);

  return c.json({ deleted });
});

export default foodLogs;
