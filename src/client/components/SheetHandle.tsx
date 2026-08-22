import type { ReactNode } from "react";
import { SHEET_HANDLE_ATTR } from "../lib/sheet-drag";

/** The grab bar at the top of a bottom sheet, and the 44px of glass around it
 *  (#102, #118) — plus, since #116, an optional line of chrome riding with it.
 *
 *  **The only place this markup is written.** #118 gave the gesture to all
 *  three sheets, and the alternative was three copies of a fragment whose whole
 *  job is to carry `SHEET_HANDLE_ATTR` — the attribute `armsDrag` reads to tell
 *  the one exit that works mid-list from a drag that started in the content.
 *  A copy that dropped it would still render an identical bar, still pass every
 *  screenshot, and quietly be #118's own bug again on one sheet out of three.
 *  `StarGlyph` exists for the same reason at a smaller scale.
 *
 *  ## What the band may wrap, and why the rule changed (#116)
 *
 *  #118 wrote this down as **pill only**, on the strength of a real trap: the
 *  band is `touch-action: none`, and an ancestor with `touch-action: none`
 *  disables panning for every touch that starts inside it, whatever the
 *  descendant says. Content in the band is content you cannot scroll from.
 *
 *  The rule that survives that argument is not "pill only" — it is **nothing
 *  that scrolls, and nothing that is above something that scrolls**. #116 is
 *  the case that separates the two. The picks panel's `ONE TAP · LOGS AS LUNCH`
 *  is a *statement about consequence* on a screen where one tap is an
 *  unconfirmed write, and #115 made the list long enough to scroll it out of
 *  sight. Sticking it under the band would be two sticky bars stacked inside an
 *  80dvh ceiling; putting it *in* the band is one bar, and the touch it swallows
 *  is a touch that was always going to be a drag anyway.
 *
 *  So the slot takes a bar and never a list. The rows stay outside this
 *  element, as siblings, where the scroller can still reach them — which is the
 *  half of the trap that is still live and is asserted two ways in
 *  `tools/sheet-drag.test.mjs`: structurally, that the head slot is never handed
 *  the row loop, and by measurement in the drive, that a drag starting on the
 *  first row still scrolls while a drag on the band still does not.
 *
 *  **`aria-hidden` moved down onto the pill, and that is not cosmetic.** #118
 *  hid the whole band because a bar announcing itself would advertise a third
 *  exit that does not exist for a keyboard. That reasoning is about the *pill*,
 *  and it still holds there. Left on the band it would have taken #116's
 *  statement out of the accessibility tree in the same commit that made it
 *  permanently visible — the sighted user gains the guarantee and the screen
 *  reader user loses it. A bare `<div>` with no role and one hidden child
 *  contributes exactly what the hidden band did, so the two sheets with no head
 *  are unchanged.
 */
export function SheetHandle({ children }: { children?: ReactNode }) {
  return (
    <div
      className={children ? "grab-band with-head" : "grab-band"}
      {...{ [SHEET_HANDLE_ATTR]: "" }}
    >
      <div className="grab" aria-hidden="true" />
      {children ? <div className="grab-head">{children}</div> : null}
    </div>
  );
}
