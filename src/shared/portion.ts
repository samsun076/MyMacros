/** What scaling a portion does to the numbers beside it — **stated once**
 *  (#58, #104, #60).
 *
 *  Saying you ate four slices instead of two multiplies every macro by two.
 *  That arithmetic had one reader for as long as it lived only on the confirm
 *  sheet (`setPortionQty` in `src/client/lib/portion.ts`). #60 gave it a second
 *  one on the far side of the wire, and for a reason that makes an *exact*
 *  agreement load-bearing rather than merely tidy:
 *
 *  **`PATCH /api/food-logs` decides whether a macro change was a correction by
 *  asking whether the portion change already explains it.** A portion change is
 *  deliberately not an edit (#58 — the reader was right about a slice), but by
 *  the time the numbers reach the Worker they have already been rescaled, so
 *  the only way to tell "four slices" from "the reader was 80 kcal out" is to
 *  recompute what the rescale *would* have produced and compare. If the two
 *  sides rounded even slightly differently, an honest portion change would come
 *  back `edited = 1` — a false statement about the one column that records
 *  whether the reader needed correcting, and one that makes the reader look
 *  worse than it is.
 *
 *  So this is not a shared helper for tidiness. It is here because a
 *  *comparison* between two implementations of one rule is a comparison that
 *  fails by one, and CLAUDE.md's rule 4b already records what a 1 kcal gap
 *  costs when it gets waved through as rounding. One function means the
 *  question "did the client and the server round the same way?" cannot be
 *  answered wrongly: they run the same instructions on the same doubles.
 *
 *  In `src/shared/` for exactly the reason that directory exists — a quantity
 *  both the client preview and the Worker must agree on. It is the first
 *  portion rule to earn a place there; `FOOD_LIMITS` and `MEASURED_PORTION_UNITS`
 *  stay carried-and-restated (see `src/worker/portion-limits.ts`) because those are bounds
 *  each side enforces independently, where this is an equality each side has to
 *  reproduce.
 */

/** The four numbers a portion scales. `kcal` rather than `calories` because
 *  that is what the column is called and what the wire carries; the confirm
 *  sheet's `AnalyzedItem` spells it the other way and maps at the call site. */
export type Macros = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

/** `from` scaled from `fromQty` to `toQty`, or `null` when there is no basis to
 *  scale from.
 *
 *  **kcal is a whole number and the three macros are 1dp**, which is what the
 *  columns hold and what every other write in this app quantises to
 *  (`energy()` and `grams()` in `routes/food-logs.ts`). The rounding happens
 *  once, here, on the product — never on an intermediate — so repeated
 *  adjustment cannot compound: every rescale starts from the same pristine
 *  `from`, which is the property `portion.test.ts` pins.
 *
 *  Null for a non-finite or non-positive quantity on either side. A zero
 *  divisor is a divide-by-zero and a zero target is a field being cleared,
 *  which has its own answer (see `FOOD_LIMITS.portion_qty`'s `min`). */
export function scaleMacros(from: Macros, fromQty: number, toQty: number): Macros | null {
  if (!Number.isFinite(fromQty) || fromQty <= 0) return null;
  if (!Number.isFinite(toQty) || toQty <= 0) return null;
  const scale = toQty / fromQty;
  return {
    kcal: Math.round(from.kcal * scale),
    protein_g: round1(from.protein_g * scale),
    carbs_g: round1(from.carbs_g * scale),
    fat_g: round1(from.fat_g * scale),
  };
}

/** True when `a` and `b` are the same four numbers.
 *
 *  Exact, with no tolerance, and that is safe *because* of the paragraph at the
 *  top of this file: both sides reach these values through `scaleMacros`, so
 *  the only way they differ is that somebody really did type a different
 *  number. A tolerance here would be a window in which a hand-edit is recorded
 *  as a portion change, which is the same lie in the other direction. */
export function sameMacros(a: Macros, b: Macros): boolean {
  return a.kcal === b.kcal && a.protein_g === b.protein_g && a.carbs_g === b.carbs_g && a.fat_g === b.fat_g;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
