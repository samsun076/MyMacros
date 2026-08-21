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
 *  function's whole job is the *join*: favourites ahead of recents and the
 *  overlap removed.
 *
 *  **Nothing is shortened here either, and that is #115's fix — the same
 *  argument as the order, one step over.** This used to end
 *  `.slice(0, PICKS_MAX)` with `PICKS_MAX = 8`, taken over the *join*. By
 *  2026-08-21 production held ten favourites, so two of them rendered nowhere
 *  in the app; they could not be un-starred either, because the un-star
 *  control lives on a row of this very list and there is no second surface
 *  anywhere that lists favourites. And because favourites concatenate first,
 *  the slice ate the recents half whole: eight favourites meant zero recents.
 *
 *  The rule that replaces the number: **user-chosen data is never truncated;
 *  auto-generated data is.**
 *
 *  - **Favourites are chosen.** Each one is a deliberate tap on a star, and
 *    dropping one silently is discarding an instruction. Nothing caps them
 *    here, and `GET /api/favorites` has no limit of its own either.
 *  - **Recents are generated**, endless by construction — and
 *    `GET /api/food-logs/recent` already stops at eight distinct meals.
 *    **That is the cap, it is stated there, and restating it here would be a
 *    second opinion about a length the route owns**, exactly the way
 *    re-sorting would be a second opinion about the order. The two eights
 *    that used to sit either side of the wire were one quantity written
 *    twice; only the route's remains.
 *  - **Their slots are reserved by construction.** Nothing truncates the join,
 *    so no number of favourites can crowd the recents out.
 *
 *  **Both placements are handed the whole list and render all of it, and the
 *  reason they can differ in layout without differing in length is stated
 *  here, once** — #115's own requirement, since the number that is gone was
 *  the only thing that used to say anything about either of them.
 *
 *  - **The panel is bounded by the stylesheet.** `.sheet.picks-sheet` is
 *    `max-height: 80dvh` over `.sheet`'s `overflow-y: auto`. Measured at
 *    375x812 with rows hidden one at a time: rows are 52.5px, the panel grows
 *    to 627px on ten rows and then stops at 650px from eleven on, scrolling
 *    the rest. A longer list makes the scrollbar longer and the panel no
 *    taller, which is exactly what that ceiling was written for — it simply
 *    never had to do it, because nothing was allowed to get long enough.
 *  - **TEXT's inline list cannot push the text box anywhere, and the claim
 *    that it could was never true.** `PICKS_MAX`'s comment said eight "fills
 *    TEXT's list without pushing the text box off the top". The list is a
 *    block *after* `.log-ask` in ordinary flow, so it can only extend the
 *    document downward. Measured, not reasoned: at 375 the textarea sits
 *    146px from the document top with 21 rows below it and 146px with 3 —
 *    the same number, while the document itself went 812px to 1559px. The
 *    constraint that argued for the cap in the placement that was supposed to
 *    need it most did not exist.
 */
export type Pick = { meal: RecentMeal; favorite: Favorite | null };

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
  return [...favs, ...rest];
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
