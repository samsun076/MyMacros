import { useCallback, useRef, useState } from "react";

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
 */

/** How far before the gesture commits to an axis. Below Apple's ~10pt, which
 *  reads as sluggish on a 375px screen where a row is only ~110px tall. */
const INTENT_PX = 8;

/** How far the row travels, and therefore how wide the revealed panel is. */
export const REVEAL_PX = 88;

/** Past this, letting go opens rather than snapping back. Deliberately less
 *  than half: the gesture is a flick, not a drag to a target. */
const COMMIT_PX = REVEAL_PX * 0.4;

export type SwipeState = {
  /** Current x offset, 0…-REVEAL_PX. Drives the transform. */
  offset: number;
  /** Settled open. The panel is only interactive here. */
  open: boolean;
  /** True while a finger is down and horizontal has won — used to drop the
   *  transition so the row tracks the finger instead of easing after it. */
  dragging: boolean;
};

export function useSwipeToReveal(onOpenChange?: (open: boolean) => void, initiallyOpen = false) {
  const [state, setState] = useState<SwipeState>({
    offset: initiallyOpen ? -REVEAL_PX : 0,
    open: initiallyOpen,
    dragging: false,
  });
  const start = useRef<{ x: number; y: number; axis: "none" | "x" | "y"; base: number } | null>(null);

  const set = useCallback(
    (open: boolean) => {
      setState({ offset: open ? -REVEAL_PX : 0, open, dragging: false });
      onOpenChange?.(open);
    },
    [onOpenChange],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Mouse and pen only when it's a real press; a hover must not arm this.
      if (e.pointerType === "mouse" && e.buttons !== 1) return;
      start.current = { x: e.clientX, y: e.clientY, axis: "none", base: state.open ? -REVEAL_PX : 0 };
    },
    [state.open],
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
    setState((s) => ({ ...s, offset: next, dragging: true }));
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const from = start.current;
      start.current = null;
      if (!from || from.axis !== "x") return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setState((s) => {
        const open = s.offset <= -COMMIT_PX;
        onOpenChange?.(open);
        return { offset: open ? -REVEAL_PX : 0, open, dragging: false };
      });
    },
    [onOpenChange],
  );

  return {
    state,
    close: useCallback(() => set(false), [set]),
    open: useCallback(() => set(true), [set]),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
