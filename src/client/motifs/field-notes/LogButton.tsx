/** Field Notes log button (motif slot 3) — a vermilion disc pinned to the
 *  page (sketch: `.logbtn`).
 *
 *  Round rather than Night Athletic's rounded square, and ringed in the paper
 *  colour rather than lifted on a shadow: `--shadow-lift` in this pack is a 4px
 *  paper ring plus a short drop, so the button reads as *sitting on* the sheet
 *  where Night Athletic's floats above glass. The stroke is heavier to match
 *  the stamp's rule weight.
 */
export function LogButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="log-btn fn-log-btn" aria-label="Log food" onClick={onClick}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth="3" strokeLinecap="square">
        <path d="M12 4v16M4 12h16" />
      </svg>
    </button>
  );
}
