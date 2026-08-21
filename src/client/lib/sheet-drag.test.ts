import { describe, expect, it } from "vitest";
import { INTENT_PX, commits } from "./gesture";
import { DISMISS_PX, DISMISS_SHARE, armsDrag, dismissDistance } from "./sheet-drag";

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

  /** …and so is every distance the share can produce, since the floor is the
   *  smallest of them. The claim above is about one constant; this is about
   *  the number the gesture actually uses. */
  it("stays past it for every panel the list can produce", () => {
    for (const h of [PANEL_1_PICK, PANEL_2_PICKS, PANEL_8_PICKS]) {
      expect(dismissDistance(h)).toBeGreaterThan(INTENT_PX * 4);
    }
  });
});

/** The panel's rendered height, measured in Chrome at 375x812 (a 13 mini) with
 *  the picks list at `PICKS_MAX` and then with rows hidden. Fixtures, not a
 *  second statement of the layout: they say "for a panel of this height",
 *  never "the panel is this tall". On device each is ~34px taller, because
 *  `.sheet`'s bottom padding carries `env(safe-area-inset-bottom)`. */
const PANEL_8_PICKS = 522;
const PANEL_2_PICKS = 207;
const PANEL_1_PICK = 155;

describe("the commit distance scales with the panel (#102 UAT)", () => {
  /** **The assertion the shipped build fails.** `DISMISS_PX` was the whole
   *  threshold on `ba66109`, so 64px of travel dismissed the full panel — 12%
   *  of it, 11mm of a 13 mini's glass, narrower than the thumb doing the
   *  dragging. Dave could not produce a spring-back at all. */
  it("does not throw the full panel away on 64px of travel", () => {
    expect(commits(DISMISS_PX, dismissDistance(PANEL_8_PICKS))).toBe(false);
  });

  /** The same drag on a one-pick panel is a third of it and does commit. This
   *  is the pair that a single constant cannot produce: one number is either
   *  too eager for the tall panel or unreachable on the short one. */
  it("does throw a one-pick panel away on the same 64px", () => {
    expect(commits(DISMISS_PX, dismissDistance(PANEL_1_PICK))).toBe(true);
  });

  /** **Why a constant was the wrong shape rather than the wrong number.** A
   *  third of the full panel is taller than the whole of the one-pick panel,
   *  so a distance tuned for the list Dave has would be a drag the first-day
   *  user cannot finish. Stated as arithmetic so that "just raise the number"
   *  fails here rather than on a phone. */
  it("could not have been one number", () => {
    expect(PANEL_8_PICKS / 3).toBeGreaterThan(PANEL_1_PICK);
  });

  /** The floor is a floor: it binds on the short panel and gets out of the way
   *  on the tall one. */
  it("takes the floor on a short panel and the share on a tall one", () => {
    expect(dismissDistance(PANEL_1_PICK)).toBe(DISMISS_PX);
    expect(dismissDistance(PANEL_2_PICKS)).toBe(DISMISS_PX);
    expect(dismissDistance(PANEL_8_PICKS)).toBe(PANEL_8_PICKS * DISMISS_SHARE);
  });

  /** **The screen's bottom edge is the ceiling on this number, and it is the
   *  reason the share is a quarter and not a third.** The panel is anchored to
   *  the bottom of the viewport, so a downward drag that starts low runs out of
   *  glass: measured at 375x812, these are the pixels available below the
   *  handle and below each of the eight rows. Row 8 could never dismiss, at any
   *  threshold this project has shipped, and that is a property of the layout
   *  rather than of the gesture. Raise the share to a half and five of nine
   *  start points go dead — this test is what fails when someone does. */
  const TRAVEL_375x812 = [499, 412, 360, 307, 254, 202, 149, 97, 44];

  it("stays reachable from the handle and most of the list", () => {
    const t = dismissDistance(PANEL_8_PICKS);
    expect(TRAVEL_375x812.filter((available) => available >= t)).toHaveLength(7);
  });
});
