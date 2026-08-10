import { useState } from "react";
import { Link } from "react-router";
import type { Goal, Me, TrendsResponse, Units } from "../../shared/api";
import { buildTrends, MIN_LOGGED_DAYS, MIN_TREND_SPAN_DAYS } from "../../shared/trends";
import { kgToLb } from "../../shared/units";
import { shiftDay } from "../../shared/weight";
import { IntakeWeeks } from "../components/IntakeWeeks";
import { WeightChart } from "../components/WeightChart";
import { useApi } from "../lib/api";
import { localDay } from "../lib/day";
import { fmtInt } from "../lib/format";

/** The trends screen (#22) — "is this working?".
 *
 *  The first screen with no frozen sketch to port from, so the shape is a
 *  decision rather than a translation: stacked panels sharing one time axis,
 *  never a dual-axis weight-and-calories chart, where any correlation the eye
 *  finds is an artifact of how the two axes were scaled against each other.
 *
 *  **One rule governs everything absent from it: the charts draw whatever
 *  exists, and the derived rate numbers are withheld until they can be
 *  honest.** Absent, not greyed and not caveated — the same posture as
 *  `computeBudget` returning null rather than guessing a TDEE, and for the
 *  same reason: a number with a caveat attached is still a number people
 *  quote. The gates live in `src/shared/trends.ts` where they are tested.
 */

const RANGES = [4, 12, 24] as const;
const DEFAULT_WEEKS = 12;

