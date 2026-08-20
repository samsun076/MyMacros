import type { Favorite, RecentMeal } from "../../shared/api";

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
