/** The trends screen's arithmetic (#22). Pure, shared, and deliberately not
 *  in the route.
 *
 *  Two reasons it lives here rather than in `src/worker/routes/trends.ts`.
 *  The first is the M4 convention (`budget.ts`, `weight.ts`): the maths that
 *  decides what a number means gets unit tests measured in milliseconds. The
 *  second is #72 — nothing behind `requireAuth` can be route-tested at all
 *  today, so anything left in the route is untested by construction.
 *
 *  Everything is SI and every date is YYYY-MM-DD text local to the user. No
 *  `Date` arithmetic on those strings beyond `shiftDay`'s all-UTC helper: a
 *  local `Date` built from a calendar date lands on the previous day for
 *  anyone west of Greenwich.
 */

import type { ActivityLevel, Goal, Sex, TrendRate, TrendWeek, TrendsResponse } from "./api";
import { computeBudget, earnedKcal } from "./budget";
import { shiftDay, trendSeries, trendWeightKg, type WeighIn } from "./weight";

/** kcal in a kilogram of body tissue, for turning a deficit into a rate.
 *
 *  7,700 (3,500 per pound) is the Wishnofsky figure. It is a rule of thumb
 *  from 1958, it assumes the tissue lost is pure fat, and it is known to
 *  overstate long-run loss because expenditure falls as mass does. It is here
 *  because it is the convention every calorie tracker uses and a reader
 *  comparing apps would be confused by anything else — NOT because it is a
 *  law. It is exactly why the modelled rate is the small number on screen and
 *  the scale's own slope is the big one. */
export const KCAL_PER_KG = 7700;

/** Logged days needed before the window's mean deficit — and the rate derived
 *  from it — are reported at all.
 *
 *  Two weeks, because that is the shortest window in which a single unlogged
 *  weekend stops dominating the mean. Below it the fields are null and the
 *  screen says why; it does not show a number with a caveat attached, because
 *  a number with a caveat attached is a number people quote. */
export const MIN_LOGGED_DAYS = 14;

/** The share of a day's base target that has to be logged before the day is
 *  treated as a complete record of what was eaten (#74).
 *
 *  `logged_days` used to mean "the day has at least one row", so a single black
 *  coffee made a day worth as much as one logged in full. Measured against
 *  production: a week containing a 77-kcal day reported a 1,263 kcal/day
 *  deficit next to a reassuring "6/7 DAYS" — about double the truth, in the
 *  direction that flatters.
 *
 *  0.6 is a judgement, not a discovery, and it is the *lower* end of the range
 *  considered so that a genuinely light day survives it. It errs safely by
 *  construction: the days it drops are the low-intake ones, which carry the
 *  LARGEST deficits, so excluding them can only pull the reported deficit down.
 *  Understating progress is the acceptable failure here.
 *
 *  Judged against the base target, not base + earned: the target is the stable
 *  per-person figure, and a day's run should not raise the bar for what counts
 *  as having logged it. */
export const MIN_LOGGED_SHARE = 0.6;

/** Days the weigh-ins must span before a slope is drawn from them.
 *
 *  The trend *line* draws from the first weigh-in — it is what the budget
 *  follows, so it is the truth of the app whatever its length. The slope is
 *  different: a rate off five mornings is water, reported to two decimal
 *  places. The line isn't the lie; the slope is. */
export const MIN_TREND_SPAN_DAYS = 14;

/** The profile fields this screen needs. A subset of `Profile`, restated so
 *  the pure layer never imports a database row. */
export type TrendsProfile = {
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  activity_level: ActivityLevel;
  goal: Goal;
  deficit_kcal: number;
  eat_back_pct: number;
};

/** A per-day total, keyed by the local day it belongs to. */
export type DayKcal = { day: string; kcal: number };

export type TrendsInputs = {
  /** The client's own today (#44). The window ends where the user is, not
   *  where the Worker's UTC clock is. */
  today: string;
  /** How many calendar weeks to cover, including the current partial one. */
  weeks: number;
  /** Weigh-ins covering the window plus a six-day lead-in, so the first day's
   *  trailing 7-day window is complete rather than quietly short. */
  weighIns: WeighIn[];
  /** One entry per day that has at least one food log. **A day missing from
   *  this list was not logged**, which is not a day of zero intake. */
  intake: DayKcal[];
  /** Total run calories per day, as the watch reported them. */
  runs: DayKcal[];
  profile: TrendsProfile;
};

