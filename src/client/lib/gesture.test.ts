import { describe, expect, it } from "vitest";
import { INTENT_PX, claimAxis, commits, tapped } from "./gesture";

/** The rule two drags share (#52, #102).
 *
 *  It is pinned here rather than inside either hook because it is now the
 *  thing that must not drift: `swipe.ts` reveals a control on the horizontal
 *  and `sheet-drag.ts` dismisses a panel on the vertical, and the only reason
 *  they cannot disagree about *when a finger has moved enough to mean
 *  something* is that they ask one function.
 *
 *  Written against `INTENT_PX` rather than against 8 — a test that restated
 *  the constant would pass a mutation of it, which is the same defect one
 *  level up from the one this file exists to prevent.
 */

describe("which axis a drag has claimed (#52, #102)", () => {
  /** Nothing is claimed up front, and this is the case that matters most: a
   *  gesture that armed on the first pixel would take every scroll that began
   *  with a degree of drift. */
  it("claims nothing until the finger has moved enough", () => {
    expect(claimAxis(INTENT_PX - 1, INTENT_PX - 1)).toBe("none");
  });

  /** The reveal's case. Larger horizontal movement past the threshold is a
   *  swipe, not the beginning of a scroll. */
  it("gives it to the horizontal when the finger went further across", () => {
    expect(claimAxis(-INTENT_PX * 2, INTENT_PX)).toBe("x");
  });

  /** The dismiss's case, and the timeline's stand-down case — the same answer
   *  read two ways, which is why one function serves both. */
  it("gives it to the vertical when the finger went further down", () => {
    expect(claimAxis(INTENT_PX, INTENT_PX * 2)).toBe("y");
  });

  /** A tie is not a coin toss. Vertical is the scroll on both screens, and a
   *  scroll mistaken for a gesture is a list that fights the thumb, where a
   *  gesture mistaken for a scroll costs one more try. */
  it("gives a dead tie to the vertical", () => {
    expect(claimAxis(INTENT_PX * 2, INTENT_PX * 2)).toBe("y");
  });

  /** Either axis alone can carry the gesture past the threshold — the check is
   *  on each axis, not on the diagonal distance, so a straight drag decides at
   *  exactly `INTENT_PX` rather than at 1.41 times it. */
  it("claims on one axis alone at exactly the threshold", () => {
    expect(claimAxis(0, INTENT_PX)).toBe("y");
  });
});

describe("whether a released drag commits (#52, #102)", () => {
  /** **Spring back, not settle half-open.** Below the threshold the surface
   *  returns to exactly where it started; there is no third state. */
  it("springs back a pixel short of the threshold", () => {
    expect(commits(63, 64)).toBe(false);
  });

  /** The boundary itself, stated so a `>` that should be `>=` reports as
   *  itself rather than as a gesture that occasionally feels dead. */
  it("commits exactly at the threshold", () => {
    expect(commits(64, 64)).toBe(true);
  });

  /** Two gestures, two thresholds, one comparison — the whole reason this is a
   *  function and not a `<=` written out twice. */
  it("commits past a threshold of its caller's own choosing", () => {
    expect(commits(40, 35.2)).toBe(true);
  });

  /** Nothing has been travelled yet, which is what a tap looks like. */
  it("does not commit a finger that never moved", () => {
    expect(commits(0, 64)).toBe(false);
  });
});

/** The third reading of one touch (#60): tap, as opposed to swipe or scroll.
 *
 *  Pinned here for `claimAxis`' reason exactly. `swipe.ts` now has to tell
 *  three things apart on one surface, and the two clauses below each fail
 *  silently in a way that still renders: drop the axis clause and every
 *  swipe-to-delete also opens the editor; drop the `revealed` clause and the
 *  tap that dismisses an armed trash can buries it under a modal sheet.
 */
describe("whether a finished sequence was a tap (#60)", () => {
  /** The whole case. `claimAxis` has already applied `INTENT_PX`, so a tap is
   *  precisely the sequence neither drag claimed. */
  it("is a tap when no axis was ever claimed", () => {
    expect(tapped({ axis: "none", revealed: false })).toBe(true);
  });

  /** A swipe-to-reveal. The browser still fires a click after this, which is
   *  why the answer cannot be read off one. */
  it("is not a tap once the horizontal claimed it", () => {
    expect(tapped({ axis: "x", revealed: false })).toBe(false);
  });

  /** A scroll. The swipe has already stood down by here; this says the tap
   *  does not pick the sequence up on its way out. */
  it("is not a tap once the vertical claimed it", () => {
    expect(tapped({ axis: "y", revealed: false })).toBe(false);
  });

  /** The narrow exemption, and deliberately narrower than #97's reversal: this
   *  tap landed on the very row whose delete control is showing, which is the
   *  "get me out of this" reflex rather than an aim at anything. */
  it("is spent closing the row when the row was already revealed", () => {
    expect(tapped({ axis: "none", revealed: true })).toBe(false);
  });

  /** Belt and braces on the combination — a drag that *ends* on an open row is
   *  refused by both clauses, and a rule that only happened to work because
   *  one of them fired would pass every case above. */
  it("refuses a drag on an already-revealed row twice over", () => {
    expect(tapped({ axis: "x", revealed: true })).toBe(false);
  });
});
