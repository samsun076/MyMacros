/** The deletions still waiting for an Undo (#90).
 *
 *  #52 held exactly one. Delete a second meal before tapping Undo and the
 *  first one's held rows were overwritten — and since the delete had already
 *  reached D1, that client-side slot was the only place the meal still
 *  existed. It lost data, silently, and the toast then named the *second*
 *  meal, so nothing on screen said the first had stopped being restorable.
 *
 *  **LIFO, and Undo restores one deletion at a time.** Restore-all was
 *  considered and rejected: it cannot put back only the one you regret, so
 *  clearing three duplicate logs and changing your mind about one of them
 *  would mean deleting two of them a second time. Tapping Undo N times walks
 *  back N deletions in reverse order, which is what every other undo does.
 *
 *  Kept here as plain functions over a plain array so the state transitions
 *  have a test that isn't a rendered component — the house idiom, same as
 *  `timeline.ts`.
 */

/** A queued deletion is identified by the same key the timeline renders it
 *  under — `logged_at|meal_slot`, `foldMeals`' own grouping key. Two queued
 *  deletions cannot collide on it: while a meal is queued it is filtered off
 *  the screen, so there is nothing left to swipe a second time. */
export type Deletion = { id: string };

/** Newest last. The array's tail is the top of the stack. */
export function pushDeletion<T extends Deletion>(queue: readonly T[], entry: T): T[] {
  return [...queue, entry];
}

/** What Undo acts on right now — the most recent deletion, or nothing. */
export function nextUndo<T extends Deletion>(queue: readonly T[]): T | null {
  return queue.length > 0 ? queue[queue.length - 1]! : null;
}

/** Drop one deletion from the queue, by id rather than by position.
 *
 *  By id because the entry Undo was tapped for is the one that must leave: a
 *  delete can land while the restore POST is still in flight, and popping
 *  "whatever is on top" at that moment would drop the wrong meal from the
 *  queue while restoring this one. */
export function withoutDeletion<T extends Deletion>(queue: readonly T[], entry: Deletion): T[] {
  return queue.filter((q) => q.id !== entry.id);
}

/** Every id the timeline must keep hidden.
 *
 *  A deleted meal is gone from the server the moment the toast appears, but
 *  the refetch lands a beat later — without this the row flashes back onto the
 *  screen in between. With one `undoable` a single `!==` covered it; with a
 *  queue every pending deletion has to be filtered, or the second delete
 *  resurrects the first one's row. */
export function pendingDeletionIds(queue: readonly Deletion[]): Set<string> {
  return new Set(queue.map((q) => q.id));
}

/** The toast's second fact: how many *other* deletions are still restorable.
 *
 *  Null for the ordinary one-deletion case, where saying "0 more" would be
 *  noise. The toast names the meal Undo will restore; this says there is more
 *  behind it — the pair of facts #90 asks for, since either alone still lets
 *  someone believe the first deletion is beyond reach. */
export function pendingNote(queue: readonly Deletion[]): string | null {
  const others = Math.max(queue.length - 1, 0);
  return others > 0 ? `${others} MORE TO UNDO` : null;
}
