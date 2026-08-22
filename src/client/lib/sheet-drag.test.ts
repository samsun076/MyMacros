import { describe, expect, it } from "vitest";
import { INTENT_PX, commits } from "./gesture";
import {
  DISMISS_PX,
  DISMISS_SHARE,
  armsDrag,
  backdropTap,
  dismissDistance,
  dragStyle,
} from "./sheet-drag";

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
 *  eight picks in the list and then with rows hidden. Fixtures, not a second
 *  statement of the layout: they say "for a panel of this height", never "the
 *  panel is this tall". On device each is ~34px taller, because `.sheet`'s
 *  bottom padding carries `env(safe-area-inset-bottom)`.
 *
 *  **Eight was `PICKS_MAX` when these were measured and is now just a number
 *  of rows** (#115 removed the cap, because it was throwing favourites away).
 *  All three fixtures re-measured unchanged afterwards — they were always
 *  about a height — but the panel above them is not. Rows are 52.5px, so at
 *  375x812 it grows to 627px on ten and then **stops at the `80dvh` ceiling,
 *  650px, from eleven rows on**: that is where it starts to scroll, and where
 *  `dismissDistance` saturates at 162.5px instead of rising with the list.
 *  Eleven is therefore the tallest panel this gesture will ever be asked
 *  about, and the range these three fixtures bracket is the whole of it. */
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

/** #118 gave the gesture to all three sheets, and the two functions below are
 *  the whole of what that added to this file. Both were inline in a component
 *  before it — one as a nine-line style object on the picks panel, one as an
 *  identity test written out three times — and neither had an oracle, because
 *  **nothing in this repo executes `Log.tsx`** (CLAUDE.md says so, and #81 and
 *  #59 each proved it with a mutation that came back green on a broken file).
 *  Moving them here is what makes the rules below testable at all; leaving them
 *  where they were would have meant three copies with no check on any of them.
 */

describe("what a dragged sheet says inline (#118)", () => {
  /** **The one that reads as a formatting detail and is not.** `translate3d(0,
   *  0, 0)` and no transform at all render identically, so a screenshot cannot
   *  separate them — but the stylesheet eases `transform`, and a transition has
   *  nothing to ease *from* if the property was never on the element. Writing a
   *  zero transform at rest means the first frame of every drag animates from a
   *  transform that was already there, and a pointer *cancel* — which restores
   *  rest without ever passing through a commit — snaps instead of springing. */
  it("puts no transform on a sheet at rest", () => {
    expect(dragStyle({ offsetPx: 0, dragging: false }).transform).toBeUndefined();
  });

  /** A finger down at exactly the start position is still a finger down. The
   *  transition has to be off from the first move or the sheet eases after the
   *  thumb; the transform is still absent, because nothing has moved yet. */
  it("drops the easing the moment a finger is down, transform or not", () => {
    const held = dragStyle({ offsetPx: 0, dragging: true });
    expect(held.transition).toBe("none");
    expect(held.transform).toBeUndefined();
  });

  /** The sheet tracks the finger 1:1 and only downward — `offsetPx` is already
   *  clamped at 0 by the hook, so this is the whole of the mapping. */
  it("tracks the finger on the Y axis and nowhere else", () => {
    expect(dragStyle({ offsetPx: 137, dragging: true }).transform).toBe(
      "translate3d(0,137px,0)",
    );
  });

  /** **A released drag that did not commit is where the easing has to come
   *  back.** `dragging` is false and the offset is already gone, so what the
   *  spring-back actually animates is the transform being *removed* — which is
   *  only visible because the transition is no longer `none`. */
  it("puts the easing back the moment the finger lifts", () => {
    expect(dragStyle({ offsetPx: 0, dragging: false }).transition).toBeUndefined();
  });
});

describe("the backdrop tap the drag has to equal (#118)", () => {
  /** **This is #118's safety argument in one predicate.** The drag is
   *  defensible only because it reaches nothing a tap beside the sheet did not
   *  already reach — on the confirm sheet that means #81's discard confirmation
   *  for more than one capture, and #59's refusal mid-re-read. Neither of those
   *  lives in `sheet-drag.ts` and neither has to: the hook hands both exits out
   *  of one `onDismiss`, so the equality is structural. What is left to check is
   *  that the backdrop half still means "the backdrop", because a `.sheet-wrap`
   *  is a full-screen container and every tap inside the sheet bubbles to it. */
  const wrap = { id: "wrap" };
  const sheet = { id: "sheet" };

  it("fires when the tap landed on the wrap itself", () => {
    expect(backdropTap({ target: wrap, currentTarget: wrap })).toBe(true);
  });

  /** The case that matters: a tap on a macro field inside the sheet bubbles all
   *  the way out to the wrap, and a looser test — `closest`, a box hit — would
   *  dismiss the sheet under someone editing it. */
  it("does not fire on a tap that merely bubbled out of the sheet", () => {
    expect(backdropTap({ target: sheet, currentTarget: wrap })).toBe(false);
  });

  /** Identity, not equality: two distinct nodes that happen to be alike are two
   *  nodes. Stated because `===` on objects is the thing being relied on. */
  it("compares the nodes rather than their shapes", () => {
    expect(backdropTap({ target: { id: "wrap" }, currentTarget: { id: "wrap" } })).toBe(false);
  });
});

/** The two sheets #118 added, **measured** in Chrome at 375x812 with the CDP
 *  drive in this issue's build report — not estimated, and not carried over
 *  from the panel above. Fixtures for the same reason those are: they say "for
 *  a sheet of this height", never "the sheet is this tall". On device each is
 *  ~34px taller, because `.sheet`'s bottom padding carries
 *  `env(safe-area-inset-bottom)`.
 *
 *  The edit sheet's height comes from **stored rows** — the same day, opened on
 *  four different timeline entries, produced 298, 309, 321, 424 and 676 — which
 *  is a wider spread than any confirm sheet can reach and is why #114's share
 *  is the right shape here rather than merely the inherited one. `.sheet`'s own
 *  `86dvh` caps every one of them at 698px on this screen. */
const EDIT_1_ITEM = 298;
const EDIT_7_ITEMS = 676;
const CONFIRM_1_CAPTURE = 396;
const SHEET_CEILING_375x812 = 698;

describe("the same commit distance answers both new sheets (#118)", () => {
  /** **#102's shipped-build assertion, restated on the sheet Dave named.** A
   *  fixed 64px is 9.5% of a seven-item edit sheet — *below* the 12% that he
   *  reported as "drag down just a little to spring up doesnt work, just
   *  disappears" on the picks panel. So the constant would not merely have been
   *  untuned here, it would have been more eager than the number already
   *  rejected in the field. This goes red if anyone puts `DISMISS_PX` back in
   *  place of the share. */
  it("does not throw a seven-item edit sheet away on 64px of travel", () => {
    expect(commits(DISMISS_PX, dismissDistance(EDIT_7_ITEMS))).toBe(false);
    expect(DISMISS_PX / EDIT_7_ITEMS).toBeLessThan(0.12);
  });

  /** **The floor has never bound anything on either of these sheets, and saying
   *  so is the point.** CLAUDE.md's rule about a limit that has never been
   *  reached applies to the number this issue inherited: the shortest sheet
   *  either of them draws is a one-item meal at 298px, whose quarter is 74.5px,
   *  already past `DISMISS_PX`. The floor belongs to the picks panel's one-pick
   *  case (155px) and to nothing here. It is inherited unchanged and unexamined
   *  on purpose — #118 changed no constant — but it is inherited *knowingly*,
   *  which is what #95's lesson asks for. */
  it("never reaches the floor on any sheet this issue added", () => {
    for (const h of [EDIT_1_ITEM, EDIT_7_ITEMS, CONFIRM_1_CAPTURE, SHEET_CEILING_375x812]) {
      expect(dismissDistance(h)).toBeGreaterThan(DISMISS_PX);
      expect(dismissDistance(h)).toBe(h * DISMISS_SHARE);
    }
  });

  /** And every distance in that range is still a second decision rather than a
   *  rounding of `INTENT_PX` — #91's complaint, checked over the sheets rather
   *  than over the constant. */
  it("stays a second decision across the whole measured range", () => {
    for (const h of [EDIT_1_ITEM, EDIT_7_ITEMS, CONFIRM_1_CAPTURE, SHEET_CEILING_375x812]) {
      expect(dismissDistance(h)).toBeGreaterThan(INTENT_PX * 4);
      expect(commits(INTENT_PX, dismissDistance(h))).toBe(false);
    }
  });

  /** **The bottom edge is the ceiling here too, and the tall edit sheet is the
   *  one to check it on.** Measured at 375x812: a 676px sheet starts at y=136,
   *  so the handle's centre has 653px of glass below it and its commit distance
   *  is 169px. What runs out is the *body* drag on rows near the bottom — the
   *  same property of the layout `TRAVEL_375x812` records for the picks panel,
   *  and the same non-problem, because the handle is the exit that always
   *  works. This fails if the share is raised far enough to strand the handle
   *  itself, which is the only version of it that would be a bug. */
  it("stays reachable from the handle on the tallest sheet the app draws", () => {
    const travelFromHandle = 653;
    expect(dismissDistance(SHEET_CEILING_375x812)).toBeLessThan(travelFromHandle);
  });
});
