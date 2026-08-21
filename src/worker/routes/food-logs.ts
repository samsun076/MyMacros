import { Hono } from "hono";
import type {
  FoodLogCreate,
  FoodLogUpdate,
  FoodLogsCreated,
  FoodLogsUpdated,
  MealSlot,
  RecentsResponse,
} from "../../shared/api";
import { foldMeals, mealNameKey } from "../../shared/meals";
import { sameMacros, scaleMacros } from "../../shared/portion";
import { insertChunks } from "../db";
import { ownedPhotoKey } from "../photos";
import type { AppEnv } from "../types";
import { isDay, isInstant, isNum, oneOf } from "../validate";

const foodLogs = new Hono<AppEnv>();

/** How many distinct meals "recent" means, and **since #115 this is the only
 *  thing that bounds the recents half of the picks list.**
 *
 *  `mergePicks` used to slice the joined list at eight of its own, which threw
 *  away *favourites* — chosen rows, listed nowhere else in the app — and, past
 *  eight of them, the entire recents half. That slice is gone, so what the
 *  panel shows is what this route sends. The client deliberately does not
 *  restate the number: it would be a second opinion about a length this route
 *  owns, the same way re-sorting would be a second opinion about the order
 *  `orderBy` below already decides. `food-logs.route.test.ts` pins it.
 *
 *  **It counts rows the panel will draw, which it did not before #117.** The
 *  cap used to be spent on starred meals that `mergePicks` then removed, so
 *  starring a recent meal did not move it from the recents half to the
 *  favourites half — it consumed a recents slot and then vanished from it, and
 *  no older meal could slide up because the window had already closed here.
 *  Eight stars emptied the half. Measured in production the morning of
 *  2026-08-21: nine favourites, the eight meals this route returned were all
 *  nine of them (bar one just out of reach), the recents half was empty, and
 *  the panel had shrunk to nine rows that no longer scrolled. */
const RECENTS_MAX = 8;

/** How far back the search for those meals reads, in rows — **a different
 *  quantity from `RECENTS_MAX`, and it needs its own argument** (#117).
 *
 *  One is "how many meals does the panel get"; this is "how much history do we
 *  look through to find them". They were never the same number and the first
 *  never implied the second; before #117 this one was an unnamed `.limit(60)`,
 *  and naming it is the point — it is the next bound down from the one #117
 *  fixed, exactly the way CLAUDE.md's corollary says to expect.
 *
 *  **Sixty, carried and examined rather than inherited.** The exclusion above
 *  makes this bound do real work for the first time: starred meals are by
 *  definition the ones eaten most often, so they are the *densest* rows in any
 *  window, and skipping them spends history faster than the old dedupe did.
 *  Measured against production on 2026-08-21 (read-only pull, 86 rows in the
 *  table): the newest 60 rows fold to 49 meals and 35 distinct names, of which
 *  9 are starred and **26 are not** — better than three times the eight this
 *  route needs. The seeded demo history is the opposite shape, three meals on
 *  repeat for twenty days, and yields 9 distinct in the same 60 rows. Both are
 *  fine, and the second is why the number is not smaller.
 *
 *  **What happens when it is exhausted is the reason it is not larger.** A
 *  window with fewer than `RECENTS_MAX` unstarred meals returns fewer, and that
 *  answer is honest: every meal it skipped is already on the panel, in the
 *  favourites half, one row further up. Nothing is hidden and nothing is lost,
 *  which is precisely what could not be said before #117. The alternative —
 *  read deeper until eight are found — pads the *recents* half with things
 *  eaten two months ago, which is not what the word means, and buys it with an
 *  unbounded scan. */
const SCAN_ROWS = 60;

/** GET /api/food-logs/recent (#12): the last few distinct meals, newest
 *  first, each folded the same way the timeline folds them (rows sharing a
 *  logged_at instant are one meal). Deduped by name so "the usual" shows up
 *  once no matter how often it was logged — and, since #117, deduped against
 *  the caller's *favourites* by the same rule and in the same pass, so a meal
 *  that is already one tap away above never costs a slot down here.
 *
 *  **The exclusion has to happen after the fold, and never in the SQL.**
 *  Excluding rows by name looks equivalent and is not: a meal's name is the
 *  fold of its items ("Grilled chicken breast, jasmine rice, steamed
 *  broccoli"), which is no single row's name, so a `WHERE name NOT IN
 *  (favourites)` would drop one item out of a three-item meal and hand back a
 *  meal with a different name *and* two thirds of its calories. The favourite
 *  is a whole meal; the row is not.
 *
 *  **The client still filters too, and that is not a second opinion** — see
 *  `mealNameKey`, which both sides call. Favourites and recents are two
 *  fetches and starring reloads them one at a time, so for one window the
 *  recents list on screen still carries a meal the favourites list has just
 *  claimed. The route decides what a *slot* is spent on; the client decides
 *  what a *row* is, given two answers of different ages. */
