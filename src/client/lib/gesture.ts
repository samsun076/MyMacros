/** The rule two drags share, stated once (#52, #102).
 *
 *  There are now two gestures on this app's screens and they are mirror images
 *  of each other: swipe a timeline row **left** to reveal delete (`swipe.ts`),
 *  drag the picks panel **down** to dismiss it (`sheet-drag.ts`). Both live on
 *  a surface whose *other* axis is a scroll, so both have the same problem —
 *  telling the gesture from the scroll — and both answer it the same way.
 *
 *  **The constants differ; the rule does not.** That distinction is the whole
 *  reason this file exists rather than a second copy of `swipe.ts` with the
 *  axes swapped. How far a finger travels before a panel is fully in (88px)
 *  and how far it travels before a sheet is gone (a quarter of that sheet's
 *  own height) are two decisions about two controls — and they are not
 *  even the same *kind* of number, which is why `commits` takes the threshold
 *  as an argument rather than reading one. *Whether an axis has been claimed
 *  yet*, and *whether a released drag commits or springs back*, are one
 *  decision stated twice —
 *  which is #86's defect, and the kind that rots quietly: raise the intent
 *  threshold in one file and the other gesture goes on claiming at 8px with
 *  nothing to fail.
 */

/** How far before either gesture commits to an axis. Below Apple's ~10pt,
 *  which reads as sluggish on a 375px screen. Owned here because a threshold
 *  that differed per gesture would mean two answers to "has the finger moved
 *  enough to mean anything yet" on one screen. */
export const INTENT_PX = 8;

export type Axis = "none" | "x" | "y";

/** Which axis this gesture is, or `"none"` while it is still too early to say.
 *
 *  **Neither gesture claims anything up front.** A touch that starts on a
 *  timeline row is far more often a scroll than a delete, and a touch that
 *  starts on the picks panel is far more often a scroll than a dismiss — so
 *  the first few pixels decide, and the axis with the larger movement wins
 *  once either passes `INTENT_PX`. Until then nothing moves and nothing is
 *  captured, so a scroll that begins with a degree of drift behaves exactly as
 *  it did before either gesture existed.
 *
 *  **A tie goes to the vertical**, which on both screens is the scroll. Ties
 *  are rare and the wrong answer is not symmetric: a scroll mistaken for a
 *  gesture is a list that fights the thumb, where a gesture mistaken for a
 *  scroll costs one more try.
 *
 *  The caller decides what to do with the answer. What it must not do is give
 *  itself a second chance later in the same drag — once the loser has been
 *  named, that gesture stands down for the rest of the touch, which is what
 *  keeps a list from going sticky mid-scroll.
 */
export function claimAxis(dx: number, dy: number): Axis {
  if (Math.abs(dx) < INTENT_PX && Math.abs(dy) < INTENT_PX) return "none";
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/** Does letting go here commit the gesture, or spring it back?
 *
 *  `travelled` is how far the finger went **in the gesture's own direction**,
 *  as a magnitude — both callers clamp the other direction away before asking,
 *  because a drag the wrong way is not a small commit, it is not this gesture
 *  at all.
 *
 *  **The half-open state is deliberately unreachable.** Below the threshold
 *  the surface returns to exactly where it started; there is no settling to
 *  some fraction of the travel. Two callers, one line, and its failure is
 *  silent in both directions — a `>` that should be `>=`, or a threshold read
 *  from the wrong constant, produces a gesture that merely feels wrong.
 */
export function commits(travelled: number, threshold: number): boolean {
  return travelled >= threshold;
}
