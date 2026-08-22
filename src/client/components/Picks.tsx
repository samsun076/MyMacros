import { fmtInt } from "../lib/format";
import { useMealSlot } from "../lib/meal-slot";
import type { Pick } from "../lib/picks";
import { SheetHandle } from "./SheetHandle";
import { StarGlyph } from "./StarGlyph";

/** One-tap favourites and recents (#12). No frozen sketch — system idiom.
 *
 *  **This is the only place a pick row is drawn.** #82 gave the list a second
 *  home (the camera deck's pull-up panel, because PHOTO is the default mode
 *  and the list used to live inside the TEXT branch), and a second, reduced
 *  rendering beside this one is exactly the shape the "one quantity, one
 *  source" register warns about: two rows that look the same until one of them
 *  quietly stops offering the star. So the panel and the inline list render
 *  *this*, differing only by where the head goes.
 *
 *  **The head goes with the rows rather than with either caller**, and #116
 *  made that stricter rather than looser. "LOGS AS DINNER" is a claim about
 *  what tapping a row does — the tap is a `food_logs` write with no confirm
 *  sheet behind it — and a placement that dropped it would be offering a
 *  one-tap write with no statement of where it lands. #116 is that failure
 *  arriving without anybody dropping anything: #115 let the list grow past the
 *  panel, so every row below the fold scrolled the statement away and the claim
 *  was made only to the rows that did not need it.
 *
 *  **So in the panel the head *is* the grab band** (`SheetHandle`, which takes
 *  it as its one optional slot). One sticky bar instead of two stacked ones
 *  inside an 80dvh ceiling, the statement cannot scroll away, and the drag that
 *  #102 built the sticky band for still works mid-list. Costed against the
 *  alternatives in #116; this is Dave's call and the numbers are in the commit.
 *
 *  **`inSheet` rather than a `className`.** The two placements used to be told
 *  apart by a string the caller passed, which was fine while the difference was
 *  margin. It is not a string any more — it decides where the statement is
 *  drawn and whether this section owns the sheet's grab bar — and two ways to
 *  say which placement this is would be two things to keep in step.
 */
export function Picks({
  picks,
  saving,
  onStar,
  onRelog,
  inSheet = false,
}: {
  picks: Pick[];
  /** A save is already in flight — every row's re-log is inert until it lands. */
  saving: boolean;
  onStar: (pick: Pick) => void;
  onRelog: (pick: Pick) => void;
  /** Inline under TEXT, or inside #82's pull-up panel. After #115 the two
   *  placements render the same rows in the same order at the same length —
   *  why neither needs a cap is argued once, in lib/picks.ts, beside the cap it
   *  replaced — so this decides two things and only two: the section's spacing,
   *  and whether the head rides in the sheet's grab band (#116). */
  inSheet?: boolean;
}) {
  /** Live, not read-once (#116). The slot changes under an open panel — 11:59
   *  to 12:01 turns BREAKFAST into LUNCH — and a statement that is now
   *  permanently on screen is a statement that is permanently wrong if it does
   *  not follow the clock. `lib/meal-slot.ts` owns the when; `lib/day.ts` still
   *  owns the what. */
  const slot = useMealSlot();

  /** One statement, two frames. The spans and their text are written once; all
   *  that differs between the placements is the box around them — `.sec-head`'s
   *  rule below the list's title, or the sticky band's own row. */
  const statement = (
    <>
      <span className="eyebrow">One tap</span>
      <span className="mono">LOGS AS {slot.toUpperCase()}</span>
    </>
  );

  return (
    <section className={inSheet ? "picks in-sheet" : "picks"}>
      {inSheet ? (
        <SheetHandle>{statement}</SheetHandle>
      ) : (
        <div className="sec-head">{statement}</div>
      )}
      {picks.map((pick) => (
        <div className="pick" key={pick.favorite?.id ?? pick.meal.name}>
          <button
            className={pick.favorite ? "pick-star star-mark on" : "pick-star star-mark"}
            aria-pressed={pick.favorite !== null}
            aria-label={pick.favorite ? `Unstar ${pick.meal.name}` : `Star ${pick.meal.name}`}
            onClick={() => onStar(pick)}
          >
            <StarGlyph />
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