/** Monday of the week `day` falls in.
 *
 *  Calendar weeks rather than trailing 7-day blocks anchored on today: with
 *  blocks, every bar on the screen changes value every morning, and "last
 *  week" stops being a thing you can point at. The cost is one partial bar,
 *  which is marked. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  // getUTCDay: 0 = Sunday. Shift so Monday is 0 and Sunday is 6.
  const backToMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return shiftDay(day, -backToMonday);
}

/** Whole days from `from` to `to`, negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** What one day looked like, before it is folded into a week. */
type DailyFrame = {
  day: string;
  /** Maintenance for that day's trend weight; null before onboarding. */
  tdee: number | null;
  /** The base target that day's weight implies; null before onboarding. */
  base: number | null;
  /** Run calories as the watch reported them. */
  runKcal: number;
  /** The share of them that extended the budget (#21). */
  earned: number;
  /** Null means NOT LOGGED. It never means zero. */
  intake: number | null;
  /** expenditure − intake. Null when either side is unknown. */
  deficit: number | null;
  /** Logged thoroughly enough to average (#74) — and not today. */
  counted: boolean;
};

/** Everything the trends screen draws, from four flat lists and a profile.
 *
 *  ### The historical target is reconstructed, not recalled
 *
 *  `profiles.target_kcal` is a single stored current value — what the target
 *  *was* three weeks ago is not written down anywhere. So each day's target
 *  and maintenance are recomputed here from that day's 7-day trend weight and
 *  the profile as it stands **now**.
 *
 *  That is honest arithmetic and the only option short of a daily-snapshot
 *  table, but it has a consequence worth stating plainly: changing your
 *  activity level or goal rewrites every week on this screen retroactively.
 *  The numbers are "what the model says those weeks were", not "what the app
 *  told you at the time".
 */
export function buildTrends(i: TrendsInputs): TrendsResponse {
  const to = i.today;
  const from = shiftDay(weekStart(to), -7 * (Math.max(1, i.weeks) - 1));

  const intakeByDay = new Map(i.intake.map((d) => [d.day, d.kcal]));
  const runsByDay = new Map(i.runs.map((d) => [d.day, d.kcal]));

  const frames: DailyFrame[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const budget = computeBudget(
      {
        sex: i.profile.sex,
        birth_date: i.profile.birth_date,
        height_cm: i.profile.height_cm,
        // the smoothed weight, never the raw scale reading (#18) — the same
        // input the engine itself budgets against
        weight_kg: trendWeightKg(i.weighIns, day),
        activity_level: i.profile.activity_level,
        goal: i.profile.goal,
        deficit_kcal: i.profile.deficit_kcal,
      },
      // age is a calendar question and `day` is the calendar answer; noon UTC
      // keeps it away from either midnight
      new Date(`${day}T12:00:00Z`),
    );

    const runKcal = runsByDay.get(day) ?? 0;
    const intake = intakeByDay.get(day) ?? null;

    /* Expenditure takes the FULL run calories.
     *
     * `earned` below is the same day's run put through `eat_back_pct`, and it
     * is deliberately not what the deficit subtracts. The eat-back percentage
     * is a hedge against the watch over-reporting — it decides what you are
     * allowed to eat, it is not a claim about how much you burned. Using it
     * here would apply the hedge a second time and understate every deficit
     * by half a run, which is the shape of error this project keeps
     * producing: plausible, consistent, and wrong by a fixed fraction. */
    const expenditure = budget === null ? null : budget.tdee + runKcal;

    const base = budget?.target_kcal ?? null;

    frames.push({
      day,
      tdee: budget?.tdee ?? null,
      base,
      runKcal,
      earned: earnedKcal(runKcal, i.profile.eat_back_pct),
      intake,
      deficit: expenditure === null || intake === null ? null : expenditure - intake,
      /* Counted means: logged, thoroughly enough, on a day we can judge, and
       * not today.
       *
       * Today is never counted whatever is in it. It is incomplete by
       * definition — at breakfast it holds one meal, and no threshold can tell
       * that apart from a day someone barely ate. Before this, today's 270
       * kcal counted as a full day and reported the current week at
       * −1,889/day: the same defect the threshold fixes, wearing a hat.
       *
       * A day with no base target is NOT counted, and getting that backwards
       * is worth a note because the first attempt did. Treating "nothing to
       * judge against" as "pass" sounds generous and is how 2026-08-04 — a
       * 742-kcal day sitting before the first weigh-in, so no trend weight, so
       * no target — got averaged into the intake while being excluded from the
       * deficit. The means then ran over different denominators, which is the
       * precise error the comment in foldWeeks warns about. Requiring a base
       * makes `counted` the single denominator for every mean below. */
      counted:
        intake !== null && day !== to && base !== null && intake >= base * MIN_LOGGED_SHARE,
    });
  }

  const weeks = foldWeeks(frames, to);

  // points only inside the window: the lead-in exists to make the first day's
  // smoothing complete, not to be drawn
  const series = trendSeries(i.weighIns).filter((p) => p.measured_on >= from && p.measured_on <= to);

  const logged = frames.filter((f) => f.intake !== null);
  const counted = frames.filter((f) => f.counted);
  // the 14-day floor now counts thoroughly-logged days, not days with a row in
  // them — a fortnight of coffees was never a fortnight of evidence
  const meanDeficit =
    counted.length >= MIN_LOGGED_DAYS
      ? Math.round(mean(counted.map((f) => f.deficit as number)))
      : null;

  const span = series.length
    ? daysBetween(series[0]!.measured_on, series[series.length - 1]!.measured_on) + 1
    : 0;

  const rate: TrendRate = {
    observed_kg_per_week: observedRateKgPerWeek(series),
    /* NEGATED, and that is the whole point of this line.
     *
     * A positive deficit is energy *out*, which predicts weight going *down* —
     * so it has to arrive with the same sign as the observed slope, which is
     * negative when you are losing. Without this the screen sets a negative
     * measured rate beside a positive modelled one, both rendered as bare
     * magnitudes, and the reader compares "0.23" to "0.72" as though they
     * agreed about direction. Caught by reading the live payload, not by a
     * test — the arithmetic was right and the convention was not.
     *
     * null propagates from the gate above: one gate, both fields, because a
     * rate is just this number in different units. */
    predicted_kg_per_week:
      meanDeficit === null ? null : round2(-(meanDeficit * 7) / KCAL_PER_KG),
    deficit_kcal: meanDeficit,
    logged_days: logged.length,
    counted_days: counted.length,
    weigh_in_span_days: span,
  };

  return {
    from,
    to,
    weeks,
    series,
    rate,
    // computeBudget returns null for exactly the same reason `/api/day` reports
    // onboarded: false — it is missing a Mifflin-St Jeor input
    onboarded: frames.some((f) => f.base !== null),
  };
}

