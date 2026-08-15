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

/** How far the row travels, and therefore how wide the revealed panel is. */
export const REVEAL_PX = 88;

/** Past this, letting go opens rather than snapping back. Deliberately less
 *  than half: the gesture is a flick, not a drag to a target. */
const COMMIT_PX = REVEAL_PX * 0.4;

/** Marks the controls that delete the row this hook is attached to, so the
 *  outside-tap listener below can tell "cancel" from "yes, that one".
 *
 *  An attribute rather than a class name because it is a behavioural contract
 *  between two files, not a look — `.swipe-hit` could be restyled or renamed
 *  by #91 without anyone realising the dismiss rule reads it. */
export const DELETE_CONTROL_ATTR = "data-swipe-delete";

export type SwipeState = {
  /** Current x offset, 0…-REVEAL_PX. Drives the transform. */
  offset: number;
  /** Settled open. The panel is only interactive here. */
  open: boolean;
  /** True while a finger is down and horizontal has won — used to drop the
   *  transition so the row tracks the finger instead of easing after it. */
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
    offset: drag ?? (open ? -REVEAL_PX : 0),
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

/** What a tap should do while some row is open (#52).
 *
 *  **The closing tap is swallowed, and that is a decision.** iOS swallows it,
 *  and the reason generalises: an open row is a revealed destructive control,
 *  so the tap that dismisses it is usually a "get me out of this" tap rather
 *  than a considered aim at whatever is underneath. Letting it through means
 *  someone reaching to cancel lands on the camera instead. The cost is one
 *  wasted tap for the person who really did mean to hit the log button; the
 *  alternative's cost is a screen they didn't ask for while a trash can is
 *  armed behind them.
 *
 *  **Two things are never swallowed.** The row's own delete control, obviously
 *  — swallowing that would make the panel unreachable, which is the gesture's
 *  whole point. And any keyboard activation: a `<button>` fired by Enter or
 *  Space reports `detail: 0`, and the visually-hidden delete button is the
 *  entire non-gesture path to this action. Eating the first Enter would make
 *  the accessible route depend on gesture state, which is the one thing it
 *  exists not to do.
 *
 *  Kept as a plain function over a plain record so the three cases have a test
 *  that isn't a rendered component — the house idiom, same as `timeline.ts`.
 */
export function tapWhileOpen(tap: { onDeleteControl: boolean; keyboard: boolean }): {
  close: boolean;
  swallow: boolean;
} {
  // The delete is about to unmount the row anyway; closing it here would just
  // race the removal. Never swallowed, at any cost.
  if (tap.onDeleteControl) return { close: false, swallow: false };
  return { close: true, swallow: !tap.keyboard };
}

/** Close an open row when a tap lands anywhere else (#52).
 *
 *  **A document listener rather than a scrim, and only while open.** A
 *  transparent full-screen div would have to be `position: fixed` to cover the
 *  scrolled page, and would then block scrolling, hovering and the tab bar for
 *  as long as a row is open — layout and paint, to catch an event. This adds
 *  one listener, has no box, and is removed the moment the row closes.
 *
 *  **Capture phase on `document`, above React's root.** React 19 delegates
 *  from the root container, so stopping propagation here is what actually
 *  swallows the tap; `preventDefault` covers the native half (an `<a href>`).
 *  Nothing about this reads the DOM for state — the state is the `open` prop —
 *  it only asks *where* the tap landed.
 *
 *  **Scroll deliberately does not close the row.** Three reasons, in order of
 *  weight: a horizontal flick on iOS routinely emits a scroll from the page's
 *  own rubber-band, so this would close rows intermittently at the instant
 *  they opened; the gesture already stands down when vertical wins, so a
 *  scroll started on a row means "I'm not swiping", which is not the same as
 *  "I've changed my mind"; and an open row costs nothing but a glance, since
 *  the only thing it can do needs a deliberate tap on an 88px strip.
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
      const { close, swallow } = tapWhileOpen({
        onDeleteControl:
          !!target && !!el && el.contains(target) && !!target.closest(`[${DELETE_CONTROL_ATTR}]`),
        keyboard: e.detail === 0,
      });
      if (swallow) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (close) latest.current();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open, row]);
}
