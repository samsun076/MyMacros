import { describe, expect, it } from "vitest";
import { INTENT_PX } from "./gesture";
import { DISMISS_PX, armsDrag } from "./sheet-drag";

/** When a downward drag on the picks panel is a dismissal and when it is a
 *  scroll (#102).
 *
 *  **This is the whole feature in one predicate**, which is why it is a pure
 *  function and not a condition buried in a pointer handler. Its failure is
 *  silent in both directions and neither direction throws: drop the scroll
 *  condition and the panel is thrown away under a thumb that meant to read the
 *  list; drop the handle exemption and a scrolled list has no exit but to
 *  scroll back to the top first, which is the affordance this issue is about
 *  going missing again in a different way.
 *
 *  The state of the scroller is read **once, at the moment the finger lands**.
 *  "Already at the top" is a claim about where the gesture started, not a
 *  window that can open mid-drag — a rule that re-checked would hand the panel
 *  to whichever pixel the list happened to be resting on.
 */

describe("what arms a drag-to-dismiss (#102)", () => {
  /** The ordinary case: the list is at the top, so there is nothing for a
   *  downward drag to scroll and everything for it to dismiss. */
  it("arms from the body when the list is at the top", () => {
    expect(armsDrag({ fromHandle: false, scrollTop: 0 })).toBe(true);
  });

  /** **The case the rule exists for.** A downward drag here is how you scroll
   *  the list, and dismissing on it would make the panel unreadable the moment
   *  it is long enough to be worth reading. */
  it("does not arm from the body once the list is scrolled", () => {
    expect(armsDrag({ fromHandle: false, scrollTop: 18 })).toBe(false);
  });

  /** And the exemption that keeps a way out: the handle is not part of the
   *  list, it is the sheet's own control, so it drags whatever the list is
   *  doing. This is what the 44px band and its `position: sticky` are for. */
  it("arms from the handle even mid-list", () => {
    expect(armsDrag({ fromHandle: true, scrollTop: 240 })).toBe(true);
  });

  /** iOS reports a small negative `scrollTop` while a scroller rubber-bands at
   *  its top. `=== 0` there is a sheet that refuses to drag intermittently,
   *  which is worse than one that never does — the second gets reported. */
  it("arms on the bounce above the top", () => {
    expect(armsDrag({ fromHandle: false, scrollTop: -6 })).toBe(true);
  });
});

describe("how far down is a dismissal (#102)", () => {
  /** **The two thresholds must not sit inside a few pixels of each other.**
   *  #91's argument, applied to this gesture: `INTENT_PX` decides that the
   *  finger meant something and this decides what, and if they nearly coincide
   *  then every claimed drag is a committed one — a panel that vanishes on the
   *  9th pixel of a scroll that a short list did not have to give. Only a thumb
   *  would report that, and by then it has shipped. */
  it("is far enough past the intent threshold to be a second decision", () => {
    expect(DISMISS_PX).toBeGreaterThan(INTENT_PX * 4);
  });
});
