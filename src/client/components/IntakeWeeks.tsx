import type { TrendWeek } from "../../shared/api";
import { fmtInt } from "../lib/format";

/** The intake panel of the trends screen (#22): one row per calendar week,
 *  average daily intake against the week's average target.
 *
 *  **Build rule 7 is structural here, not decorative.** The bar draws the base
 *  target as a tick and the earned bonus as a hatched extension beyond it —
 *  never one merged length. Same visual language as motif slot 1's earned
 *  hatch, built from tokens rather than by adding a fifth motif slot.
 *
 *  Every bar shares one kcal scale. Scaling each row to its own target would
 *  make a 1,600-kcal week and a 2,400-kcal week draw the same length, which is
 *  the one thing a stack of bars is for.
 */
export function IntakeWeeks({ weeks }: { weeks: TrendWeek[] }) {
  const ceiling =
    Math.max(
      1,
      ...weeks.flatMap((w) => [w.intake_kcal ?? 0, (w.target_kcal ?? 0) + w.earned_kcal]),
    ) * 1.05;
  const pct = (kcal: number) => `${Math.min((kcal / ceiling) * 100, 100)}%`;

  /* Newest week first. The wire keeps them oldest-first because the chart
     above reads left-to-right in time and `from`→`to` is the window's own
     order — but a list is read top-down, and the week you are living is the
     one you came here for. Scrolling to the bottom to find this morning is
     the wrong way round. Matches the weigh-in list on /weight, which already
     reverses for the same reason. */
  return (
    <div className="wk-list">
      {[...weeks].reverse().map((w) => {
        const base = w.target_kcal ?? 0;
        return (
          <div className="wk-row" key={w.starts_on}>
            <span className="lbl">
              {weekLabel(w.starts_on)}
              <span className="mono">
                {w.logged_days}/{w.days} {w.partial ? "SO FAR" : "DAYS"}
              </span>
            </span>

            {/* A week with nothing logged gets a hairline, not an empty
                track. A track is a scale, and drawing one says "here is a
                measurement, and it is zero" — which is the exact thing this
                screen must never say about an unlogged day. */}
            <span className={w.logged_days === 0 ? "wkbar none" : "wkbar"}>
              {/* the earned extension sits beyond the base tick, so the two
                  are never read as one number (build rule 7) */}
              {w.earned_kcal > 0 && base > 0 && (
                <i
                  className="earned"
                  style={{ left: pct(base), width: pct(w.earned_kcal) }}
                  aria-hidden="true"
                />
              )}
              {w.intake_kcal !== null && (
                <i className="fill" style={{ width: pct(w.intake_kcal) }} aria-hidden="true" />
              )}
              {base > 0 && <i className="base" style={{ left: pct(base) }} aria-hidden="true" />}
            </span>

            <span className="val">{deficit(w)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The week's realized deficit, signed as an energy balance: a deficit reads
 *  negative because the week ended down on energy.
 *
 *  Deliberately not a repeat of the bar. The bar answers "did I eat to plan",
 *  this answers "did the week actually run a deficit" — and because expenditure
 *  includes the FULL run calories while the bar's earned extension is the
 *  eaten-back share, the two can disagree. That disagreement is information. */
function deficit(w: TrendWeek) {
  if (w.deficit_kcal === null) {
    return (
      <span className="wk-none" aria-label="nothing logged this week">
        —
      </span>
    );
  }
  const surplus = w.deficit_kcal < 0;
  return (
    <>
      {surplus ? "+" : "−"}
      {fmtInt(Math.abs(w.deficit_kcal))}
      <span className="per">/day</span>
    </>
  );
}

/** "W/C 21 JUL" — week commencing, in the sketch's mono micro-caption idiom.
 *  Parts, not a `Date`: a local `Date` from a plain YYYY-MM-DD lands on the
 *  previous day for anyone west of Greenwich. */
function weekLabel(day: string): string {
  const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
  const [, m, d] = day.split("-") as [string, string, string];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}
