import { describe, expect, it } from "vitest";
import { tapWhileOpen } from "./swipe";

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
