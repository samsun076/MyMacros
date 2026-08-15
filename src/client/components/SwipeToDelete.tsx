import { useRef, type ReactNode } from "react";
import { DELETE_CONTROL_ATTR, REVEAL_PX, useCloseOnOutsideTap, useSwipeToReveal } from "../lib/swipe";

/** A timeline row you can swipe left to reveal delete (#52).
 *
 *  **The gesture lives here, in the shared screen layer, not in a motif.** Only
 *  the revealed panel's surface and shape are theme material; how far a finger
 *  has to travel before a row opens is not a thing a theme should get an
 *  opinion about. The motif slot still owns the row *chrome* around this —
 *  `TimelineRow` renders the rail and the time, and this is what it wraps.
 *
 *  **Open is a prop, not state.** At most one row in the list may be open, and
 *  no row can know that about itself — the list holds it and hands each row its
 *  own answer. Which is also what makes "swiping B closes A" free: A is not
 *  told to close, it simply stops being the open one. `Today.tsx` explains why
 *  the list is the right owner.
 *
 *  **The keyboard and screen-reader path is a real button, not a fallback.**
 *  It is visually hidden and reachable by tab, and it does the same thing the
 *  gesture does — because a gesture is not an interface on its own, and the
 *  panel behind the row cannot be reached by a pointer that has no way to
 *  drag. Its label names the meal, since "Delete" repeated down a list of
 *  three tells a screen-reader user nothing about which one. It carries
 *  `DELETE_CONTROL_ATTR` for the same reason the revealed strip does: the
 *  outside-tap rule must never swallow the one control that isn't a gesture.
 */
export function SwipeToDelete({
  label,
  onDelete,
  open,
  onOpenChange,
  children,
}: {
  /** What is being deleted, for the accessible name — e.g. "Dinner, salmon". */
  label: string;
  onDelete: () => void;
  /** Is this the row the list currently has open? */
  open: boolean;
  /** The row reporting its own gesture, or asking to be dismissed. */
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const row = useRef<HTMLDivElement>(null);
  const swipe = useSwipeToReveal(open, onOpenChange);
  useCloseOnOutsideTap(open, row, () => onOpenChange(false));

  return (
    <div className="swipe" ref={row} data-open={open || undefined}>
      {/* Row and panel travel together on one track, with the panel parked
          just past the right edge and clipped by `.swipe`'s overflow.

          The first cut laid the panel *behind* the row and gave the row an
          opaque background to hide it. That put a card behind every timeline
          entry, which the list had never had; removing the background then
          showed the trash can on all three rows at once. Neither is a paint
          problem — the panel simply should not be under the row in the first
          place. Off-stage and sliding in needs no background and no z-index. */}
      <div
        className="swipe-track"
        style={{
          transform: `translate3d(${swipe.state.offset}px,0,0)`,
          // No easing while a finger is down, or the row lags behind it.
          transition: swipe.state.dragging ? "none" : undefined,
        }}
        {...swipe.handlers}
      >
        <div className="swipe-body">{children}</div>
        {/* `aria-hidden` because the visually-hidden button below is this
            action's accessible form — exposing both would put two "delete this
            meal" controls in the tree for one action. */}
        <div className="swipe-panel" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </div>
      </div>

      {/* Tapping the revealed panel is what actually deletes. It sits above the
          panel rather than inside it so the hit area is the whole revealed
          strip, and it only exists while open — an invisible button under a
          closed row is a mis-tap waiting to happen. */}
      {open && (
        <button
          type="button"
          className="swipe-hit"
          style={{ width: REVEAL_PX }}
          aria-label={`Delete ${label}`}
          onClick={onDelete}
          {...{ [DELETE_CONTROL_ATTR]: "" }}
        />
      )}

      <button type="button" className="vh-button" onClick={onDelete} {...{ [DELETE_CONTROL_ATTR]: "" }}>
        Delete {label}
      </button>
    </div>
  );
}
