import { describe, expect, it } from "vitest";
import { tapWhileOpen } from "./swipe";

/** #52's second half: an open row is closed by a tap anywhere else, and the
 *  question that rule turns on is which taps it is allowed to eat.
 *
 *  All three cases are one-liners in the source and none of them is obvious
 *  from reading it — "swallow unless keyboard" only makes sense once you know
 *  the visually-hidden button is the whole non-gesture path to delete. Pinned
 *  here rather than exercised through a rendered row because the rule is a
 *  decision, not a DOM behaviour: where the tap landed is the browser's
 *  business, what to do about it is ours.
 */

describe("what a tap does while a row is open (#52)", () => {
  /** The one control the dismiss rule must never eat. Swallowing this makes
   *  the revealed panel unreachable, which is the gesture's entire point —
   *  and it fails *silently*, as a delete button that does nothing. */
  it("lets the open row's own delete control through untouched", () => {
    expect(tapWhileOpen({ onDeleteControl: true, keyboard: false })).toEqual({
      close: false,
      swallow: false,
    });
  });

  /** iOS's convention, adopted deliberately: the tap that dismisses is usually
   *  "get me out of this" rather than an aim at what's underneath, and letting
   *  it through lands someone on the camera while a trash can is armed. */
  it("closes the row and swallows the tap everywhere else", () => {
    expect(tapWhileOpen({ onDeleteControl: false, keyboard: false })).toEqual({
      close: true,
      swallow: true,
    });
  });

  /** Enter or Space on a `<button>` reports `detail: 0`. Eating the first one
   *  would make the accessible route depend on gesture state — a keyboard user
   *  who happened to leave a row open would have to press Enter twice, with
   *  nothing on screen explaining why. */
  it("closes the row but never swallows a keyboard activation", () => {
    expect(tapWhileOpen({ onDeleteControl: false, keyboard: true })).toEqual({
      close: true,
      swallow: false,
    });
  });

  /** Enter on the open row's own hidden delete button is both at once. The
   *  delete control wins: it is about to unmount the row anyway. */
  it("treats a keyboard press on the delete control as the delete control", () => {
    expect(tapWhileOpen({ onDeleteControl: true, keyboard: true })).toEqual({
      close: false,
      swallow: false,
    });
  });
});
