/** The star, drawn once (#103).
 *
 *  There are three of them now — the picks list's star, the camera deck's
 *  button that pulls the picks panel up, and the confirm sheet's star — and the
 *  path was inline in the first two. A third copy is where that stops being a
 *  duplicated glyph and starts being a way for two controls that mean *the same
 *  thing* to drift apart, which is the drift `Picks.tsx` already warns about one
 *  level up ("two rows that look the same until one of them quietly stops
 *  offering the star").
 *
 *  **Shape only.** What a star *looks like when it is on* is CSS (`.star-mark`),
 *  and where it sits is the caller's — this is `fill`/`stroke`-less on purpose
 *  so the button around it decides both. That split is why the deck button, which
 *  is not a star-state control at all, can share the mark without inheriting a
 *  state it doesn't have.
 */
export function StarGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6z" />
    </svg>
  );
}
