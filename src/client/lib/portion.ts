import type { AnalyzedItem, FoodLog } from "../../shared/api";
import { scaleMacros } from "../../shared/portion";
import { FOOD_LIMITS } from "./numeric";

/** Scaling one item's portion on the confirm sheet (#58).
 *
 *  The complaint: you photograph a pizza, the read says two slices, you ate
 *  four, and the only way to say so is to retype four macro numbers. The fix
 *  is arithmetic the client already knows how to do — the barcode path's grams
 *  field has rescaled linearly from a pristine copy since #15 — applied **per
 *  item** rather than per read, because a photo splits into distinct foods and
 *  doubling the fries must not double the burger.
 *
 *  It lives here rather than inside `Log.tsx` for #100's reason: behaviour
 *  reachable only by rendering a component is behaviour the unit project
 *  cannot test, and the property that matters most here — that repeated
 *  adjustment does not drift — is invisible to a screenshot and to a single
 *  round of tapping.
 */

/** One row of the confirm sheet, and the two shadow copies it carries.
 *
 *  **`orig` is what the reader proposed** (#16/#76): `isEdited` compares
 *  against it, and the save route ships it as `ai_*` so a row can distinguish
 *  "the reader agreed" from "we never recorded it". It is deliberately *moved*
 *  by a portion change — see below.
 *
 *  **`base` is the as-read item, and nothing ever mutates it.** Every rescale
 *  starts from `base`, never from the current numbers, which is what makes
 *  2 → 4 → 2 return the original figures exactly instead of compounding a
 *  rounding error per tap. `base.portion.qty` is also the as-read quantity —
 *  the divisor — so there is no second field to keep in step with it. */
export type EditableItem = AnalyzedItem & { orig: AnalyzedItem; base: AnalyzedItem };

/** Attach the two shadow copies to a freshly-read item. */
export function editable(item: AnalyzedItem): EditableItem {
  return { ...item, orig: item, base: item };
}

/** Did the user override the reader's numbers? — the definition of the
 *  `edited` column, in one place (#59).
 *
 *  It lived inside `Log.tsx` until this issue, which was fine while the only
 *  question was "did somebody type over a field". #59 adds a second way for an
 *  item's numbers to change without anybody overriding anything — a re-read of
 *  the same photo, where the AI is correcting *itself* at the user's request —
 *  so the claim "a re-read does not set `edited`" is now a property of
 *  `reread` in `lib/basket.ts` and needs an oracle that is not the component.
 *  `portion.test.ts` restated the rule locally rather than import it across
 *  that boundary; it imports it now.
 *
 *  Deliberately about the five fields a person can type over and nothing else:
 *  `portion` is absent because a portion change is not a correction (#58) and
 *  `setPortionQty` moves `orig` with it, and `confidence` is absent because it
 *  is the reader's own claim and no control writes it. */
export function isEdited(item: EditableItem): boolean {
  return (
    item.name !== item.orig.name ||
    item.calories !== item.orig.calories ||
    item.protein_g !== item.orig.protein_g ||
    item.carbs_g !== item.orig.carbs_g ||
    item.fat_g !== item.orig.fat_g
  );
}

/** Turn a SAVED row back into a sheet row (#60).
 *
 *  The edit sheet opens on rows that are already in D1, so the same
 *  `EditableItem` the confirm sheet edits has to be reconstructible from a
 *  `food_logs` row. It is the inverse of the save, minus everything the save
 *  recorded that an edit may not touch.
 *
 *  **`base` is the STORED item, not the reader's**, and the difference is the
 *  whole of what this function decides. `base` is the divisor every rescale
 *  works from, and what the stored macros describe is the stored
 *  `portion_qty` — 330 kcal is what 200 g of this chicken *was*, whatever the
 *  reader originally counted. Seeding it from `ai_portion_qty` instead would
 *  scale 330 kcal as though it described the reader's count, so a row saved at
 *  200 g and reopened would double the moment anybody touched the control.
 *  The reader's own count is not lost by this — the route preserves
 *  `ai_portion_qty` and the sheet never sends it.
 *
 *  **All three portion columns or nothing** (#104/#58). A row with only some of
 *  them is a shape the save route cannot produce, and inventing a unit for a
 *  qty — or a "1 serving" for a row that has neither — is exactly what #58
 *  refuses. That row simply draws no portion control, the same as #16's blank
 *  row and every favorite re-log.
 *
 *  Here rather than inside the sheet for #100's reason: a decision reachable
 *  only by rendering a component is one the unit project cannot test, and this
 *  one is invisible to a screenshot — the wrong `base` renders identically and
 *  only misbehaves on the second tap. */
