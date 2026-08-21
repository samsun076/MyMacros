import { useCallback, useRef, useState } from "react";
import { claimAxis, commits } from "./gesture";

/** Drag a bottom sheet down to dismiss it (#102).
 *
 *  #82's picks panel drew `.grab` — the small centred bar every iOS sheet
 *  wears — because it borrows the confirm sheet whole, and then honoured
 *  nothing. Dave, the day it shipped: *"it feels more intuitive to also be
 *  able to swipe down which i cant."* The backdrop tap was never the problem;
 *  the screen advertising a second way out and not having one was.
 *
 *  **This is `swipe.ts` with the axes swapped, which is exactly why it is not
 *  a copy of it.** The part that is genuinely the same — when a drag has moved
 *  enough to mean anything, which axis has won, whether letting go commits —
 *  is `gesture.ts`, imported by both. What is here is what only a sheet has.
 *
 *  **What only a sheet has is the scroll it sits on.** `.sheet` is
 *  `overflow-y: auto` and #82 lowered the picks panel's ceiling to `80dvh`, so
 *  on a short screen the list genuinely scrolls — and a downward drag is how
 *  you scroll it. The standard rule, written down here rather than left to be
 *  rediscovered: **a drag on the body dismisses only when the list is already
 *  at the top; the handle dismisses always.** That is what makes the handle's
 *  44px band load-bearing rather than decorative — it is the way out that
 *  works mid-list, which is why it is also `position: sticky` in the
 *  stylesheet. A handle that scrolls off the top is a handle you cannot reach
 *  at exactly the moment it is the only thing that would have worked.
 *
 *  **Only this panel gets the gesture**, and the confirm sheet deliberately
 *  does not: its dismiss throws away the read, and on #16's path a photo
 *  already written to R2 whose only handle on screen is that sheet. A cheap
 *  gesture for an expensive action needs a decision of its own — a much longer
 *  commit distance, or an undo — and #102 is explicit that the decision is not
 *  its. Dismissing the picks panel costs one more tap on the star.
 */

/** Marks the sheet's drag handle, so the hook can tell a drag that started
 *  there from one that started in the list.
 *
 *  An attribute rather than a class, for `DELETE_CONTROL_ATTR`'s reason: this
 *  is a behavioural contract between the stylesheet's band and this file's
 *  arming rule, not a look, and renaming `.grab-band` while restyling must not
 *  quietly turn the handle back into a decoration. */
export const SHEET_HANDLE_ATTR = "data-sheet-handle";

/** How far down before letting go dismisses, as a share of the panel's own
 *  height (#102's UAT, 2026-08-21).
 *
 *  **A fixed pixel distance shipped first and it was the wrong shape**, not
 *  merely the wrong number. `DISMISS_PX` was 64 for every panel, and the panel
 *  is not one size: measured at 375x812 it is 522px with eight picks and 155px
 *  with one, so the same 64 was a 12% throw on the list Dave has and a 41%
 *  throw on the list a first-day user has. The gesture was three and a half
 *  times more eager on the full panel — and the full panel is the one that
 *  gets used. Dave, on `d6d0d68`, an installed app on a 13 mini: *"drag down
 *  just a little to spring up doesnt work, just disappears."*
 *
 *  **A share is what iOS's own sheets use**, which is the muscle memory #102
 *  set out to match, and it is the only shape that can serve both ends: a
 *  third of the full panel (174px) is *taller than the whole* of the one-pick
 *  panel, so no constant tuned for one is usable on the other.
 *
 *  **A quarter rather than a third, and the reason is the screen's bottom
 *  edge.** The panel is anchored there, so a downward drag that starts low has
 *  nowhere to go — measured at 375x812, the handle has 499px of travel below
 *  it, row 5 has 202px and row 8 has 44px. A quarter (131px) is reachable from
 *  the handle and rows 1-6; a third (174px) loses rows 6-8 as well. Row 8 is
 *  already unreachable at 64px and always was. So: the largest share that
 *  costs the body drag one row of reach on the reference device.
 *
 *  Physical scale, since that is what a thumb answers to: 375 CSS px spans
 *  64.2mm of a 13 mini, so 64px is 11.0mm — narrower than the thumb making the
 *  gesture — and a quarter of the full panel is 22mm.
 *
 *  **Only a thumb confirms this.** Every check in this repo agreed the old
 *  number worked, because a synthetic touch lands exactly where it is told and
 *  has no opinion about what "a little" means. */
