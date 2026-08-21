import type { Favorite, MealSlot, RecentMeal } from "../../shared/api";
import { favoriteName, foldMeals } from "../../shared/meals";

/** The "picks" list: starred meals first, then recent ones that aren't
 *  already starred (#12, lifted out of Log.tsx by #82).
 *
 *  It moved out here because #82 gave it a second placement — the camera
 *  deck's pull-up panel as well as TEXT's inline list — and a merge computed
 *  twice is the register's own defect. One function, one component, two
 *  places that render it.
 *
 *  Neither input is sorted here, deliberately. `/api/favorites` returns
 *  most-used first (that is what `favorites_user_use_idx` is for) and
 *  `/api/food-logs/recent` returns newest first; re-sorting on the client
 *  would be a second opinion about an order the routes already own. This
 *  function's whole job is the *join*: favourites ahead of recents, the
 *  overlap removed, and a cap.
 */
export type Pick = { meal: RecentMeal; favorite: Favorite | null };

/** As many as the screen is worth. Eight fills TEXT's list without pushing the
 *  text box off the top, and fills the panel without turning it into a scroll
 *  chore — carried over from #12's implementation unchanged, and named here so
 *  the two placements cannot disagree about it. */
export const PICKS_MAX = 8;

/** A `Favorite` is structurally a `RecentMeal` plus its own bookkeeping, so a
 *  starred pick carries the favourite itself as its meal — that is what lets
 *  `favorite.id` ride along to `/api/food-logs` and bump `use_count`. */
export function mergePicks(
  favorites: readonly Favorite[] | null | undefined,
  recents: readonly RecentMeal[] | null | undefined,
): Pick[] {
  const favs: Pick[] = (favorites ?? []).map((f) => ({ meal: f, favorite: f }));
  // Case-insensitive: "Greek yoghurt" starred should hide "greek yoghurt" from
  // the recents half rather than listing the same meal twice.
  const starred = new Set(favs.map((p) => p.meal.name.toLowerCase()));
  const rest: Pick[] = (recents ?? [])
    .filter((m) => !starred.has(m.name.toLowerCase()))
    .map((meal) => ({ meal, favorite: null }));
  return [...favs, ...rest].slice(0, PICKS_MAX);
}

/** One row of the confirm sheet, as far as starring cares. Structural on
 *  purpose, like `MealRow` — `EditableItem` carries two shadow copies and a
 *  confidence this has no opinion about. `calories`, not `kcal`: that is the
 *  name the sheet's items use, and renaming it at the boundary is this
 *  function's job rather than the caller's. */
type DraftItem = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

/** Exactly the body `POST /api/favorites` takes. */
export type FavoriteDraft = {
  name: string;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

/** `foldMeals` keys on `logged_at|meal_slot`, and one read is one save — so
 *  every row below is handed the SAME key and the fold returns exactly one
 *  meal. The values are arbitrary and never leave this function; the only
 *  thing that matters is that they are identical across the rows. */
const DRAFT_KEY: { logged_at: string; meal_slot: MealSlot } = {
  logged_at: "",
  meal_slot: "snack",
};

/** The one meal a sheetful of read items would be starred as (#103).
 *
 *  A photo read is N items and `favorites` is one row per meal, so the star has
 *  to collapse N into one — and **`foldMeals` already owns that collapse**
 *  (#86). It is where the recents half of this very list gets its names: a
 *  `"Salmon, potatoes, salad"` row is a fold, not an item. So this adapts the
 *  *input* to `foldMeals` and reads the answer off it; the join, the ", " and
 *  the lowercasing of everything after the first name are not restated here.
 *
 *  **Unnamed rows are dropped, not folded.** #16's recovery sheet opens on a
 *  blank row and the save button lets a meal through as long as *one* row is
 *  named — fold the blank one in and the favourite is called `"Chicken, "`.
 *  Null when nothing named is left, which is what the star's `disabled` reads,
 *  so a blank sheet cannot post junk in two independent ways.
 *
 *  **The name comes back in the form the store will hold it in.** `favoriteName`
 *  is the route's own trim and ceiling, so "is this already starred?" is a
 *  string comparison against `/api/favorites` rather than a guess about what
 *  the route did to the name on the way in.
 *
 *  Nothing is rounded: `POST /api/favorites` rounds kcal and the three macros
 *  itself, and a second rounding rule on this side is a second rounding rule. */
export function favoriteDraft(items: readonly DraftItem[]): FavoriteDraft | null {
  const named = items.filter((it) => it.name.trim() !== "");
  if (named.length === 0) return null;

  const [meal] = foldMeals(
    named.map((it) => ({
      ...DRAFT_KEY,
      // Trimmed per row, so the fold's separators are the only spaces in the
      // join and `favoriteName`'s trim has nothing left to do at the ends.
      name: it.name.trim(),
      kcal: it.calories,
      protein_g: it.protein_g,
      carbs_g: it.carbs_g,
      fat_g: it.fat_g,
    })),
  );
  if (!meal) return null;

  const name = favoriteName(meal.name);
  if (!name) return null;
  return {
    name,
    kcal: meal.kcal,
    protein_g: meal.protein_g,
    carbs_g: meal.carbs_g,
    fat_g: meal.fat_g,
  };
}

/** The favourite `POST /api/favorites` would find for this name, or null.
 *
 *  **Case-sensitive, and deliberately not the rule `mergePicks` uses ten lines
 *  up.** They answer different questions. That one is a *display* dedupe —
 *  "don't list the same meal twice" — and being lenient there costs nothing.
 *  This one answers "would the route treat a star of this meal as the row it
 *  already has?", and the route's answer is `where("name", "=", name)` against
 *  a column with no `COLLATE NOCASE`. Matching case-insensitively here would
 *  draw a filled star over a meal that starring would create a *second* row
 *  for, which is the one thing the star must not do.
 *
 *  Undefined while `/api/favorites` is still in flight — the normal first
 *  render, not an edge case — and an unknown meal is not starred either way,
 *  so both answer null. */
export function favoriteNamed(
  favorites: readonly Favorite[] | null | undefined,
  name: string,
): Favorite | null {
  const stored = favoriteName(name);
  if (!stored) return null;
  return (favorites ?? []).find((f) => f.name === stored) ?? null;
}
