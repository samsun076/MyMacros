/** The Today timeline's order, and the two things that read positionally
 *  (#80).
 *
 *  The list renders **newest first** so the entry you just saved lands
 *  directly under the TIMELINE header instead of below the fold — the
 *  `.fresh` wash exists to say "this is the one you just added", and appended
 *  to the bottom of a day's meals it rendered where you could not see it.
 *
 *  Two things in that screen were indexed rather than named, and reversing the
 *  list breaks both silently:
 *
 *    - **the header span** printed `entries[0] — entries[last]`, which on a
 *      reversed array reads "12:37P — 6:55A". It looks like a data bug, not a
 *      layout choice.
 *    - **the fresh flag** was `i === entries.length - 1`, which on a reversed
 *      array puts the just-saved wash on the oldest meal of the day.
 *
 *  So both are computed here, from one chronological input, in one call. A
 *  caller cannot reverse the list for one and forget the other, because it
 *  never holds a reversed list of its own.
 */

export type Timed = { when: string };

export type TimelineView<T> = {
  /** Newest first — the render order. */
  rows: (T & { fresh: boolean })[];
  /** "6:04A — 3:05P", always earliest to latest whatever `rows` does. */
  span: string;
};

export function timelineView<T extends Timed>(
  entries: readonly T[],
  /** True when this render follows a save, so one row wears the wash. */
  justSaved: boolean,
): TimelineView<T> {
  const rows = entries.toReversed().map((entry, i) => ({ ...entry, fresh: justSaved && i === 0 }));
  return { rows, span: timeSpan(entries) };
}

/** "6:04A — 3:05P" — the sec-head span (sketch's compressed meridian).
 *  Takes the CHRONOLOGICAL list; that is the whole contract. */
function timeSpan(entries: readonly Timed[]): string {
  if (entries.length === 0) return "—";
  const compress = (when: string) => when.replace(" AM", "A").replace(" PM", "P");
  const first = compress(entries[0]!.when);
  const last = compress(entries[entries.length - 1]!.when);
  return entries.length === 1 ? first : `${first} — ${last}`;
}
