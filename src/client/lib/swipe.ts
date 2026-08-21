import { useCallback, useEffect, useRef, useState } from "react";

/** Swipe-left-to-reveal, on pointer events and no library (#52).
 *
 *  **The whole problem is telling a swipe from a scroll**, on a screen whose
 *  main gesture is vertical. A touch that starts on a timeline row is far more
 *  often the beginning of a scroll than the beginning of a delete, so this
 *  never claims the gesture up front: it watches the first few pixels, and the
 *  axis whose movement is larger wins once either passes `INTENT_PX`. Until
 *  then nothing moves and nothing is captured, so a scroll that happens to
 *  start with a degree of horizontal drift behaves exactly as it did before.
 *
 *  Once horizontal wins, the pointer is captured and `preventDefault` stops the
 *  page scrolling under the drag. Once vertical wins, this component is out of
 *  the way for the rest of the gesture — there is no second chance to change
 *  its mind mid-drag, which is what makes a list feel sticky.
 *
 *  Right-swipes are ignored on purpose. There is nothing revealed on that side,
 *  and rubber-banding a row toward an empty gutter suggests there is.
 *
 *  **The row does not move; the panel slides in over its right edge** (#91).
 *  What this hook produces is therefore a *distance the finger has travelled*,
 *  not a distance the row has moved — see `REVEAL_PX` and `revealProgress`.
 *
 *  **Whether a row is open is NOT stored here.** "One row open at a time" is a
 *  statement about the list, and a row cannot enforce it from inside itself —
 *  so `open` arrives as a prop and every change is reported back through
 *  `onOpenChange`. What this hook still owns is the live drag offset, which is
 *  nobody else's business and dies with the gesture. That leaves exactly one
 *  place holding "which row is open" (the register's rule, #86); the first cut
 *  of this file kept a copy per row, which is what let three of them sit open
 *  at once.
 */

/** How far before the gesture commits to an axis. Below Apple's ~10pt, which
 *  reads as sluggish on a 375px screen where a row is only ~110px tall. */
const INTENT_PX = 8;

/** **How far the finger travels, and nothing else** (#91).
 *
 *  It used to be three quantities wearing one name: the travel, the width of
 *  the revealed panel, and the width of the hit area. That is #86's defect in
 *  miniature and it had already half-rotted — the hit area read this constant
 *  while `app.css` read a `88px` literal, so moving either one would have slid
 *  the tappable strip off the visible one with nothing to fail. The panel and
 *  the hit area are now sized entirely in CSS (`--swipe-panel-w`,
 *  `--swipe-hit-w` on `.swipe`), where the shape of the control belongs, and
 *  **no CSS length restates this number** — `tools/swipe-panel.test.mjs` fails
 *  if one appears.
 *
 *  It stays 88 even though the control it reveals is 32px wide. Travel is
 *  gesture feel: `COMMIT_PX` is 0.4 of it, and shortening the travel to the
 *  capsule's width would put the commit threshold at 12.8px against an intent
 *  threshold of 8 — two decisions inside five pixels of each other, which only
 *  a thumb could tell you is wrong, and by then it ships. */
export const REVEAL_PX = 88;

/** Past this, letting go opens rather than snapping back. Deliberately less
 *  than half: the gesture is a flick, not a drag to a target. */
const COMMIT_PX = REVEAL_PX * 0.4;

/** How far *in* the panel is, 0 (off-stage) … 1 (at rest), for a given offset.
 *
 *  **The one place the travel and the panel's entry are tied together.** The
 *  panel is positioned and sized in CSS and slides by a percentage of its own
 *  width, so this is the whole of what JavaScript knows about it: at the end
 *  of the gesture the control is exactly home, whatever either number is. Move
 *  `REVEAL_PX` and the entry follows; write the division against a literal 88
 *  instead and `swipe.test.ts` goes red. */
export function revealProgress(offset: number): number {
  return Math.min(1, Math.max(0, -offset / REVEAL_PX));
}

/** Marks the controls that delete the row this hook is attached to, so the
 *  outside-tap listener below can tell "cancel" from "yes, that one".
 *
 *  An attribute rather than a class name because it is a behavioural contract
 *  between two files, not a look — `.swipe-hit` could be restyled or renamed
 *  by #91 without anyone realising the dismiss rule reads it. */
export const DELETE_CONTROL_ATTR = "data-swipe-delete";

export type SwipeState = {
  /** How far in the panel is, 0…1. What the component actually renders — the
   *  raw offset is not exposed, because a consumer that divided it by a travel
   *  distance of its own would be the second statement all over again. */
  progress: number;
  /** Settled open. The panel is only interactive here. */
  open: boolean;
  /** True while a finger is down and horizontal has won — used to drop the
   *  transition so the panel tracks the finger instead of easing after it. */
  dragging: boolean;
};

