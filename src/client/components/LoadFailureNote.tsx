import type { LoadFailure } from "../lib/load-failure";

/** The one way this app says a read failed (#24).
 *
 *  **One rendering, not one per screen.** Five screens had five answers to
 *  this: Today and Trends said nothing at all and went blank, Weight said "No
 *  weigh-ins yet" — which is a *lie* on a failed fetch, not a placeholder —
 *  and Settings and Sources each had their own sentence with no way to retry.
 *  A second rendering beside this one is the shape the "one quantity, one
 *  source" register warns about: two blocks that look the same until one of
 *  them quietly stops offering the button.
 *
 *  **A retry, not a reload.** `useApi` already hands out `reload`, and the
 *  screen re-fetches in place. `window.location.reload()` would throw away the
 *  service worker's warm shell (#54), the session check, and any other screen
 *  state, to re-issue the same request this button issues on its own.
 *
 *  **Neutral, deliberately.** No `--accent`: build rule 8 spends that on the
 *  focus macro and rule 5 lets a user switch it live, so a failure card in
 *  accent changes colour when someone picks gold. No `--danger` either — rule
 *  9 keeps it narrow and sign-carrying, and "the network dropped" carries no
 *  sign about the person's day. What makes this legible is the words.
 *
 *  It renders `role="alert"` because it replaces content that was expected: a
 *  screen reader that has just been handed a heading and silence needs to be
 *  told why, and the whole point of the issue is that silence was the bug.
 */
export function LoadFailureNote({
  what,
  failure,
  onRetry,
}: {
  /** The subject that didn't load, as a noun phrase: "Today's numbers". Reads
   *  as `<what> didn't load.` in front of the failure's own sentence. */
  what: string;
  failure: LoadFailure;
  onRetry: () => void;
}) {
  return (
    <div className="load-fail" role="alert">
      <span className="eyebrow">{failure.title}</span>
      <p className="opt-hint">
        {what} didn't load. {failure.detail}
      </p>
      {failure.retry && (
        <button type="button" className="btn btn-quiet" onClick={onRetry}>
          Try again
        </button>
      )}
      <span className="mono">{failure.mono}</span>
    </div>
  );
}
