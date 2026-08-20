import type { AnalyzedItem } from "../../shared/api";

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

  const scale = qty / from.qty;
  const scaled: AnalyzedItem = {
    ...item.base,
    calories: Math.round(item.base.calories * scale),
    protein_g: round1(item.base.protein_g * scale),
    carbs_g: round1(item.base.carbs_g * scale),
    fat_g: round1(item.base.fat_g * scale),
    portion: { qty, unit: from.unit },
  };
  return { ...scaled, orig: scaled, base: item.base };
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
 *  idiom `round1` is (six copies, no domain truth to diverge from), not a
 *  second statement of a rule. */
function trimZero(n: number) {
  return String(Math.round(n * 10) / 10);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
