import { useRef, type ReactNode } from "react";
import { DELETE_CONTROL_ATTR, useCloseOnOutsideTap, useSwipeToReveal } from "../lib/swipe";

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
 *  control the gesture reveals cannot be reached by a pointer that has no
 *  way to drag. Its label names the meal, since "Delete" repeated down a list of
 *  three tells a screen-reader user nothing about which one. It carries
 *  `DELETE_CONTROL_ATTR` for the same reason the revealed strip does: the
 *  outside-tap rule must not close the row out from under the delete that is
 *  already unmounting it.
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
      {/* **The row does not move** (#91). It used to: row and panel rode one
          flex track that translated left, which slid the row's own first five
          or six characters out under the clip edge — the name of the meal you
          were about to destroy, unreadable at exactly the moment you needed
          it. Now the body is static and the panel slides in over its right
          edge, so the name never moves and never has to move back.

          Two earlier shapes were both wrong and both looked plausible: a panel
          laid *behind* the row needed an opaque row (a card appeared behind
          every timeline entry), and removing that background showed the trash
          can on all three rows at once. Off-stage and sliding in over the top
          needs neither a background nor a z-index — an absolutely positioned
          sibling already paints above static content. */}
      <div className="swipe-body" {...swipe.handlers}>
        {children}
      </div>

      {/* `aria-hidden` because the visually-hidden button below is this
          action's accessible form — exposing both would put two "delete this
          meal" controls in the tree for one action.

          A percentage of its OWN width, so the component never learns how wide
          the capsule is: 100% is fully off-stage past `.swipe`'s clip edge, 0
          is home. The only number crossing this boundary is how far in the
          gesture is. */}
      <div
        className="swipe-panel"
        aria-hidden="true"
        style={{
          transform: `translate3d(${(1 - swipe.state.progress) * 100}%,0,0)`,
          // No easing while a finger is down, or the panel lags behind it.
          transition: swipe.state.dragging ? "none" : undefined,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      </div>

      {/* Tapping the revealed control is what actually deletes. It sits above
          the panel rather than inside it, and is **deliberately larger than
          the thing it deletes**: the capsule is 32px wide, which is well under
          44pt, so the hit area covers it plus the gutter the row hands back.
          It only exists while open — an invisible button under a closed row is
          a mis-tap waiting to happen. Its size is `.swipe-hit`'s, in CSS, next
          to the capsule's own, so the two cannot drift apart. */}
      {open && (
        <button
          type="button"
          className="swipe-hit"
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