export const DISMISS_SHARE = 1 / 4;

/** The floor under that share, and the last of the old fixed distance.
 *
 *  Below ~256px of panel — one or two picks — a quarter falls under 11mm,
 *  which is the scale that failed in the field, so the share stops there
 *  rather than shrinking with the list. 64 is still eight times the intent
 *  threshold, so the two decisions are nowhere near each other (#91's
 *  complaint about thresholds within five pixels of one another).
 *
 *  Stated once, here. No CSS length restates it — `tools/sheet-drag.test.mjs`
 *  fails if one appears, the same guard #91 put on `REVEAL_PX`. */
export const DISMISS_PX = 64;

/** The commit distance for a panel this tall, in pixels.
 *
 *  Read once, at the moment the finger lands, for `armsDrag`'s reason: it is a
 *  claim about the panel the drag started on, not a window that can reopen
 *  mid-drag. It **reads** the rendered height rather than restating it — the
 *  stylesheet still owns how tall the panel is, and this is the one consumer
 *  of that number. */
export function dismissDistance(sheetHeightPx: number): number {
  return Math.max(DISMISS_PX, sheetHeightPx * DISMISS_SHARE);
}

/** Is this touch allowed to become a dismissal at all? (#102)
 *
 *  **The one rule the whole feature turns on**, and a one-line function for
 *  the reason `tapWhileOpen` is one: its failure is silent in both directions.
 *  Drop the scroll condition and a scrolling thumb throws the panel away
 *  mid-list; drop the handle exemption and there is no way out of a scrolled
 *  list but to scroll back to the top first.
 *
 *  `<= 0` rather than `=== 0` because iOS rubber-banding reports a small
 *  negative `scrollTop` at the top of a scroller, and a sheet that refuses to
 *  drag on the bounce is a sheet that intermittently refuses to drag.
 */
export function armsDrag(touch: { fromHandle: boolean; scrollTop: number }): boolean {
  return touch.fromHandle || touch.scrollTop <= 0;
}

export type SheetDragState = {
  /** How far down the sheet has been dragged, in pixels, 0 at rest.
   *
   *  **A length, not a fraction, and that is not #91's trap returning.** The
   *  reveal hook hides its offset because the panel it drives is sized in CSS,
   *  so a consumer dividing pixels by a travel of its own would be a second
   *  statement of the panel's width. Here the sheet tracks the finger 1:1 —
   *  the number *is* the distance the sheet has moved, and it is consumed as a
   *  length by exactly one `translate3d`. There is nothing to divide it by. */
  offsetPx: number;
  /** True while a finger is down and the drag has been claimed — used to drop
   *  the transition so the sheet tracks the finger instead of easing after it. */
  dragging: boolean;
};