/** Fold days into Monday-start weeks. */
function foldWeeks(frames: DailyFrame[], today: string): TrendWeek[] {
  const buckets = new Map<string, DailyFrame[]>();
  for (const frame of frames) {
    const key = weekStart(frame.day);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(frame);
    else buckets.set(key, [frame]);
  }

  const currentWeek = weekStart(today);

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([starts_on, days]): TrendWeek => {
      /* Every mean below is over the COUNTED days — the ones logged thoroughly
       * enough to be a record of what was eaten (#74) — including the target
       * and earned ones. Averaging intake over one set of days while averaging
       * the target over another compares two different weeks, and the error
       * runs in whichever direction the missing days happened to go, so it
       * isn't even a consistent bias you could correct for. */
      const logged = days.filter((d) => d.intake !== null);
      // `counted` requires a base target, and a base implies a TDEE, so this
      // is the ONE denominator — intake, target, earned and deficit all divide
      // by the same days. Subsets diverging is how the first cut of #74 went
      // wrong.
      const counted = days.filter((d) => d.counted);

      return {
        starts_on,
        days: days.length,
        logged_days: logged.length,
        counted_days: counted.length,
        partial: starts_on === currentWeek || days.length < 7,
        intake_kcal: counted.length
          ? Math.round(mean(counted.map((d) => d.intake as number)))
          : null,
        target_kcal: counted.length
          ? Math.round(mean(counted.map((d) => d.base as number)))
          : null,
        earned_kcal: counted.length ? Math.round(mean(counted.map((d) => d.earned))) : 0,
        deficit_kcal: counted.length
          ? Math.round(mean(counted.map((d) => d.deficit as number)))
          : null,
        // a total, not a mean: this is a fact about the week rather than an
        // average over a denominator the reader has to hold in mind
        run_kcal: days.reduce((s, d) => s + d.runKcal, 0),
      };
    });
}

/** Least-squares slope of the smoothed trend, in kg per week.
 *
 *  A regression rather than last-minus-first over the span: the endpoints are
 *  two particular mornings, and hanging the headline number on them means a
 *  single dehydrated Tuesday moves the reported rate. Every point in the
 *  window gets a vote here.
 *
 *  Null below `MIN_TREND_SPAN_DAYS`, and null when every weigh-in landed on
 *  one day (zero variance in x — the slope is undefined, not zero). */
export function observedRateKgPerWeek(
  series: { measured_on: string; trend_kg: number }[],
): number | null {
  if (series.length < 2) return null;

  const first = series[0]!.measured_on;
  const span = daysBetween(first, series[series.length - 1]!.measured_on) + 1;
  if (span < MIN_TREND_SPAN_DAYS) return null;

  const xs = series.map((p) => daysBetween(first, p.measured_on));
  const ys = series.map((p) => p.trend_kg);
  const mx = mean(xs);
  const my = mean(ys);

  let numerator = 0;
  let denominator = 0;
  for (let n = 0; n < xs.length; n++) {
    numerator += (xs[n]! - mx) * (ys[n]! - my);
    denominator += (xs[n]! - mx) ** 2;
  }
  if (denominator === 0) return null;

  return round2((numerator / denominator) * 7);
}

function mean(values: number[]): number {
  return values.reduce((t, v) => t + v, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