export function Trends() {
  const today = localDay();
  const [weeks, setWeeks] = useState<number>(DEFAULT_WEEKS);
  const { data: me } = useApi<Me>("/api/me");
  const { data: live } = useApi<TrendsResponse>(`/api/trends/${today}?weeks=${weeks}`);

  const data = devStage(today, me) ?? live;
  const units: Units = me?.profile.units ?? "imperial";
  const goal: Goal = me?.profile.goal ?? "cut";

  const rate = data?.rate;
  const observed = rate?.observed_kg_per_week ?? null;
  const hasWeighIns = (data?.series.length ?? 0) > 0;

  return (
    <>
      <header>
        <div className="masthead">
          <span className="eyebrow">
            <span className="tick" />
            Trends
          </span>
          <span className="mono">{me ? me.profile.goal.toUpperCase() : ""}</span>
        </div>
        <h1>
          Is this <span>working?</span>
        </h1>
      </header>

      <div className="range" role="group" aria-label="How far back to look">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={r === weeks ? "on" : undefined}
            aria-pressed={r === weeks}
            onClick={() => setWeeks(r)}
          >
            {r}W
          </button>
        ))}
      </div>

      {/* Before the engine has its Mifflin-St Jeor inputs there is no target
          and therefore no deficit, so most of this screen would be dashes.
          Say why, the way Today does (#17), rather than drawing empty bars. */}
      {data && !data.onboarded && (
        <div className="setup-call">
          <span className="eyebrow">
            <span className="tick" />
            Budget not set up
          </span>
          <p className="opt-hint">
            Weight still charts below, but a deficit needs a target — and that needs your
            height, weight and age.
          </p>
          <Link className="btn btn-accent" to="/onboarding">
            Set up my budget
          </Link>
        </div>
      )}

      {data && rate && (
        <section className="verdict">
          <div className={statusClass(observed, goal)}>
            <span className="eyebrow">Trend</span>
            {observed === null ? (
              <p className="placeholder-note">
                {hasWeighIns
                  ? `A rate needs about a fortnight of weigh-ins behind it — ${rate.weigh_in_span_days} ${plural(rate.weigh_in_span_days, "day")} so far.`
                  : "No weigh-ins yet, so there's no trend to measure."}
              </p>
            ) : (
              <>
                <div className="stat-row">
                  <span className="num">
                    <span className="dir">{observed < 0 ? "▼" : "▲"}</span>
                    {rateValue(observed, units)}
                  </span>
                  <span className="unit">
                    {units === "imperial" ? "lb" : "kg"} / week
                    <small>Measured — the slope of your own trend line</small>
                  </span>
                </div>
                {/* The modelled rate carries its own arrow. Both numbers are
                    rendered as magnitudes, so without it a model predicting a
                    GAIN would read identically to one predicting a loss —
                    which is exactly the case worth seeing. */}
                <p className="mono">
                  {rate.predicted_kg_per_week === null
                    ? `${rate.counted_days} FULL ${plural(rate.counted_days, "DAY").toUpperCase()} — TOO FEW TO MODEL`
                    : `MODEL SAYS ${rate.predicted_kg_per_week < 0 ? "▼" : "▲"} ${rateValue(rate.predicted_kg_per_week, units)} · ${rate.counted_days} FULL DAYS`}
                </p>
              </>
            )}
          </div>

          <div className={deficitClass(rate.deficit_kcal, goal)}>
            <span className="eyebrow">Realized deficit</span>
            {rate.deficit_kcal === null ? (
              <p className="placeholder-note">
                An average needs {MIN_LOGGED_DAYS} fully logged days behind it — {rate.counted_days}{" "}
                so far{rate.logged_days > rate.counted_days
                  ? `, from ${rate.logged_days} days with something on them`
                  : ""}. A day logged in part can't say what you ate.
              </p>
            ) : (
              <>
                <div className="stat-row">
                  <span className="num">
                    {rate.deficit_kcal < 0 ? "+" : "−"}
                    {fmtInt(Math.abs(rate.deficit_kcal))}
                  </span>
                  <span className="unit">
                    kcal / day
                    <small>
                      What you burned less what you ate, over {rate.counted_days} fully
                      logged days
                    </small>
                  </span>
                </div>
                {rate.deficit_kcal < 0 && goal === "cut" && (
                  <p className="mono">A SURPLUS, ACROSS THE WHOLE WINDOW — THE GOAL IS A CUT</p>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {data && (
        <section>
          <div className="sec-head">
            <span className="eyebrow">Weight</span>
            <span className="mono">
              {me?.profile.goal_weight_kg
                ? `GOAL ${weightValue(me.profile.goal_weight_kg, units)} ${units === "imperial" ? "LB" : "KG"}`
                : "7-DAY TREND"}
            </span>
          </div>
          {hasWeighIns ? (
            <>
              <WeightChart
                series={data.series}
                from={data.from}
                to={data.to}
                goalKg={me?.profile.goal_weight_kg ?? null}
                units={units}
              />
              <p className="chart-key">
                <b>Trend</b> is the 7-day smoothed weight your budget follows; the dots are the
                mornings it's built from.
              </p>
            </>
          ) : (
            <p className="placeholder-note">
              No weigh-ins in this window. The first one starts the trend.
            </p>
          )}
        </section>
      )}

      {data && (
        <section>
          <div className="sec-head">
            <span className="eyebrow">Intake</span>
            <span className="mono">KCAL / DAY, AVG</span>
          </div>
          {data.weeks.some((w) => w.logged_days > 0) ? (
            <IntakeWeeks weeks={data.weeks} />
          ) : (
            <p className="placeholder-note">
              Nothing logged in this window — so there's no intake to average.
            </p>
          )}
        </section>
      )}

      {/* Accent only when it is the one thing to do. With no weigh-ins AND no
          budget the setup call above is already the primary action, and two
          coral buttons on one screen is two primary actions, which is none. */}
      <Link
        className={!hasWeighIns && data?.onboarded ? "btn btn-accent" : "btn btn-quiet"}
        to="/weight"
      >
        Log a weigh-in
      </Link>
    </>
  );
}

/** `--positive` only when the trend is moving the way the goal asks. Never
 *  `--danger`: one fortnight of water weight is not an alert, and the alert
 *  colour on this screen is reserved for the window-wide answer below. */
function statusClass(observed: number | null, goal: Goal): string {
  if (observed === null) return "stat";
  const rightWay = goal === "cut" ? observed < 0 : goal === "gain" ? observed > 0 : true;
  return rightWay ? "stat good" : "stat";
}

/** The one place `--danger` earns its keep here: the screen's own question
 *  answered "no" — a surplus averaged across the entire window while the goal
 *  is a cut. Not a single heavy week, which is noise. */
function deficitClass(deficit: number | null, goal: Goal): string {
  return deficit !== null && deficit < 0 && goal === "cut" ? "stat bad" : "stat";
}

function rateValue(kgPerWeek: number, units: Units): string {
  const v = units === "imperial" ? kgToLb(kgPerWeek) : kgPerWeek;
  return Math.abs(v).toFixed(1);
}

function weightValue(kg: number, units: Units): string {
  return (units === "imperial" ? kgToLb(kg) : kg).toFixed(1);
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/** DEV-only hash stages, mirroring `/log#confirm` (#10): the states design QA
 *  structurally cannot reach, made addressable so `shot-matrix` can shoot
 *  them. `import.meta.env.DEV` is a build-time literal, so this is compiled
 *  out of production entirely — no env var can switch it back on.
 *
 *  Built by running the real `buildTrends` over fabricated inputs rather than
 *  by hand-writing a response, so a stage can't drift into a shape the route
 *  would never produce. */
function devStage(today: string, me: Me | null): TrendsResponse | null {
  if (!import.meta.env.DEV || !me) return null;
  const hash = window.location.hash;
  if (hash !== "#empty" && hash !== "#sparse") return null;

  const profile = {
    sex: me.profile.sex,
    birth_date: me.profile.birth_date,
    height_cm: me.profile.height_cm,
    activity_level: me.profile.activity_level,
    goal: me.profile.goal,
    deficit_kcal: me.profile.deficit_kcal,
    eat_back_pct: me.profile.eat_back_pct,
  };

  if (hash === "#empty") {
    return buildTrends({ today, weeks: DEFAULT_WEEKS, weighIns: [], intake: [], runs: [], profile });
  }

  // just short of both gates: six days of weigh-ins, six days logged
  const days = Array.from({ length: MIN_TREND_SPAN_DAYS - 8 }, (_, n) => shiftDay(today, -n));
  return buildTrends({
    today,
    weeks: DEFAULT_WEEKS,
    weighIns: days.map((measured_on, n) => ({ measured_on, weight_kg: 80.4 + n * 0.15 })),
    intake: days.map((day) => ({ day, kcal: 2040 })),
    runs: [],
    profile,
  });
}