export function useSwipeToReveal(open: boolean, onOpenChange: (open: boolean) => void) {
  /** The offset while a finger is down, and null the rest of the time — at
   *  which point the offset is simply what `open` implies. Two ways to be
   *  open would be two things to keep in step. */
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{
    x: number;
    y: number;
    axis: "none" | "x" | "y";
    base: number;
    /** The live offset, mirrored here because pointerup has to *decide* on it
     *  and React state is a render behind. The old cut read it inside a
     *  `setState` updater and called `onOpenChange` from there — a parent
     *  update fired from another component's updater, which StrictMode is
     *  entitled to run twice. */
    offset: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Mouse and pen only when it's a real press; a hover must not arm this.
      if (e.pointerType === "mouse" && e.buttons !== 1) return;
      const base = open ? -REVEAL_PX : 0;
      start.current = { x: e.clientX, y: e.clientY, axis: "none", base, offset: base };
    },
    [open],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const from = start.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;

    if (from.axis === "none") {
      if (Math.abs(dx) < INTENT_PX && Math.abs(dy) < INTENT_PX) return;
      from.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (from.axis === "y") {
        // The scroll won. Stand down for the rest of this gesture.
        start.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    // `cancelable` is false once the browser has already begun scrolling, and
    // calling preventDefault then is a console warning and nothing else.
    if (e.cancelable) e.preventDefault();
    const next = Math.min(0, Math.max(-REVEAL_PX, from.base + dx));
    from.offset = next;
    setDrag(next);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const from = start.current;
      start.current = null;
      if (!from || from.axis !== "x") return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setDrag(null);
      onOpenChange(from.offset <= -COMMIT_PX);
    },
    [onOpenChange],
  );

  const state: SwipeState = {
    progress: revealProgress(drag ?? (open ? -REVEAL_PX : 0)),
    open,
    dragging: drag !== null,
  };

  return {
    state,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

/** What a tap does while some row is open (#52, #97).
 *
 *  **It closes the row, and then it goes on to do whatever it was going to do.**
 *  It used to be swallowed; see `useCloseOnOutsideTap` below for the reversal
 *  and why the original argument lost.
 *
 *  One exemption survives, and it is not about protecting the tap — nothing is
 *  protected now. The row's own delete control is about to unmount the row, so
 *  closing it here would only race the removal.
 *
 *  A one-line function for a one-line rule, kept out of the hook on purpose:
 *  its failure mode is silent (invert it and the trash can becomes a button
 *  that does nothing, or a row closes out from under its own delete), and
 *  `npm run build` is this project's only gate. The half that can't come here
 *  is *where* the tap landed — that is the DOM's business, and it stays in the
 *  hook.
 */
export function tapWhileOpen(tap: { onDeleteControl: boolean }): { close: boolean } {
  return { close: !tap.onDeleteControl };
}

/** Close an open row when a tap lands anywhere else, and let that tap through
 *  to whatever it hit (#52, and #97 for the "let it through" half).
 *
 *  **The dismissing tap used to be swallowed. It isn't, and the reversal is
 *  the point of this comment.** `4768f7d` adopted iOS's convention on the
 *  argument that an open row is a revealed destructive control, so the tap that
 *  dismisses it is a "get me out of this" reflex rather than a considered aim
 *  at what's underneath — letting it through would land someone on the camera
 *  with a trash can armed behind them. A day of UAT on a real phone falsified
 *  it: *"if I have a delete drawer open and hit the plus sign it should close
 *  and take me to the camera."*
 *
 *  **What was wrong with the argument:** the log button is a large, fixed,
 *  deliberate target parked in the tab bar. Nobody arrives on it while flailing
 *  to dismiss a drawer, so the accident it protected against was hypothetical,
 *  while the wasted tap it charged was real, reported, and sat on the app's
 *  most-used control. A protection nobody needs is just friction with a story.
 *
 *  **And it was never only the log button**, which is why there is no exemption
 *  for one. The undo toast's Undo had the identical wart — tap it while a row
 *  was open and nothing happened until you tapped again (REVIEW.md item 4).
 *  Two frictions, one rule, no beneficiary: the rule was wrong, not short an
 *  exception.
 *
 *  **One tap still doesn't close the row: its own delete control.** Not to
 *  protect the tap — nothing is protected now — but because that delete is
 *  about to unmount the row, and closing it here would race the removal. The
 *  check is scoped to *this* row, so a delete control on a different row
 *  dismisses this one like any other outside tap.
 *
 *  Keyboard activation (`detail === 0`) used to be a second exemption, because
 *  the visually-hidden button is the whole non-gesture path to delete and
 *  eating its first Enter would have made the accessible route depend on
 *  gesture state. It is gone as a concept: it was an exemption from
 *  swallowing, and there is nothing left to be exempt from.
 *
 *  **A document listener rather than a scrim, and only while open.** A
 *  transparent full-screen div would have to be `position: fixed` to cover the
 *  scrolled page, and would then block scrolling, hovering and the tab bar for
 *  as long as a row is open — layout and paint, to catch an event. This adds
 *  one listener, has no box, and is removed the moment the row closes.
 *
 *  **Capture phase on `document`, above React's root.** Not to intercept
 *  anything any more — it neither prevents nor stops the event — but because
 *  capture is the one phase guaranteed to see the tap: a handler in between
 *  that calls `stopPropagation` would hide it from a bubble-phase listener and
 *  strand the row open. Nothing here reads the DOM for state — the state is the
 *  `open` prop — it only asks *where* the tap landed.
 *
 *  **Scroll deliberately does not close the row.** Three reasons, in order of
 *  weight: a horizontal flick on iOS routinely emits a scroll from the page's
 *  own rubber-band, so this would close rows intermittently at the instant
 *  they opened; the gesture already stands down when vertical wins, so a
 *  scroll started on a row means "I'm not swiping", which is not the same as
 *  "I've changed my mind"; and an open row costs nothing but a glance, since
 *  the only thing it can do needs a deliberate tap on the revealed control.
 */
export function useCloseOnOutsideTap(
  open: boolean,
  row: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const el = row.current;
      const { close } = tapWhileOpen({
        // Scoped to *this* row: a delete control on a different row is an
        // outside tap like any other, and dismisses this one.
        onDeleteControl:
          !!target && !!el && el.contains(target) && !!target.closest(`[${DELETE_CONTROL_ATTR}]`),
      });
      if (close) latest.current();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open, row]);
}
