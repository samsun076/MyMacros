/** The portion ceiling, stated once for the Worker (#111).
 *
 *  `MAX_QTY_COUNTED`, `MAX_QTY_MEASURED` and `MEASURED_PORTION_UNITS` restate
 *  `FOOD_LIMITS.portion_qty`, `FOOD_LIMITS.portion_qty_measured` and
 *  `MEASURED_PORTION_UNITS` in `src/client/lib/numeric.ts` and are **not**
 *  shared with them, the same way both routes' 10000 and 1000 restate the kcal
 *  and macro ceilings there. Two statements of one rule is #86's defect, and
 *  this is the deliberate case: FOOD_LIMITS is a client module the Worker must
 *  not import, and moving the table to `src/shared/` would relocate a #95/#96
 *  decision this file has no business reopening. Carried, not derived — say so
 *  if any of it moves, and note that #109 is what the deliberate case costs
 *  when the carried value turns out to be wrong.
 *
 *  **This used to be two copies inside the Worker as well** — `normalize()` in
 *  `routes/analyze.ts` and `portionQty()` in `routes/food-logs.ts` each carried
 *  the list, the normaliser and both numbers, byte-identical. That second split
 *  had no barrier to justify it; it had inherited the first one's argument.
 *  #109 measured the price at three edits and a fourth failure mode if one was
 *  missed. One module under `src/worker/` collapses it with no rule bent and no
 *  bundle cost. `routes/portion-limits.route.test.ts` fails if this and the
 *  client copy disagree. */
export const MAX_QTY_COUNTED = 100;
export const MAX_QTY_MEASURED = 2000;

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
 *  Restated verbatim in `src/client/lib/numeric.ts`. */
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

/** The ceiling for a qty counted in `unit`. The one entry point for both
 *  routes; `portion-limits.route.test.ts` pins it against the client's. */
export function maxPortionQty(unit: string | null | undefined): number {
  const measured =
    typeof unit === "string" && (MEASURED_PORTION_UNITS as readonly string[]).includes(unitKey(unit));
  return measured ? MAX_QTY_MEASURED : MAX_QTY_COUNTED;
}