export function useDragToDismiss(onDismiss: () => void) {
  /** The offset while a finger is down, null the rest of the time. A sheet
   *  that is not being dragged is at 0; two ways to say that would be two
   *  things to keep in step. */
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{
    y: number;
    x: number;
    axis: "none" | "y";
    /** Mirrored out of React state because pointerup has to *decide* on it and
     *  state is a render behind — `swipe.ts` has the same ref for the same
     *  reason, and the same StrictMode bug in its history. */
    offset: number;
    /** How far this particular drag has to go, fixed when the finger landed.
     *  It depends on the panel's height and the panel's height depends on how
     *  many picks there are, so it is per-drag rather than per-module. */
    threshold: number;
  } | null>(null);

  /** A drag that ends over a favourite must not also log it.
   *
   *  Pointer capture already retargets the click to the sheet in Chrome, so in
   *  this project's own tooling this flag never fires. It stays because the
   *  device that matters is an iPhone, the retargeting is the browser's
   *  business rather than ours, and the cost of being wrong is a meal written
   *  to the day by a gesture that meant to close the panel. Named here as what
   *  it is: a guard that headless Chrome cannot exercise. */
  const swallowClick = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    // Mouse and pen only when it's a real press; a hover must not arm this.
    if (e.pointerType === "mouse" && e.buttons !== 1) return;
    swallowClick.current = false;
    const target = e.target instanceof Element ? e.target : null;
    const armed = armsDrag({
      fromHandle: !!target?.closest(`[${SHEET_HANDLE_ATTR}]`),
      scrollTop: e.currentTarget.scrollTop,
    });
    // Not armed is not "wait and see": the list is scrolled and this touch is
    // a scroll. Recording a start would only invite a later frame to reconsider.
    start.current = armed
      ? {
          x: e.clientX,
          y: e.clientY,
          axis: "none",
          offset: 0,
          // `offsetHeight`, not the client rect: the sheet carries a transform
          // while it is being dragged and this must be the panel's height, not
          // whatever the last drag left on screen.
          threshold: dismissDistance(e.currentTarget.offsetHeight),
        }
      : null;
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const from = start.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;

    if (from.axis === "none") {
      const axis = claimAxis(dx, dy);
      if (axis === "none") return;
      // Horizontal won, or the drag is upward — which on a list already at the
      // top is how you scroll *down* into it. Either way this is not a
      // dismissal, and there is no second chance for the rest of the touch.
      if (axis === "x" || dy <= 0) {
        start.current = null;
        return;
      }
      from.axis = axis;
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    // `cancelable` is false once the browser has already begun scrolling, and
    // calling preventDefault then is a console warning and nothing else.
    if (e.cancelable) e.preventDefault();
    // Clamped at 0: there is nothing above the sheet to drag it toward, and
    // rubber-banding it upward would suggest the panel expands.
    const next = Math.max(0, dy);
    from.offset = next;
    setDrag(next);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const from = start.current;
      start.current = null;
      if (!from || from.axis !== "y") return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDrag(null);
      swallowClick.current = true;
      if (commits(from.offset, from.threshold)) onDismiss();
    },
    [onDismiss],
  );

  /** A cancelled pointer is not a short drag, and must not be treated as one.
   *  `swipe.ts` maps cancel onto up because the worst it can do there is open
   *  a row; here the browser taking the gesture over would dismiss the panel
   *  out from under someone who was scrolling. So this only springs back. */
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const from = start.current;
    start.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (from?.axis === "y") swallowClick.current = true;
    setDrag(null);
  }, []);

  /** **The sheet's own `touchmove`, non-passive, and it is not optional.**
   *
   *  Measured, not assumed: with the panel at the top of its list and *nothing
   *  to scroll* (`scrollHeight === clientHeight`), Chrome still latches a
   *  downward touch as a scroll and fires `pointercancel` after ~17px. So a
   *  body drag was claimed, tracked for two frames, and then taken away — and
   *  the visible result was a panel that sprang back, which is exactly what a
   *  short drag looks like. The first drive of this feature reported four
   *  cases green against a gesture that never once survived.
   *
   *  `preventDefault` on a cancelable `touchmove` is what stops that, and it
   *  has to be a native listener: React attaches its root `touchmove` handler
   *  as passive, so `onTouchMove` can only warn. The pointer events for one
   *  raw touch are dispatched before the touch events, so by the time the
   *  first `touchmove` arrives the axis is already claimed — which is also why
   *  this reads `start.current` rather than deciding anything of its own.
   *
   *  `touch-action` cannot do this job alone. It is one static answer per
   *  element, and this sheet needs two: at the top of the list a downward drag
   *  is the gesture and an upward one is the scroll. Only the handle's band,
   *  which never scrolls in either direction, can state it in CSS. */
  const dragSurface = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (start.current?.axis === "y" && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const state: SheetDragState = { offsetPx: drag ?? 0, dragging: drag !== null };

  return {
    state,
    /** Spread onto the sheet. `ref` is part of the gesture, not decoration —
     *  see `dragSurface`; without it the drag is cancelled out from under
     *  itself on the first list that has nothing to scroll. */
    handlers: {
      ref: dragSurface,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  };
}