foodLogs.get("/recent", async (c) => {
  const [rows, starred] = await Promise.all([
    c.var.db
      .selectFrom("food_logs")
      .selectAll()
      .where("user_id", "=", c.var.user.id)
      .orderBy("logged_at", "desc")
      .limit(SCAN_ROWS)
      .execute(),
    c.var.db
      .selectFrom("favorites")
      .select("name")
      .where("user_id", "=", c.var.user.id)
      .execute(),
  ]);

  // Folded by the same function the Today timeline folds with (#86) — the two
  // used to carry separate copies of this, which could disagree about what
  // counts as one meal without anything failing.
  //
  // One set, primed with the meals the panel is already showing above (#117).
  // "Already listed" is one idea here, not two: a name skipped because a newer
  // save had it and a name skipped because it is starred take the same branch
  // and neither reaches the counter. That is what makes the cap unspendable on
  // a row nobody will see — not an extra filter, an extra *seed*.
  const seen = new Set<string>(starred.map((f) => mealNameKey(f.name)));
  const meals = [];
  for (const meal of foldMeals(rows)) {
    const dedupe = mealNameKey(meal.name);
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    meals.push({
      name: meal.name,
      kcal: meal.kcal,
      protein_g: round1(meal.protein_g),
      carbs_g: round1(meal.carbs_g),
      fat_g: round1(meal.fat_g),
    });
    if (meals.length >= RECENTS_MAX) break;
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

/** How many foods one meal may hold, and how many ids may name one entry.
 *
 *  Both were literals inside a single handler each until #60 gave them a second
 *  reader — which is the moment #86's rule starts to apply, and the moment a
 *  copy would go on agreeing right up until somebody moved one of them. Both
 *  client sheets cap at the first and refuse to grow past it in the UI as well
 *  — #60's edit sheet and, since #81, the confirm sheet's basket — so the
 *  refusal is a rule the user meets rather than a 400 they discover. They share
 *  one restatement of it, `MAX_MEAL_ITEMS` in `src/client/lib/basket.ts`.
 *
 *  20 is "a plate does not have twenty distinct foods on it"; 50 is #52's, and
 *  is deliberately looser than 20 because it bounds a *probe* rather than a
 *  meal — a list that long is a client bug either way, and the point is only
 *  not to run it unbounded against the table. */
const MAX_ITEMS = 20;
const MAX_IDS = 50;

const slotOf = oneOf(["breakfast", "lunch", "dinner", "snack"] as const);
// the schema's four sources are all writable from M3 — the CHECK constraint
// in migration 0001 already named photo and barcode, so nothing migrates
const sourceOf = oneOf(["text", "favorite", "photo", "barcode"] as const);

/** A scanned code, as `GET /api/barcode/:code` accepts one.
 *
 *  Named because #81 gave it a second caller and not before: the body-level
 *  barcode and a per-item one are the same field at two scopes, and a basket
 *  holding two scans is precisely the case where a copy of this test would
 *  start refusing one code and accepting the other. EAN-8 through GTIN-14. */
function isBarcode(v: unknown): v is string {
  return typeof v === "string" && /^\d{8,14}$/.test(v);
}

/** POST /api/food-logs (#10): the confirm sheet's save. One row per item,
 *  all sharing one `logged_at` instant — that shared instant is what groups
 *  a save back into a single timeline meal entry on the Today screen.
 *
 *  `logged_on` comes from the client, which owns the local day (#44):
 *  midnight cutoff, set once at creation. There is no edit route yet; when
 *  one lands (desktop review surface), it must never recompute `logged_on`.
 *
 *  **One save is still one meal, and since #81 it may be several captures**
 *  (scan the patty, scan the bun, type the mustard). Nothing about the shape
 *  of this handler changed for that and no column moved: `source`, `photo_key`
 *  and `barcode` have been per-row since migration 0001, so all that was
 *  missing was a wire that could say so. Each of the three is read off the item
 *  when the item names it and off the body when it does not — see the block
 *  before `rows.push`, which is also where the per-item photo key meets
 *  `ownedPhotoKey` on its own account. */
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
    if (!isBarcode(body.barcode)) return c.json({ error: "invalid_barcode" }, 400);
    scanned = body.barcode;
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ITEMS) {
    return c.json({ error: "items_required" }, 400);
  }

  /* Provenance is stated by ALL the items or by none of them (#81).
   *
   * The three fields fall back to the body when an item is silent, which is
   * what every single-capture save in the app relies on — but that fallback is
   * only safe while silence means "there is one capture and it is the body's".
   * The middle case is the dangerous one: a basket that states `source: "text"`
   * on the mustard and forgets its `barcode: null` writes a hand-typed row
   * carrying the patty's code, a row claiming to have been scanned. Nothing
   * 400s, nothing looks wrong, and it cannot be repaired afterwards because the
   * capture is gone the moment the sheet closes. That is the collapse #81
   * forbids in as many words, and the column #75's per-source analysis reads.
   *
   * **This is the third instance of a rule this route already keeps twice**,
   * not a new one: the four `ai_*` macros are all-or-nothing and the portion
   * triple is all-or-nothing, both because a record with holes answers its own
   * question for none of the rows it is on. Provenance is the same shape.
   *
   * The compatibility path is untouched and that is the point of stating it
   * this way rather than requiring the fields outright: a save from one capture
   * names none of the three, inherits all three, and is byte-identical to what
   * it sent before this issue. What the guard removes is only the partial
   * statement — which no client produces on purpose, and which is
   * indistinguishable from a client bug when it arrives. */
  const PROVENANCE = ["source", "photo_key", "barcode"] as const;
  const statedOn = (it: unknown) =>
    PROVENANCE.filter((k) => (it as Record<string, unknown> | null)?.[k] !== undefined).length;
  if (body.items.some((it) => statedOn(it) > 0) && body.items.some((it) => statedOn(it) < 3)) {
    return c.json({ error: "invalid_item_provenance", fields: [...PROVENANCE] }, 400);
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

    /* How THIS food was captured (#81) — one meal, several captures.
     *
     * All three columns have been per-row since migration 0001; what #81 adds
     * is a wire that can say so. Scan a patty, scan its bun, type the mustard
     * and one save writes three rows with three sources, two barcodes and no
     * photo — which is a truer record than any single-source save could hold,
     * and is what #75's per-source estimate-quality analysis will read. The
     * issue is explicit that a basket must not be collapsed to one source.
     *
     * **Absent falls back to the body-level value; an explicit `null` means
     * none.** Those are different answers and a mixed basket needs both: the
     * body carries the photographed capture's key so the meal still has a
     * thumbnail, and the hand-typed mustard in the same save has to be able to
     * say the photo does not show it. A save from one capture sends none of
     * these three and takes the body-level value for every row, which is what
     * it did before this issue and is byte-identical to it.
     *
     * **Every per-item key goes through `ownedPhotoKey` on its own.** The R2
     * prefix IS the authorization check (`worker/photos.ts`), and the check
     * done on `body.photo_key` twenty lines up vouches for exactly one string
     * — a key arriving on an item has been through nothing. Same regex for a
     * per-item barcode, for the same reason: a validator that only guards the
     * scope the client happens to use today is not a validator. */
    let itemPhotoKey = photoKey;
    if (item?.photo_key !== undefined) {
      if (item.photo_key === null) itemPhotoKey = null;
      else {
        const owned = ownedPhotoKey(item.photo_key, c.var.user.id);
        if (!owned) return c.json({ error: "invalid_photo_key" }, 400);
        itemPhotoKey = owned;
      }
    }

    let itemBarcode = scanned;
    if (item?.barcode !== undefined) {
      if (item.barcode === null) itemBarcode = null;
      else if (!isBarcode(item.barcode)) return c.json({ error: "invalid_barcode" }, 400);
      else itemBarcode = item.barcode;
    }

    // `sourceOf` returns undefined for anything outside the enum, which is the
    // same refusal the body-level source gets — a row whose provenance is a
    // typo is a row #75 would read as a category it has never seen.
    const itemSource = item?.source === undefined ? source : sourceOf(item.source);
    if (!itemSource) return c.json({ error: "invalid_item_source" }, 400);

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
      source: itemSource,
      // The capture's own, falling back to the save's (#81). It used to be
      // stamped on every row the way `logged_at` is, on the reasoning that one
      // meal has one photo — which is still true of the *meal* and was never
      // true of the *rows*: the fold already picks the first row carrying a
      // key, so a basket where one capture of three was photographed shows its
      // thumbnail without claiming the other two are in the frame.
      photo_key: itemPhotoKey,
      barcode: itemBarcode,
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

  /* Chunked because D1 binds at most 100 parameters per statement and this row
     is 22 columns wide — five foods in one INSERT is a 500, which on this route
     throws away a confirm sheet that exists nowhere but the browser's memory.
     Measured, not read: 1–4 items returned 201 and 5–20 returned 500 before
     this. See `insertChunks`, which reads the width off the row rather than
     restating it, and which is honest about not being atomic. */
  for (const chunk of insertChunks(rows)) {
    await c.var.db.insertInto("food_logs").values(chunk).execute();
  }

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
  if (ids.length > MAX_IDS) return c.json({ error: "too_many_ids" }, 400);

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

/** PATCH /api/food-logs (#60): reopen one saved timeline entry and correct it.
 *
 *  **An entry is a save, not a row** — the same convention #52's DELETE reads.
 *  One meal is every `food_logs` row sharing a `logged_at` instant (#10), so
 *  the client sends the id list it already holds from `/api/day` and this
 *  rewrites the group in place.
 *
 *  **`user_id` is on every statement that writes, not checked before them.**
 *  The ids come from the request, so the scope has to be part of the statement
 *  doing the work — a "does this belong to them" read followed by an unscoped
 *  write is two statements that can disagree. The read below is scoped too, and
 *  it is a read of the caller's own rows for the fields the body is not allowed
 *  to carry; nothing another user owns can enter through it, and nothing it
 *  returns is what authorises the write.
 *
 *  **Two of those scopes look redundant and are not**, which was measured
 *  rather than argued. The id set the DELETE and the UPDATE run against has
 *  already been through the scoped SELECT, so removing `user_id` from either of
 *  them leaves the whole route test suite green — a guard with no test that can
 *  fail, which normally means a guard that is not doing anything. It is doing
 *  something. Remove it from the SELECT alone and the route stops answering
 *  404, but the other user's row is *still untouched*, because the write-side
 *  scope catches what the read let through; remove it from both and the row is
 *  rewritten. So these are a second line rather than decoration, and the pair
 *  of tests that separates those two outcomes ("answers 404 for another user's
 *  row" and "leaves another user's row exactly as it was") is deliberately two
 *  tests for that reason — as one test the second assertion never ran.
 *
 *  **Every id must resolve, and they must all be one entry.** A partial match
 *  means the client's picture of the meal is stale — it was built from
 *  `/api/day`, which is already user-scoped, so the only ways to be short are a
 *  row deleted underneath it or an id that was never ours. Rewriting the group
 *  from a stale list would silently drop whatever the client could not see. A
 *  list spanning two instants is worse: it would merge two meals into one, and
 *  no undo covers that.
 *
 *  **What cannot be edited is what cannot be *said*** — see `FoodLogItemEdit`.
 *  `logged_on` and `logged_at` (#44, and the group key), `source`, `photo_key`,
 *  `barcode`, `confidence` and the four `ai_*` macros have no field on the
 *  wire, so "they survive an edit" is not a rule this handler has to remember.
 *  Each surviving row keeps its own; each added row is #16's blank row.
 *
 *  **`edited` is derived here and never sent.** It answers "did the user
 *  override the AI's numbers?", and this side is the one holding the previous
 *  numbers, so it can answer honestly where a client can only assert. Three
 *  consequences fall straight out of that and all three are the issue's:
 *  changing only the meal slot sets nothing, because a slot is not something
 *  the AI said; a row that was already `edited` stays edited, because
 *  un-setting it would claim the reader had been agreed with; and changing
 *  only a portion sets nothing, because #58 is explicit that eating four
 *  slices instead of two overrides nothing.
 *
 *  **That third one is not free and the first cut of this route got it
 *  wrong.** A portion change rescales the macros before they are sent, so it
 *  reaches this handler looking exactly like a hand-edit; see the long comment
 *  on `explained` below for how the two are told apart and why the arithmetic
 *  had to move into `src/shared/`.
 *
 *  **Nothing recalculates elsewhere.** `/api/day` sums the rows on every mount
 *  (#48) and M4's budget reads the same totals, so a corrected meal is correct
 *  everywhere with no cache to invalidate. Keep it that way.
 *
 *  **The orphaned R2 photo is an accepted leak, and this is the note saying
 *  so.** Removing the last row that carries a `photo_key` — here, or through
 *  #52's delete — leaves the object in R2 with nothing pointing at it. Cleanup
 *  is not implemented and that is a decision, not an oversight: deleting the
 *  object is a write that fails independently of the D1 write, and the failure
 *  that ordering permits is the *bad* direction — photo gone, row still
 *  pointing at it, a 404 on a meal you can see. The leak is 214 KB a shot at
 *  one user. When it is worth paying for, the cheap fix is a sweep that lists
 *  R2 keys under the user's prefix and deletes those matching no `photo_key` —
 *  written down here so it is a known job rather than a later discovery.
 */
/** Every column a PATCH may write, named as a type so the `set()` below cannot
 *  quietly grow a ninth. The list is the guarantee: `logged_on`, `logged_at`,
 *  `source`, `photo_key`, `barcode`, `confidence`, the four `ai_*` and
 *  `ai_portion_qty`/`portion_unit` are absent, and a route that tried to write
 *  one would not compile. */
type RowEdit = {
  meal_slot: MealSlot;
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  portion_qty: number | null;
  edited: number;
  updated_at: string;
};

foodLogs.patch("/", async (c) => {
  const body = await c.req.json<FoodLogUpdate>().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_body" }, 400);

  const mealSlot = slotOf(body.meal_slot);
  if (!mealSlot) return c.json({ error: "invalid_fields", fields: ["meal_slot"] }, 400);

  const ids = Array.isArray(body.ids) ? body.ids.filter((v) => typeof v === "string") : [];
  if (!ids.length || ids.length !== (body.ids as unknown[] | undefined)?.length) {
    return c.json({ error: "invalid_fields", fields: ["ids"] }, 400);
  }
  if (ids.length > MAX_IDS) return c.json({ error: "too_many_ids" }, 400);

  /* The same refusal POST makes, and deliberately the same code (#60).
     An edit that removes every item is a DELETE, and #52's swipe is the
     delete — it has an undo toast and a restore path behind it. Accepting an
     empty list here would be a second way to destroy a meal, with no way
     back, reachable from a sheet whose other controls are all reversible. The
     edit sheet refuses to remove the last row for the same reason and says
     which gesture to use instead. */
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ITEMS) {
    return c.json({ error: "items_required" }, 400);
  }

  const stored = await c.var.db
    .selectFrom("food_logs")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .where("id", "in", ids)
    .execute();
  /* Someone else's id matches nothing, and so does a duplicate — both land here
     as a short read rather than as a special case. `WHERE id IN ('a','a')`
     returns one row, so two of the same id is a length of 2 against a read of
     1. Pinned by a test rather than left as reasoning, because the "rows nobody
     claimed are removed" pass below trusts this: an `ids` list longer than the
     rows it names would let that pass delete the difference.

     **The three writes below are not atomic**, and that is the house pattern
     rather than an oversight — nothing in `src/worker/` uses `batch()` or a
     transaction, and D1's own batching would mean rebuilding this handler
     around a statement list. What a partial failure leaves behind is a
     *coherent* entry rather than a torn one, because the order is chosen for
     it: removals first, then edits, then additions. Fail after the DELETE and
     the entry has lost the items the user removed and kept everything else;
     fail mid-UPDATE and some rows carry the new numbers and some the old; fail
     before the INSERT and the added food is simply missing. In every case the
     day still sums, `foldMeals` still sees one meal, and the fix is to open the
     sheet again — which is this issue's whole point. Nothing is destroyed that
     `logged_at` needed, because `logged_at` is never written. */
  if (stored.length !== ids.length) return c.json({ error: "not_found" }, 404);

  const entry = stored[0] as (typeof stored)[number];
  if (stored.some((r) => r.logged_at !== entry.logged_at || r.meal_slot !== entry.meal_slot)) {
    return c.json({ error: "mixed_entry" }, 400);
  }

  const byId = new Map(stored.map((r) => [r.id, r]));
  const claimed = new Set<string>();
  const now = new Date().toISOString();
  const updates: { id: string; set: RowEdit }[] = [];
  const inserts = [];

  for (const item of body.items) {
    const name = typeof item?.name === "string" ? item.name.trim().slice(0, 120) : "";
    // The same four validators POST writes with, so the two routes cannot
    // disagree about what a kilocalorie is (#86). They are also what makes the
    // `edited` comparison below sound: it compares against the value that will
    // be *written*, not against the one that arrived.
    const kcal = energy(item?.kcal);
    const protein = grams(item?.protein_g);
    const carbs = grams(item?.carbs_g);
    const fat = grams(item?.fat_g);
    if (!name || kcal === null || protein === null || carbs === null || fat === null) {
      return c.json({ error: "invalid_item" }, 400);
    }

    /* No id: an item being ADDED to a saved meal (#60).
     *
     * It is #16's blank recovery row with a meal already around it — nothing
     * read it, so it stores a null confidence, null `ai_*` and no portion, and
     * `edited` is 0 because there was nothing to override. `source` is `text`
     * rather than the entry's: the meal was photographed, this food was typed,
     * and claiming otherwise would put a hand-typed row into #75's
     * estimate-quality analysis as though a reader had proposed it. It gets no
     * `photo_key` for the same reason — the photo does not show it — and the
     * timeline still draws the meal's thumb, which comes from whichever row
     * carries the key rather than from all of them. */
    if (item?.id === undefined) {
      // A portion nobody read is the invented "1 serving" #58 refuses to draw.
      if (item?.portion_qty !== undefined) return c.json({ error: "invalid_portion" }, 400);
      inserts.push({
        id: crypto.randomUUID(),
        user_id: c.var.user.id,
        logged_on: entry.logged_on,
        logged_at: entry.logged_at,
        meal_slot: mealSlot,
        name,
        kcal,
        protein_g: protein,
        carbs_g: carbs,
        fat_g: fat,
        source: "text" as const,
        photo_key: null,
        barcode: null,
        confidence: null,
        edited: 0,
        ai_kcal: null,
        ai_protein_g: null,
        ai_carbs_g: null,
        ai_fat_g: null,
        portion_qty: null,
        portion_unit: null,
        ai_portion_qty: null,
      });
      continue;
    }

    const row = typeof item.id === "string" ? byId.get(item.id) : undefined;
    // An id outside the entry, or the same row claimed twice. Either one would
    // make the "rows not claimed are removed" pass below delete something the
    // client never asked about.
    if (!row || claimed.has(item.id)) return c.json({ error: "invalid_item_id" }, 400);
    claimed.add(item.id);

    /* The portion, and the two thirds of it that are not editable (#104/#58).
     *
     * `portion_unit` is a LABEL the reader chose and the sheet renders it as
     * text, so there is nothing to edit; `ai_portion_qty` is what the reader
     * counted and rewriting it would destroy the only record of the estimate
     * this column exists for. Only the user's own count moves.
     *
     * The bound comes from the row's STORED unit (#109), never from the body:
     * 200 g is honest and 200 slices is a slipped thumb, and the unit deciding
     * that is the one already on the row. */
    let portionQtyValue = row.portion_qty;
    if (item.portion_qty !== undefined) {
      if (row.portion_qty === null || row.portion_unit === null) {
        return c.json({ error: "invalid_portion" }, 400);
      }
      const qty = portionQty(item.portion_qty, row.portion_unit);
      if (qty === null) return c.json({ error: "invalid_portion" }, 400);
      portionQtyValue = qty;
    }

    /* Did the user override the reader, or did they just say how much they
     * ate? (#58, #60)
     *
     * **The macros always move when a portion moves**, which is what makes
     * this two questions rather than one. The edit sheet rescales linearly
     * from the stored row the moment the HOW MUCH field is touched — two
     * slices at 360 kcal becomes four at 720 — so by the time the numbers
     * arrive here, "I ate twice as much" and "the reader was 360 kcal out"
     * look identical on the wire. Comparing macros alone therefore records
     * every honest portion correction as an override, on the one column that
     * says whether the reader needed correcting, and in the direction that
     * makes the reader look worse than it is. It shipped that way for the
     * length of one review and was found by driving the route.
     *
     * So the test is whether the new portion **explains** the new macros:
     * recompute what the sheet's own rescale would have produced from the
     * stored row at the new quantity, and treat an exact match as no
     * correction at all. Anything else — a portion change *and* a hand-edit in
     * the same save — is still a correction, which is right: the part that is
     * not explained by the rescale is exactly the part the user typed.
     *
     * **`scaleMacros` is the sheet's own function**, in `src/shared/`, called
     * by `setPortionQty` on the way out and by this on the way in (#86). That
     * is not tidiness: an equality between two implementations of one rounding
     * rule is an equality that fails by one, and a 1 kcal gap here is not
     * cosmetic — it is an honest portion change filed as an override. One
     * function means both sides run the same instructions on the same doubles,
     * so the comparison can be exact with no tolerance. A tolerance would be
     * the same lie in the other direction: a hand-edit inside the window
     * recorded as a portion change.
     *
     * The name is outside all of this. Renaming a food is an override of what
     * the reader said it was, whatever happened to the amount. */
    const rescaled =
      row.portion_qty !== null && portionQtyValue !== null && portionQtyValue !== row.portion_qty
        ? scaleMacros(
            {
              kcal: row.kcal,
              protein_g: row.protein_g,
              carbs_g: row.carbs_g,
              fat_g: row.fat_g,
            },
            row.portion_qty,
            portionQtyValue,
          )
        : null;
    const explained =
      rescaled !== null &&
      sameMacros(rescaled, { kcal, protein_g: protein, carbs_g: carbs, fat_g: fat });
    const corrected =
      name !== row.name ||
      (!explained &&
        (kcal !== row.kcal ||
          protein !== row.protein_g ||
          carbs !== row.carbs_g ||
          fat !== row.fat_g));
    const edited = row.edited === 1 || corrected ? 1 : 0;

    /* A PATCH that changes nothing writes nothing, so `updated_at` goes on
       meaning "this row last changed" rather than "somebody last opened the
       sheet". The diff is free — `corrected` above already computes most of
       it for `edited`. */
    const same =
      !corrected &&
      row.meal_slot === mealSlot &&
      row.portion_qty === portionQtyValue &&
      row.edited === edited;
    if (same) continue;

    updates.push({
      id: row.id,
      set: {
        meal_slot: mealSlot,
        name,
        kcal,
        protein_g: protein,
        carbs_g: carbs,
        fat_g: fat,
        portion_qty: portionQtyValue,
        edited,
        updated_at: now,
      },
    });
  }

  // Rows the item list no longer claims. This is #60's per-item delete, which
  // #52 deferred to exactly here: the swipe removes a whole entry and has an
  // undo, and removing one item of a three-item meal is this sheet's job.
  const removed = stored.filter((r) => !claimed.has(r.id)).map((r) => r.id);

  if (removed.length) {
    await c.var.db
      .deleteFrom("food_logs")
      .where("user_id", "=", c.var.user.id)
      .where("id", "in", removed)
      .execute();
  }
  for (const u of updates) {
    await c.var.db
      .updateTable("food_logs")
      .set(u.set)
      .where("user_id", "=", c.var.user.id)
      .where("id", "=", u.id)
      .execute();
  }
  if (inserts.length) {
    // Same ceiling as POST's, and reachable here by adding five rows to a saved
    // meal in one pass of the edit sheet (#60) — the sheet's Add button has no
    // limit short of `MAX_ITEMS`.
    for (const chunk of insertChunks(inserts)) {
      await c.var.db.insertInto("food_logs").values(chunk).execute();
    }
  }

  /* Read back by id rather than by the group key: these are exactly the rows
     this request left behind, where `logged_at = ? AND meal_slot = ?` would
     also sweep in anything else that happened to land on the same instant.

     `logged_at asc` is POST's ORDER BY, and inside one entry it is a tie — so
     the row order here is the plan's, not a promise. That is fine and is worth
     saying rather than leaving to be discovered: the timeline's own order
     comes from `/api/day`, which re-reads on every mount (#48) through the
     `(user_id, logged_on)` index and therefore hands the fold its rows in
     table order — surviving rows where they were, added rows last. Measured
     against local D1, not assumed. Nothing renders *this* response's order. */
  const kept = [...claimed, ...inserts.map((r) => r.id)];
  const logs = await c.var.db
    .selectFrom("food_logs")
    .selectAll()
    .where("user_id", "=", c.var.user.id)
    .where("id", "in", kept)
    .orderBy("logged_at", "asc")
    .execute();

  return c.json<FoodLogsUpdated>({ logs });
});

export default foodLogs;
