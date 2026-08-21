import { describe, expect, it } from "vitest";
import { REVEAL_PX, revealProgress, tapWhileOpen } from "./swipe";

/** #52's second half: an open row is closed by a tap anywhere else — and since
 *  #97 reversed `4768f7d`, that tap then does whatever it was going to do.
 *
 *  **Two of the four cases here were about swallowing and are gone**, along
 *  with the `keyboard` input that only existed to exempt Enter and Space from
 *  it. What is left is one rule with one exemption, pinned here rather than in
 *  a rendered row because *where* a tap landed is the browser's business and
 *  what to do about it is ours. Its failure is silent in both directions, which
 *  is the reason a one-line function has a test at all.
 */

describe("what a tap does while a row is open (#52, #97)", () => {
  /** The one control the dismiss rule must leave alone. The delete is about to
   *  unmount the row; closing it here would race the removal — and the symptom
   *  of getting it wrong is a trash can that does nothing. */
  it("leaves the row alone for its own delete control", () => {
    expect(tapWhileOpen({ onDeleteControl: true })).toEqual({ close: false });
  });

  /** Everywhere else closes — the log button, the undo toast, a neutral patch
   *  of screen. Nothing is swallowed on the way: a day of real use killed that
   *  rule ("hit the plus sign, it should close and take me to the camera"), and
   *  the same wasted tap was costing Undo a press too. */
  it("closes the row for a tap anywhere else", () => {
    expect(tapWhileOpen({ onDeleteControl: false })).toEqual({ close: true });
  });
});

/** How far in the panel is, for a given finger travel (#91).
 *
 *  **This is the only place the travel and the control are tied together**, and
 *  it exists because they used to be the same number and were stated twice.
 *  The panel is positioned and sized in CSS and slides by a percentage of its
 *  own width; all JavaScript contributes is a fraction. So the property worth
 *  pinning is not "the panel is 32px" — the stylesheet says that, and
 *  `tools/swipe-panel.test.mjs` checks it — but that the control is exactly
 *  home at the end of the gesture and exactly gone at the start, whatever
 *  either number becomes.
 *
 *  Written against `REVEAL_PX` rather than against 88, which is the whole
 *  point: change the travel and these stay true, unless the division was
 *  written against a literal, in which case the half-way case goes red.
 */
describe("how far in the panel is (#91)", () => {
  /** A row nobody has touched. The control is off-stage, past `.swipe`'s clip
   *  edge, and a closed row looks exactly as it did before the feature. */
  it("is off-stage with the row at rest", () => {
    expect(revealProgress(0)).toBe(0);
  });

  /** The end of the travel is the control at rest, not near it. A fraction
   *  short here is a capsule parked a pixel or two outside the row's edge. */
  it("is home at the end of the travel", () => {
    expect(revealProgress(-REVEAL_PX)).toBe(1);
  });

  /** **The drift guard.** Divide by a literal 88 instead of by the travel and
   *  this is the case that reports it: move `REVEAL_PX` and half the travel
   *  stops being half the entry. Nothing else here would notice. */
  it("is half in at half the travel", () => {
    expect(revealProgress(-REVEAL_PX / 2)).toBe(0.5);
  });

  /** The hook already clamps the offset, so this is a second lock on the same
   *  door — but the panel slides by a percentage of its own width, and an
   *  unclamped value would drive it off the far side of the row rather than
   *  merely overshooting. */
  it("clamps past the end of the travel", () => {
    expect(revealProgress(-REVEAL_PX * 2)).toBe(1);
  });

  /** Right-swipes are ignored on purpose: there is nothing revealed on that
   *  side, and a control drifting out of the row's left edge would say there
   *  is. */
  it("ignores a swipe the other way", () => {
    expect(revealProgress(40)).toBe(0);
  });
});
