import { describe, expect, it } from "vitest";
import {
  nextUndo,
  pendingDeletionIds,
  pendingNote,
  pushDeletion,
  withoutDeletion,
} from "./undo-queue";

/** #90's sequence, which lost data: delete A, delete B, and A was gone with
 *  nothing on screen saying so. Every case here is that sequence taken one
 *  step further. */

const A = { id: "2026-08-15T07:10:00Z|breakfast" };
const B = { id: "2026-08-15T12:37:00Z|lunch" };
const C = { id: "2026-08-15T19:02:00Z|dinner" };

describe("the undo queue (#90)", () => {
  it("has nothing to undo when empty", () => {
    expect(nextUndo([])).toBeNull();
    expect(pendingNote([])).toBeNull();
    expect(pendingDeletionIds([])).toEqual(new Set());
  });

  /** The whole defect, pinned: a second delete must not replace the first. */
  it("keeps the first deletion restorable after a second one", () => {
    const queue = pushDeletion(pushDeletion([], A), B);
    expect(queue.map((q) => q.id)).toEqual([A.id, B.id]);
    expect(nextUndo(queue)).toBe(B);
  });

  it("undoes the most recent deletion and leaves the rest pending", () => {
    const two = pushDeletion(pushDeletion([], A), B);

    const afterFirstUndo = withoutDeletion(two, nextUndo(two)!);
    expect(afterFirstUndo.map((q) => q.id)).toEqual([A.id]);
    expect(nextUndo(afterFirstUndo)).toBe(A);

    const afterSecondUndo = withoutDeletion(afterFirstUndo, nextUndo(afterFirstUndo)!);
    expect(afterSecondUndo).toEqual([]);
    expect(nextUndo(afterSecondUndo)).toBeNull();
  });

  /** The optimistic filter. Both deleted rows have to stay off the screen
   *  until their refetch lands — filtering only the newest is how the first
   *  meal would flash back into the timeline it had just left. */
  it("hides every pending deletion, not just the one Undo names", () => {
    const queue = pushDeletion(pushDeletion([], A), B);
    const hidden = pendingDeletionIds(queue);
    expect(hidden.has(A.id)).toBe(true);
    expect(hidden.has(B.id)).toBe(true);
    expect(hidden.has(C.id)).toBe(false);
    expect(hidden.size).toBe(2);
  });

  /** The toast must say that more than one deletion is outstanding — naming
   *  only the newest is what made #90 invisible. */
  it("counts the OTHER pending deletions, not all of them", () => {
    expect(pendingNote([A])).toBeNull();
    expect(pendingNote([A, B])).toBe("1 MORE TO UNDO");
    expect(pendingNote([A, B, C])).toBe("2 MORE TO UNDO");
  });

  /** A delete can land while a restore POST is in flight. Removing by id
   *  rather than by position means the meal Undo was tapped for is the one
   *  that leaves, whatever arrived on top meanwhile. */
  it("drops the entry it was given, not whatever is now on top", () => {
    const queue = pushDeletion(pushDeletion(pushDeletion([], A), B), C);
    expect(withoutDeletion(queue, B).map((q) => q.id)).toEqual([A.id, C.id]);
  });

  /** A failed restore pushes the entry back on — the queue is the only copy
   *  of those rows left, so it must survive being handed back. */
  it("takes a returned entry back as the next undo", () => {
    const queue = pushDeletion(pushDeletion([], A), B);
    const inFlight = withoutDeletion(queue, B);
    const returned = pushDeletion(inFlight, B);
    expect(nextUndo(returned)).toBe(B);
    expect(returned.map((q) => q.id)).toEqual([A.id, B.id]);
  });

  /** State held across renders — a queue mutated in place would let React
   *  read the old array and see the new contents. */
  it("never mutates the queue it was given", () => {
    const queue = [A, B];
    pushDeletion(queue, C);
    withoutDeletion(queue, B);
    pendingDeletionIds(queue);
    expect(queue).toEqual([A, B]);
  });
});