export function editableFromLog(row: FoodLog): EditableItem {
  const item: AnalyzedItem = {
    name: row.name,
    calories: row.kcal,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
    confidence: row.confidence,
    portion:
      row.portion_qty !== null && row.portion_unit !== null
        ? { qty: row.portion_qty, unit: row.portion_unit }
        : null,
  };
  return editable(item);
}

/** The row #60's edit sheet ADDS to a saved meal: empty, and deliberately the
 *  same empty as #16's recovery row.
 *
 *  No confidence and no portion, because nothing read it — which is also why
 *  the PATCH route stores it with null `ai_*` and `source: "text"`. A blank row
 *  that arrived with a portion control would be offering to scale a number
 *  nobody has typed yet. */
export function blankItem(): EditableItem {
  return editable({ name: "", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, confidence: null });
}

/** Rescale one item to `qty` of its own unit.
 *
 *  **A portion change is not a correction**, so `orig` moves with the scaled
 *  values and `isEdited` stays false. `edited` answers "did the user override
 *  the AI's numbers?", and saying you ate four slices instead of two overrides
 *  nothing — the reader was right about a slice.
 *
 *  **A row with no portion is a no-op.** The model returns none for a vague
 *  log ("had lunch out"), that row draws no control, and nothing here invents
 *  a basis to scale from.
 *
 *  Everything the item carries that isn't a macro — `name`, `confidence` —
 *  comes back from `base` too, which means a hand-edit made *before* a portion
 *  change is discarded. That is exactly what the shipped grams field does
 *  (`setGrams` rebuilds each row from `r.base`), and the alternative is worse:
 *  scaling macros the user has already overridden multiplies their correction
 *  by the ratio, silently. */
export function setPortionQty(item: EditableItem, qty: number): EditableItem {
  const from = item.base.portion;
  if (!from || !item.portion) return item;
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(from.qty) || from.qty <= 0) return item;

  /* The arithmetic itself lives in `src/shared/portion.ts` since #60, and not
     for tidiness: `PATCH /api/food-logs` has to recompute exactly this to tell
     "I ate four slices" from "the reader was 80 kcal out", and a comparison
     between two implementations of one rounding rule is a comparison that
     fails by one. Both sides now run the same instructions on the same
     doubles. */
  const scaled: AnalyzedItem = {
    ...item.base,
    ...macrosOf(scaleMacros(baseMacros(item.base), from.qty, qty)),
    portion: { qty, unit: from.unit },
  };
  return { ...scaled, orig: scaled, base: item.base };
}

/** `AnalyzedItem` spells energy `calories` and every column and wire field in
 *  the app spells it `kcal`. These two map between them, in the one place the
 *  sheet touches the shared scaling rule — a rename of the field on
 *  `AnalyzedItem` is a bigger change than this issue, and an unmapped mismatch
 *  would be a silent `NaN`. */
function baseMacros(it: AnalyzedItem) {
  return { kcal: it.calories, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g };
}

function macrosOf(m: ReturnType<typeof scaleMacros>) {
  return m === null
    ? {}
    : { calories: m.kcal, protein_g: m.protein_g, carbs_g: m.carbs_g, fat_g: m.fat_g };
}

/** The three columns a save writes for this row's portion (#104), or `null`
 *  when there is no portion to record.
 *
 *  **`ai_portion_qty` comes from `base`, never from `orig`**, and that one
 *  line is the whole reason the column exists. `setPortionQty` above *moves*
 *  `orig` with the scaled values so `isEdited` stays false — so after a
 *  rescale `orig.portion.qty` is the number the **user** chose, and shipping
 *  it would store "the reader said four" on the row where the reader said two.
 *  `base` is the as-read item and nothing ever mutates it, which makes it the
 *  only surviving copy of what the model actually counted.
 *
 *  **Here rather than inline in `Log.tsx`'s save()** for #100's reason: a
 *  decision reachable only by rendering a component is a decision the unit
 *  project cannot test, and this one is invisible to a screenshot — an
 *  `orig`-based implementation produces a perfectly well-formed row that is
 *  wrong about the only question it was written to answer.
 *
 *  Null when the read proposed no portion ("had lunch out"), which is also
 *  every #16 blank row and every favorite re-log — nothing invents one. */
