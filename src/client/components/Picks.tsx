import { mealSlotFor } from "../lib/day";
import { fmtInt } from "../lib/format";
import type { Pick } from "../lib/picks";

/** One-tap favourites and recents (#12). No frozen sketch — system idiom.
 *
 *  **This is the only place a pick row is drawn.** #82 gave the list a second
 *  home (the camera deck's pull-up panel, because PHOTO is the default mode
 *  and the list used to live inside the TEXT branch), and a second, reduced
 *  rendering beside this one is exactly the shape the "one quantity, one
 *  source" register warns about: two rows that look the same until one of them
 *  quietly stops offering the star. So the panel and the inline list render
 *  *this*, differing only by a modifier class on the section.
 *
 *  The header goes with the rows rather than with either caller: "LOGS AS
 *  DINNER" is a claim about what tapping a row does, and a placement that
 *  dropped it would be offering a one-tap write with no statement of where it
 *  lands. In the panel it doubles as the dialog's own title. */
export function Picks({
  picks,
  saving,
  onStar,
  onRelog,
  className = "picks",
}: {
  picks: Pick[];
  /** A save is already in flight — every row's re-log is inert until it lands. */
  saving: boolean;
  onStar: (pick: Pick) => void;
  onRelog: (pick: Pick) => void;
  /** `picks` inline, `picks in-sheet` inside #82's panel. Layout only. */
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="sec-head">
        <span className="eyebrow">One tap</span>
        <span className="mono">LOGS AS {mealSlotFor().toUpperCase()}</span>
      </div>
      {picks.map((pick) => (
        <div className="pick" key={pick.favorite?.id ?? pick.meal.name}>
          <button
            className={pick.favorite ? "pick-star on" : "pick-star"}
            aria-pressed={pick.favorite !== null}
            aria-label={pick.favorite ? `Unstar ${pick.meal.name}` : `Star ${pick.meal.name}`}
            onClick={() => onStar(pick)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" strokeWidth="1.4" strokeLinejoin="round">
              <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6z" />
            </svg>
          </button>
          <button className="pick-main" disabled={saving} onClick={() => onRelog(pick)}>
            <span className="pick-name">{pick.meal.name}</span>
            <span className="macros-mini">
              {Math.round(pick.meal.protein_g)}P · {Math.round(pick.meal.carbs_g)}C ·{" "}
              {Math.round(pick.meal.fat_g)}F
            </span>
          </button>
          <span className="pick-kcal">
            {fmtInt(pick.meal.kcal)}
            <small>kcal</small>
          </span>
        </div>
      ))}
    </section>
  );
}
