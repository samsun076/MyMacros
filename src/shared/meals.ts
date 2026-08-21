/** One save = one meal (#10, #86).
 *
 *  A save writes one `food_logs` row per item, all stamped with the same
 *  `logged_at` instant, and that shared instant is what folds them back into a
 *  single entry. It is how the sketch's combined breakfast row ("Greek yogurt,
 *  blueberries, granola") falls out of per-item rows with no `meal_id` column.
 *
 *  **This lived twice**: the Today timeline folded rows one way and
 *  `GET /api/food-logs/recent` folded them another, with the same key, the
 *  same name-joining and the same sums written out separately on each side.
 *  Nothing made them agree — and the symptom of a drift is not a crash but two
 *  screens quietly disagreeing about what counts as one meal, which is exactly
 *  the shape of #78 and #85. Extracted here so they agree by construction.
 *
 *  Rounding deliberately stays with the callers: the timeline shows whole
 *  grams and the recents list shows tenths, and that is a surface decision
 *  rather than part of what a meal *is*.
 */
import type { MealSlot } from "./api";

/** The columns folding needs. Structural on purpose — both a `food_logs` row
 *  and anything shaped like one can be folded, and neither caller has to hand
 *  over columns this doesn't read. */
export type MealRow = {
  logged_at: string;
  meal_slot: MealSlot;
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type Meal<T extends MealRow> = {
  logged_at: string;
  meal_slot: MealSlot;
  /** "Greek yogurt, blueberries, granola" — the first item keeps its case and
   *  the rest are lowercased, so the join reads as one phrase rather than as a
   *  list of headlines. */
  name: string;
  kcal: number;
  /** Unrounded; both grams and kcal are summed exactly and rounded by whoever
   *  is drawing them. */
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** The rows themselves, for anything folding can't answer — which photo the
   *  meal had, how many items it was. */
  rows: T[];
};

/** Group rows into meals, preserving the order they arrive in.
 *
 *  Keyed on `logged_at` AND `meal_slot`: the instant alone is very nearly
 *  enough, but two saves in the same millisecond would otherwise merge, and a
 *  slot is the one thing a user can change per save. */
export function foldMeals<T extends MealRow>(rows: readonly T[]): Meal<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.logged_at}|${row.meal_slot}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.values()].map((group) => {
    const first = group[0] as T;
    return {
      logged_at: first.logged_at,
      meal_slot: first.meal_slot,
      name: group.map((r, i) => (i === 0 ? r.name : r.name.toLowerCase())).join(", "),
      kcal: group.reduce((s, r) => s + r.kcal, 0),
      protein_g: group.reduce((s, r) => s + r.protein_g, 0),
      carbs_g: group.reduce((s, r) => s + r.carbs_g, 0),
      fat_g: group.reduce((s, r) => s + r.fat_g, 0),
      rows: group,
    };
  });
}

/** The longest name a starred meal is stored under (#12), and the function
 *  that produces it (#103).
 *
 *  **Here rather than inline in `routes/favorites.ts`, because two sides now
 *  need the same answer.** `POST /api/favorites` is idempotent by name and
 *  matches it *exactly* (`name` has no `COLLATE NOCASE`), so a client can only
 *  ask "is this meal already starred?" by comparing against the form the route
 *  stores. A client that trimmed and a route that trimmed *and* sliced would
 *  agree on every meal until a fold ran past the ceiling — and then the star on
 *  the confirm sheet would stop filling for exactly the biggest reads, while
 *  re-tapping it re-posted and silently got the same row back. That is the
 *  dead-button shape #95 was filed about, arriving only for long meals.
 *
 *  It lives beside `foldMeals` because the fold is what produces the name in
 *  the first place: a favourite's name is a folded meal's name. */
export const FAVORITE_NAME_MAX = 120;

export function favoriteName(name: string): string {
  return name.trim().slice(0, FAVORITE_NAME_MAX);
}
