import type { ReactNode } from "react";
import { REVEAL_PX, useSwipeToReveal } from "../lib/swipe";

/** A timeline row you can swipe left to reveal delete (#52).
 *
 *  **The gesture lives here, in the shared screen layer, not in a motif.** Only
 *  the revealed panel's surface and shape are theme material; how far a finger
 *  has to travel before a row opens is not a thing a theme should get an
 *  opinion about. The motif slot still owns the row *chrome* around this —
 *  `TimelineRow` renders the rail and the time, and this is what it wraps.
 *
 *  **The keyboard and screen-reader path is a real button, not a fallback.**
 *  It is visually hidden and reachable by tab, and it does the same thing the
 *  gesture does — because a gesture is not an interface on its own, and the
 *  panel behind the row cannot be reached by a pointer that has no way to
 *  drag. Its label names the meal, since "Delete" repeated down a list of
 *  three tells a screen-reader user nothing about which one.
 */
export function SwipeToDelete({
  label,
  onDelete,
  /** DEV-only: start revealed, so `/#swiped` can be screenshotted (#52).
   *
   *  The gesture itself is not testable by this harness — shot-matrix drives
   *  CDP and has no finger — so the *state* is made reachable instead and the
   *  motion stays a device check. Being honest about which half is covered is
   *  the point; a screenshot of an open row is not evidence that swiping opens
   *  it. */
  initiallyOpen = false,
  children,
}: {
  /** What is being deleted, for the accessible name — e.g. "Dinner, salmon". */
  label: string;
  onDelete: () => void;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const swipe = useSwipeToReveal(undefined, initiallyOpen);

  return (
    <div className="swipe" data-open={swipe.state.open || undefined}>
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
      {swipe.state.open && (
        <button
          type="button"
          className="swipe-hit"
          style={{ width: REVEAL_PX }}
          aria-label={`Delete ${label}`}
          onClick={onDelete}
        />
      )}

      <button type="button" className="vh-button" onClick={onDelete}>
        Delete {label}
      </button>
    </div>
  );
}
