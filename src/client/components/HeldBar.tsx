/** What the basket is holding, on the capture screen, and the way back to it
 *  (#81).
 *
 *  **The basket has to be visible from here.** An invisible basket is one a
 *  stray tap destroys without the user knowing what it cost — the failure #81
 *  names — and the only other way back to the sheet would be "capture something
 *  else", which strands anyone who taps Add another and then changes their
 *  mind. So it is a statement and a control at once: it says what is held and
 *  tapping it returns.
 *
 *  **It counts FOODS, not captures.** That is what the sheet below will draw
 *  and what the save will write. The dismiss guard counts captures instead, for
 *  the reason set out in `needsDismissConfirm` — the two are different
 *  questions and the numbers are allowed to disagree.
 *
 *  A component rather than markup because both stages of the log flow draw it,
 *  the same split `LogModes` already has: the camera stage carries it under the
 *  top bar, TEXT under the mode row. Two copies of a bar whose whole job is to
 *  be recognisable is exactly the drift `LogModes` exists to prevent. */
export function HeldBar({ held, onReview }: { held: number; onReview: () => void }) {
  return (
    <button type="button" className="held-bar" onClick={onReview}>
      <span className="mono">
        {held} {held === 1 ? "item" : "items"} held
      </span>
      <span className="held-cta">Tap to review</span>
    </button>
  );
}
