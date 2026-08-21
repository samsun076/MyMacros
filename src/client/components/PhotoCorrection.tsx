/** Telling the reader it got the food wrong (#59).
 *
 *  The complaint: a photo came back "ham and cheese" when there was no ham in
 *  it. No amount of macro editing fixes that — you would have to know what a
 *  hamless version weighs — so the sheet's per-item editor, which is the right
 *  answer for "that's 80 kcal out", is the wrong one here. This is its missing
 *  sibling: a way to correct the *reading* rather than the numbers.
 *
 *  **It belongs to ONE capture and sits under that capture's rows.** A basket
 *  is a list of captures (#81) and a note is about the photograph one of them
 *  came from; a control in the footer would read as a claim about the whole
 *  sheet and would throw away a scanned bun because the plate was misread. With
 *  a single capture that is the whole sheet, which is today's common case and
 *  is exactly why the distinction is easy to lose.
 *
 *  **Reachable without dismissing the sheet**, which is the whole placement
 *  argument. `dismiss()` throws the read away and drops back to a live
 *  viewfinder — the opposite of what someone mid-correction wants — so the
 *  correction may not be routed through it, and the sheet must not so much as
 *  look dismissed while the re-read runs.
 *
 *  Markup only: every decision it draws lives in `lib/basket.ts` (`correctable`,
 *  `reread`, `roomForReread`) or in `Log.tsx`'s one `Correction` state, for
 *  #100's reason and #81's finding — nothing in this repo executes a component,
 *  so a rule that lives in one has no oracle at all. */

/** Telling the reader it got the food wrong: which capture, what is being said
 *  about it, and how the re-read of that capture's photo is going.
 *
 *  **One value, not four.** Which capture, the text, in-flight and the failure
 *  are four facts about one thing; held apart they are four ways to end up with
 *  a spinner on a form that is closed, or a failure sentence about a capture
 *  that has been discarded. `null` is the whole answer to "is anybody
 *  correcting anything?" — #112's rule that a condition and its dependencies
 *  should be one statement rather than a list. */
export type Correction = {
  /** Index into the basket. */
  capture: number;
  note: string;
  busy: boolean;
  error: string | null;
};

/** The most a note may be, restated from the route's own `NOTE_MAX`.
 *
 *  **Carried, not shared, and each side enforces independently** — the house
 *  pattern `FOOD_LIMITS` follows against `normalize`'s ceilings. The route
 *  trims rather than refuses, so a drifted copy here costs a silently
 *  truncated sentence and never a rejected save; what it buys is a field that
 *  stops accepting characters at the point they would stop counting, instead of
 *  letting somebody type a paragraph the reader will never see. */
const NOTE_MAX = 300;

export function PhotoCorrection({
  manual,
  sent,
  state,
  onOpen,
  onNote,
  onCancel,
  onSubmit,
}: {
  /** #16's blank recovery row: the read *failed* rather than got it wrong, so
   *  the same control is a second attempt rather than a correction. Different
   *  sentence, identical mechanism — the photo is in R2 either way. */
  manual: boolean;
  /** The note that produced what is on screen, if one did.
   *
   *  **A re-read that changes nothing is indistinguishable from a dead
   *  button**, and the model is entitled to hold its answer — "no ham" on a
   *  photo that does contain ham comes back the same. Echoing what was said is
   *  what separates "it heard you and disagreed" from "nothing happened". */
  sent: string | undefined;
  /** This capture's correction, or null when nobody is correcting this one. */
  state: Correction | null;
  onOpen: () => void;
  onNote: (note: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const busy = state?.busy === true;

  return (
    <div className="correct" aria-busy={busy}>
      {sent !== undefined && (
        <p className="opt-hint correct-sent">YOU TOLD IT: “{sent}”</p>
      )}

      {state === null ? (
        <button type="button" className="btn-text correct-open" onClick={onOpen}>
          {manual ? "Try the reader again with a note" : "Wrong food? Tell the reader"}
        </button>
      ) : (
        <>
          {/* Names the PHOTO, not "it". In a basket the block sits between one
              capture's last row and the next capture's first, and "what did it
              get wrong?" there is a question about an unnamed thing — the same
              ambiguity #81's per-row provenance line exists to remove. */}
          <label className="eyebrow" htmlFor="correct-note">
            {manual ? "What was in the photo?" : "What did the photo get wrong?"}
          </label>
          <textarea
            id="correct-note"
            className="correct-note"
            value={state.note}
            onChange={(e) => onNote(e.target.value)}
            placeholder={manual ? "two slices of pizza and a side salad" : "no ham — it's just cheese"}
            maxLength={NOTE_MAX}
            rows={2}
            disabled={busy}
            autoFocus
          />
          {/* Honest about the wait rather than optimistic about it. This is a
              second ~5s round trip in front of somebody who is already annoyed
              (#49 measured the first one), and a control that says nothing
              about that reads as broken at four seconds. */}
          <p className="opt-hint">
            {busy
              ? "READING THE PHOTO AGAIN — THIS TAKES A FEW SECONDS"
              : "IT READS THE PHOTO AGAIN AND TRUSTS YOUR NOTE OVER THE PICTURE"}
          </p>
          {/* **No accent here, and it was measured before it was decided.**
              The first cut made "Read it again" a `.btn-accent`, which put two
              filled accent buttons on one sheet about 100px apart — the
              hierarchy complaint `.sheet-add-another` already records, with
              the secondary shouting in the primary's register. Rule 5 spends
              the accent on `Log N kcal`, and the sheet's only other nested
              decision block (#81's dismiss guard) is quiet-plus-text for
              exactly this reason. The action leads because it is what the
              block was opened to do; the way out is text beside it. */}
          <div className="correct-acts">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={onSubmit}
              disabled={busy || !state.note.trim()}
            >
              {busy ? "Reading it again…" : "Read it again"}
            </button>
            <button type="button" className="btn-text" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
          {/* #16: a failed re-read leaves every item and the photo exactly
              where they were, and says so in as many words — the sentence is
              the only thing on screen that changes. */}
          {state.error && (
            <p className="signin-error" role="alert">
              {state.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
