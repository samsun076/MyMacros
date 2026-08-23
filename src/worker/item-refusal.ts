/** Why an item was refused, in terms the sheet can point at (#113).
 *
 *  **The defect this exists for.** Type `2000` into HOW MUCH for Nutella and
 *  the row computes 10,780 kcal. `energy()`'s ceiling is 10,000, so
 *  `POST /api/food-logs` refused the whole save with `{"error":"invalid_item"}`
 *  — naming no field, on a sheet where the last thing the person touched was
 *  the portion. #95's finding was that a correction nobody can see is the
 *  reported bug wearing a different hat; a refusal nobody can attribute is the
 *  same shape.
 *
 *  **The route is the only side that can say this.** `FOOD_LIMITS.grams.max`
 *  (2,000) and `FOOD_LIMITS.kcal.max` (10,000) do not know each other exists,
 *  and the portion **multiplies into** the thing the second one bounds — so
 *  the effective portion ceiling is a *product*: 2,000 g for a lettuce, about
 *  1,850 g for Nutella at 539 kcal/100 g, lower the denser the product. Only
 *  the code holding both bounds at once knows which one fired and what put the
 *  item past it.
 *
 *  **The unreachable band is NOT a defect and must not be "fixed".** It sits
 *  entirely inside the region both ceilings already agree is a typo — nobody
 *  eats 1,850 g of Nutella — and narrowing either bound to make the pair
 *  consistent would refuse honest input to tidy up a case nobody reaches. Both
 *  numbers are correct as they stand. **The defect is the reporting, and only
 *  the reporting.** Say so here, because the next reader of #113 will be
 *  tempted by the arithmetic.
 *
 *  **A pure module beside `validate.ts` rather than a function inside
 *  `routes/food-logs.ts`**, so the decision has a unit oracle: that file
 *  reaches drizzle through `../db`, and a rule reachable only by booting
 *  workerd is a rule most runs will not exercise. The route tests still drive
 *  it end to end — this proves the classification, those prove the route calls
 *  it.
 */

/** The four bounded figures, in the order they are reported. */
export const BOUNDED_FIELDS = ["kcal", "protein_g", "carbs_g", "fat_g"] as const;
export type BoundedField = (typeof BOUNDED_FIELDS)[number];

export type ItemRefusal =
  /** The item is unusable and the portion has nothing to do with it. What
   *  every refusal on this path said before #113, and still the answer
   *  whenever attributing it to the portion would be a guess. */
  | { error: "invalid_item" }
  /** An energy or macro figure is out of range on an item that states a
   *  portion, so the portion is what put it there. `fields` is what the client
   *  points at; `over` is which ceiling actually fired. */
  | { error: "item_over_limit"; fields: ["portion_qty"]; over: BoundedField };

/** Which refusal an out-of-range item earns.
 *
 *  **`portioned` is the load-bearing input, and #113 proved why it has to be.**
 *  Posting the same over-limit item *without* the three portion columns
 *  returns the identical `invalid_item` — that is how the issue established
 *  the defect was pre-existing rather than introduced by #107. An item with no
 *  portion has no field to blame: the number itself is the complaint, and
 *  saying "your portion did this" about a save that stated no portion would be
 *  a worse error message than the generic one, not a better one.
 *
 *  **A missing name outranks everything**, because it is the more actionable
 *  complaint and it is not something a portion can cause. Same for a refusal
 *  with no bound fired at all (a malformed `confidence`, say): there is
 *  nothing to attribute, so nothing is attributed.
 *
 *  **The first field in `BOUNDED_FIELDS` order wins when several are over**,
 *  stated rather than left to fall out: a portion large enough to break the
 *  kcal ceiling will usually break a macro ceiling too, and an error whose
 *  wording depended on iteration order would read as flaky to whoever hit it
 *  twice. kcal first because it is the figure the sheet's own footer shows.
 */
export function itemRefusal({
  named,
  over,
  portioned,
}: {
  named: boolean;
  over: readonly BoundedField[];
  portioned: boolean;
}): ItemRefusal {
  if (!named || over.length === 0 || !portioned) return { error: "invalid_item" };
  const first = BOUNDED_FIELDS.find((f) => over.includes(f));
  if (!first) return { error: "invalid_item" };
  return { error: "item_over_limit", fields: ["portion_qty"], over: first };
}
