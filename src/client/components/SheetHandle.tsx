import { SHEET_HANDLE_ATTR } from "../lib/sheet-drag";

/** The grab bar at the top of a bottom sheet, and the 44px of glass around it
 *  (#102, #118).
 *
 *  **The only place this markup is written.** #118 gave the gesture to all
 *  three sheets, and the alternative was three copies of a fragment whose whole
 *  job is to carry `SHEET_HANDLE_ATTR` — the attribute `armsDrag` reads to tell
 *  the one exit that works mid-list from a drag that started in the content.
 *  A copy that dropped it would still render an identical bar, still pass every
 *  screenshot, and quietly be #118's own bug again on one sheet out of three.
 *  `StarGlyph` exists for the same reason at a smaller scale.
 *
 *  **It wraps the pill and nothing else, and that is the rule rather than the
 *  layout.** The band is `touch-action: none` (see the stylesheet for why the
 *  drag would otherwise be handed back to the scroller), and touch-action
 *  applies down through whatever is inside it. Putting content in here — a
 *  sticky header, a title, a close button — makes that content undraggable
 *  *and* unscrollable, which is the trap #116 names when it costs the sticky
 *  slot header under this band. So: pill only. Anything a sheet wants at its
 *  top goes after this element, never inside it.
 *
 *  Still `aria-hidden`. Every sheet that draws this has Escape and a backdrop
 *  as its non-pointer exits, and a bar announcing itself to a screen reader
 *  would be a third one that does not exist for a keyboard.
 */
export function SheetHandle() {
  return (
    <div className="grab-band" aria-hidden="true" {...{ [SHEET_HANDLE_ATTR]: "" }}>
      <div className="grab" />
    </div>
  );
}
