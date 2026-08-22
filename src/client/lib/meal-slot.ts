import { useEffect, useState } from "react";
import type { MealSlot } from "../../shared/api";
import { mealSlotFor } from "./day";

/** The meal slot as a *live* value — the one that keeps saying the truth while
 *  a screen is left open across a boundary (#116).
 *
 *  `mealSlotFor` is a pure read of the clock and stays that way in `day.ts`;
 *  what is here is the only thing it cannot answer on its own: **when does its
 *  answer change, and who is told?** Until #116 nobody was. `Picks` called
 *  `mealSlotFor()` during render, so `LOGS AS BREAKFAST` was correct at the
 *  moment the panel opened and never again — 11:59 to 12:01 with the panel up
 *  left the statement stale until something unrelated re-rendered the screen.
 *
 *  **That was survivable while the statement scrolled away and is not now.**
 *  #116 merges it into the sticky grab band precisely so it is on screen at the
 *  moment of the tap, and a permanently-visible wrong answer is worse than an
 *  accurate one that scrolled off: the tap is a write with no confirm sheet, so
 *  the statement is the only thing between a thumb and a row in the wrong meal.
 *
 *  **Nothing here restates where the boundaries are.** They live in
 *  `mealSlotFor` and in no second place — `msUntilSlotChange` *searches* for
 *  the next hour whose slot differs rather than carrying a copy of 11/16/21,
 *  which is the register's rule (#86) applied to a quantity that is easy to
 *  duplicate as a schedule. Change `mealSlotFor` and this follows with no edit.
 */

/** Fire this long *after* the boundary rather than exactly on it.
 *
 *  A timer that lands a hair early — a clock stepped backwards by NTP is the
 *  realistic way — re-reads the *old* slot and re-arms for the millisecond it
 *  was short by. Harmless in itself (`msUntilSlotChange` never returns zero, so
 *  it cannot spin), but the bar would flicker the old answer for a frame.
 *
 *  **It is also the whole window in which the bar and the write can disagree**,
 *  which is why it is a quarter of a second rather than a comfortable few.
 *  `relog` in `Log.tsx` stamps `meal_slot` from `mealSlotFor()` at the moment of
 *  the tap — the truth, and correctly not the rendered value — so between the
 *  boundary and this tick the statement is behind the row it is describing. The
 *  window before #116 was unbounded: the statement was read once at render and
 *  nothing re-read it. This is that bug given a ceiling, not a new one. */
export const SLOT_TICK_SLACK_MS = 250;

/** Milliseconds from `now` until `mealSlotFor` would answer differently.
 *
 *  Derived by asking `mealSlotFor` rather than by knowing the schedule — see
 *  the file comment. Slots only ever change on an hour boundary, so walking
 *  forward an hour at a time finds the next one exactly.
 *
 *  `slotAt` exists so a test can drive the degenerate case where nothing ever
 *  changes; it is `mealSlotFor` in every caller. Its fallback is an hour — a
 *  re-check rather than a promise, which is the right degrade for a header
 *  that is merely stale rather than broken. */
export function msUntilSlotChange(
  now: Date = new Date(),
  slotAt: (d: Date) => MealSlot = mealSlotFor,
): number {
  const slot = slotAt(now);
  for (let i = 1; i <= 24; i++) {
    const at = new Date(now.getTime());
    // setHours normalises past midnight, so this crosses the day boundary that
    // turns snack back into breakfast without a special case.
    at.setHours(now.getHours() + i, 0, 0, 0);
    if (slotAt(at) !== slot) return at.getTime() - now.getTime();
  }
  return 60 * 60 * 1000;
}

/** The current meal slot, re-rendered when it changes.
 *
 *  One timer per mount, re-armed from `msUntilSlotChange` each time it fires —
 *  not an interval, because a tick every minute to catch three changes a day is
 *  three orders of magnitude of wasted wakeups on a phone.
 *
 *  **`visibilitychange` as well as the timer, and it is not belt-and-braces.**
 *  An installed PWA is suspended when it is backgrounded; whether an overdue
 *  timer fires promptly on resume is the platform's business rather than ours,
 *  and the failure mode is exactly the one this hook exists to prevent — a
 *  panel restored at 12:30 still reading BREAKFAST. Re-reading the clock on the
 *  way back in makes the guarantee independent of timer semantics. Same reason
 *  headless Chrome cannot check it: nothing here is ever backgrounded. */
export function useMealSlot(): MealSlot {
  const [slot, setSlot] = useState<MealSlot>(mealSlotFor);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setSlot(mealSlotFor());
      timer = setTimeout(tick, msUntilSlotChange() + SLOT_TICK_SLACK_MS);
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return slot;
}