export function savedPortion(item: EditableItem) {
  const now = item.portion;
  const read = item.base.portion;
  if (!now || !read) return null;
  return { portion_qty: now.qty, portion_unit: now.unit, ai_portion_qty: read.qty };
}

/** The label a gram weight is stored under (#107).
 *
 *  **It has to stay a MEASURED unit.** The save route picks the qty ceiling off
 *  this string (#109): a label outside `MEASURED_PORTION_UNITS` bounds the
 *  number beside it at 100, and every honest 150 g save would be refused. The
 *  pairing is asserted in `portion.test.ts` rather than left to reading. */
const GRAMS_UNIT = "g";

/** The three columns a save writes for a BARCODE read's grams (#107), or
 *  `null` when there is nothing to record.
 *
 *  **Per read, not per item, and that is deliberate.** `grams` lives on the
 *  read because a barcode read is one product — one field, one number, every
 *  row of the sheet rescaled by it. So every row of a barcode save carries the
 *  **same** `portion_qty`, which will look odd to whoever reads the table next
 *  and is correct: there is one amount, because there is one thing. #58's
 *  per-item control answers a different question ("how many of these four
 *  foods"), and the two are not unified — #15's reasons, restated in #107.
 *
 *  **`ai_portion_qty` is `baseGrams`, never `grams`**, and that one line is
 *  the whole reason this function exists rather than an object literal at the
 *  call site. It is `savedPortion`'s trap one level up: `setGrams` rescales
 *  every row from `read.base`/`read.baseGrams` and rebuilds each one with
 *  `editable(scaled)`, which moves **both** shadow copies — so after a single
 *  adjustment a row's `orig` *and* its `base` describe the scaled figures, and
 *  the as-read amount survives nowhere but `read.baseGrams`. Sending `grams`
 *  for both would record "the reader said 150" about a read that arrived at
 *  100: a well-formed row, wrong about the only question the column answers,
 *  and unfixable afterwards because the read is gone the moment the sheet
 *  closes.
 *
 *  **A quantity the field itself would refuse is withheld, not clamped.** The
 *  typed value is always in range — `NumericField` clamps at commit — but the
 *  as-read default is not the field's number: `defaultGrams` in
 *  `routes/barcode.ts` hands back whatever OpenFoodFacts' contributor-entered
 *  `serving_quantity` says, and `Math.round` of a sub-gram serving is 0.
 *  Sending either would 400 the entire save (`invalid_portion`) and turn a
 *  meal that logs today into one that cannot be logged at all — a worse bug
 *  than the one this fixes. Null here means what null has always meant on
 *  these columns: **not recorded**, exactly the state every barcode row was in
 *  before this. Clamping is not the alternative on the table; #109 is the
 *  record of what a clamped number costs in a column nobody can repair. */
export function savedGrams(read: { grams?: number; baseGrams?: number }) {
  const { grams, baseGrams } = read;
  if (grams === undefined || baseGrams === undefined) return null;
  if (!withinGrams(grams) || !withinGrams(baseGrams)) return null;
  return { portion_qty: grams, portion_unit: GRAMS_UNIT, ai_portion_qty: baseGrams };
}

function withinGrams(n: number) {
  return Number.isFinite(n) && n >= FOOD_LIMITS.grams.min && n <= FOOD_LIMITS.grams.max;
}

/** What the collapsed row says about the portion: `4 SLICES`, `1.5 CUPS`.
 *
 *  Pluralisation is the model's job, not this function's — `unit` arrives as a
 *  label the reader chose ("slices", "bowl", "g") and second-guessing it here
 *  would need a table of English plurals to get "1 slices" right, which is a
 *  worse bug than the one it fixes. */
export function portionLabel(portion: AnalyzedItem["portion"]): string | null {
  if (!portion) return null;
  return `${trimZero(portion.qty)} ${portion.unit}`.toUpperCase();
}

/** `1.5` stays `1.5`; `4.0` is `4`. `formatNumeric` already does this for the
 *  field — this is the same rule for read-only text, and it is the language
 *  idiom `round1` is (a handful of copies, no domain truth to diverge from —
 *  this file's own went with the arithmetic that moved to `shared/portion.ts`),
 *  not a
 *  second statement of a rule. */
function trimZero(n: number) {
  return String(Math.round(n * 10) / 10);
}
