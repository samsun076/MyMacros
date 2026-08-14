/** Instrument log button (motif slot 3) — a machined knob (sketch: `.log-btn`).
 *
 *  A round control with a radial highlight at 34%/28%, a deep accent rim, and
 *  the ring stack that makes it read as *seated in* the panel rather than
 *  floating over it: a lit top edge, a paper gap, a milled outer ring, then a
 *  short drop. The stack is `--shadow-lift` in this pack, so only the shape and
 *  the face are here.
 */
export function LogButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="log-btn in-log-btn" aria-label="Log food" onClick={onClick}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="butt">
        <path d="M12 4.5v15M4.5 12h15" />
      </svg>
    </button>
  );
}
