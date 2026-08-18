/** Weight smoothing (#18). Pure, shared, and the reason the budget engine
 *  doesn't read the scale directly.
 *
 *  Day-to-day bodyweight moves several pounds on water, salt and what is
 *  currently inside you. Budgeting against the raw latest number makes the
 *  daily target jitter by a few hundred kcal for reasons that have nothing to
 *  do with fat, and #18 is explicit that recalculation follows the *trend*.
 *
 *  It also holds what counts as a plausible weight at all (#99). Same subject,
 *  one import for anything that has to ask either question.
 */

import { kgToLb } from "./units";

/** One weigh-in, as little of the row as the maths needs. */
export type WeighIn = {
  /** YYYY-MM-DD, local to the user. */
  measured_on: string;
  weight_kg: number;
};

/** What a person can plausibly weigh, in kilograms. Stated once (#99).
 *
 *  Sanity bounds, not clinical ones — they exist to catch a slipped decimal or
 *  a pounds-shaped number typed into a kg field, both of which would move the
 *  target hundreds of kcal without looking wrong. (The argument is the
 *  Worker's own, and travelled here with the numbers.)
 *
 *  Here rather than beside the route that first wrote them down, because three
 *  places claimed to know this quantity and only two of them agreed — and they
 *  agreed by having been copied from one another. `POST /api/weights` and
 *  `tools/sync-garmin.py` both carried 20–400; the goal weight field carried
 *  `min: 1` and **no ceiling at all**, which is how 99,999 lb became a
 *  storable goal. #86's register defect, found by a person rather than a test.
 *
 *  `sync-garmin.py` is a separate runtime and cannot import this; it keeps its
 *  literals and a comment naming this file as what they track. */
export const MIN_WEIGHT_KG = 20;
export const MAX_WEIGHT_KG = 400;

/** The same window, as the number a *field* holds — which is not the number
 *  the database stores.
 *
 *  A weight field shows pounds for an imperial profile and converts on save,
 *  so a bound applied to the stored value means one thing to the user and
 *  another to the server: "max 400" would read as 400 lb on screen and admit
 *  881 lb underneath. Same class as Garmin reporting grams (#20), with the
 *  units the other way round. The bound belongs on the number being typed.
 *
 *  **It rounds inward, and that is the entire reason this is derived rather
 *  than a second pair of numbers.** 400 kg is 881.85 lb, so a displayed
 *  ceiling of 882 converts back to 400.07 and `POST /api/weights` refuses it —
 *  a field that takes a number and then fails on save is worse than one with
 *  no ceiling, because the failure is late and arrives with nothing on screen
 *  to have predicted it. `floor` on the max and `ceil` on the min are what
 *  make "nothing this field accepts is refused by the server" true by
 *  construction: 881 lb is 399.6 kg, and 44 lb is 19.96, which is under the
 *  floor. */
export function weightBounds(units: "imperial" | "metric"): { min: number; max: number } {
  if (units === "metric") return { min: MIN_WEIGHT_KG, max: MAX_WEIGHT_KG };
  return { min: Math.ceil(kgToLb(MIN_WEIGHT_KG)), max: Math.floor(kgToLb(MAX_WEIGHT_KG)) };
}

/** Days in the smoothing window, inclusive of the end day. */
export const TREND_WINDOW_DAYS = 7;

/** Shift a YYYY-MM-DD by whole days.
 *
 *  Deliberately all-UTC. These strings are calendar dates, and building a
 *  local `Date` from one puts users in a negative UTC offset on the previous
 *  day — a bug that would show up as a trend window quietly one day short,
 *  for some users, some of the year. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** What this person weighs *now* — the trend measured at [[anchorDay]].
 *
 *  The one function anything outside this module should call to ask that
 *  question. `refreshTarget` derives the stored target from it and `/api/me`
 *  reports it, so the budget a screen previews and the budget the Worker
 *  stores are computed from the same number by construction.
 *
 *  #78 is what happens without it: the Settings preview read
 *  `profiles.start_weight_kg` — the weight typed at onboarding and never
 *  updated — so two screens showed two different base targets, each arithmetically
 *  perfect. */
export function currentTrendWeightKg(entries: WeighIn[], today: string): number | null {
  return trendWeightKg(entries, anchorDay(entries, today));
}

/** The day the trend is measured *at*: the later of the server's idea of today
 *  and the newest weigh-in on file.
 *
 *  Clamping to `today` alone silently drops a weigh-in dated ahead of it, and
 *  the two disagree more often than they look like they should:
 *  `profiles.timezone` is a stored default until the client overwrites it
 *  (#44), the client owns its own day, and the two sit on opposite sides of
 *  midnight for several hours every evening. The symptom is the worst kind —
 *  the newest weight is invisible, `computeBudget` declines for want of data,
 *  and the stored target simply stays where it was. Caught during M4's own
 *  verification: a fresh profile stayed on the M2 default of 1,810 while the
 *  day endpoint happily reported `onboarded: true`.
 *
 *  There is nothing to protect by refusing a future date. The question is
 *  "what does this person weigh now", and the newest weight is the best
 *  evidence available whichever day it is stamped with.
 *
 *  Lives here, not in `refreshTarget`, because `/api/me` has to answer the
 *  same question and two copies of this rule would drift (#78). */
export function anchorDay(entries: WeighIn[], today: string): string {
  const newest = entries.reduce<string | null>(
    (max, e) => (max === null || e.measured_on > max ? e.measured_on : max),
    null,
  );
  return newest && newest > today ? newest : today;
}

/** The smoothed weight for `on`: the mean of every weigh-in in the trailing
 *  7-day window ending that day, inclusive.
 *
 *  A plain trailing mean rather than anything exponential — it is what "7-day
 *  smoothed" says, it is what the trend line draws, and one weigh-in cannot
 *  move it more than a seventh of the way.
 *
 *  **Falls back to the most recent weigh-in on or before `on`** when the
 *  window is empty. Someone who weighs in fortnightly still needs a target,
 *  and a null there would silently freeze their budget at whatever it last
 *  was. Returns null only when there is genuinely nothing to go on.
 *
 *  Takes an explicit day because the trends screen asks it for every past day
 *  in a window. For "now", call [[currentTrendWeightKg]] instead. */
export function trendWeightKg(entries: WeighIn[], on: string): number | null {
  const from = shiftDay(on, -(TREND_WINDOW_DAYS - 1));

  const window = entries.filter((e) => e.measured_on >= from && e.measured_on <= on);
  if (window.length) {
    const sum = window.reduce((t, e) => t + e.weight_kg, 0);
    return round1(sum / window.length);
  }

  const previous = entries
    .filter((e) => e.measured_on <= on)
    .sort((a, b) => (a.measured_on < b.measured_on ? 1 : -1))[0];

  return previous ? round1(previous.weight_kg) : null;
}

/** The series the trends screen draws: one point per day that has a weigh-in,
 *  oldest first, each carrying its own smoothed value.
 *
 *  Points only on days with data — interpolating the gaps would draw a line
 *  through weigh-ins that never happened. */
export function trendSeries(entries: WeighIn[]) {
  const days = [...new Set(entries.map((e) => e.measured_on))].sort();
  return days.map((measured_on) => {
    const sameDay = entries.filter((e) => e.measured_on === measured_on);
    const raw = sameDay.reduce((t, e) => t + e.weight_kg, 0) / sameDay.length;
    return {
      measured_on,
      weight_kg: round1(raw),
      // non-null by construction: this day has at least one weigh-in
      trend_kg: trendWeightKg(entries, measured_on) as number,
    };
  });
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
