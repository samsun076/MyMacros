import type { Units, WeightPoint } from "../../shared/api";
import { daysBetween } from "../../shared/trends";
import { displayWeight } from "../../shared/units";
import { TREND_WINDOW_DAYS } from "../../shared/weight";

/** The weight panel of the trends screen (#22) — hand-rolled SVG, no charting
 *  library (PLAN.md locks that).
 *
 *  **Not a motif slot.** A chart is data marks, and data marks already re-skin
 *  through `--mark-neutral` / `--ink` / `--accent` with no per-theme code, the
 *  way the macro bars do. Adding a fifth slot would be permanent work for
 *  every future pack (#30) to buy nothing a token doesn't already give.
 *
 *  Fixed `viewBox` with uniform `preserveAspectRatio` rather than measuring
 *  the container: no ResizeObserver, no layout read, and it draws identically
 *  at 375/390/428. The cost is that `<text>` scales ~1.05–1.22× across those
 *  widths, which is why only the axis labels are text and they are set small.
 *  Strokes carry `vector-effect: non-scaling-stroke` so hairlines stay
 *  hairlines.
 */

const W = 320;
const H = 140;
const PAD = { left: 32, right: 10, top: 12, bottom: 20 };

/** Headroom above and below the data, as a share of its range, so the extreme
 *  dots aren't half-clipped by the plot edge. */
const HEADROOM = 0.12;

/** The narrowest weight band the y axis will ever show, in kg.
 *
 *  Without a floor the axis auto-fits whatever it's given, so a first week of
 *  weigh-ins spanning 0.8 kg of water gets magnified to fill the panel and
 *  draws a cliff. The reader sees a plunging line and a two-decimal axis and
 *  concludes something dramatic happened; nothing did. Fitting the data is the
 *  right default for a chart whose range is meaningful and the wrong one here,
 *  where a small range is precisely the case that must not look big. */
const MIN_DOMAIN_KG = 2;

type Props = {
  series: WeightPoint[];
  /** Window bounds — the x axis spans the range the user asked for, so a
   *  three-week gap in weigh-ins reads as a gap rather than being closed up. */
  from: string;
  to: string;
  goalKg: number | null;
  units: Units;
};

export function WeightChart({ series, from, to, goalKg, units }: Props) {
  const span = Math.max(1, daysBetween(from, to));
  const values = series.flatMap((p) => [p.weight_kg, p.trend_kg]);
  const dataLo = Math.min(...values);
  const dataHi = Math.max(...values);
  const padded = (dataHi - dataLo) * (1 + HEADROOM * 2);
  const domain = Math.max(padded, MIN_DOMAIN_KG);
  // centred on the data, so the floor above widens the view symmetrically
  // rather than shunting the line to one edge
  const middle = (dataHi + dataLo) / 2;
  const lo = middle - domain / 2;
  const hi = middle + domain / 2;

  const x = (day: string) =>
    PAD.left + (daysBetween(from, day) / span) * (W - PAD.left - PAD.right);
  const y = (kg: number) =>
    PAD.top + (1 - (kg - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  /* Break the line wherever the gap exceeds the smoothing window.
   *
   * `trendWeightKg` falls back to the last weigh-in on or before the day when
   * its 7-day window is empty (#18), so a point more than a week after the
   * previous one is carrying a value forward rather than averaging anything.
   * Joining those two with a straight line asserts a trajectory through days
   * nobody stood on a scale — the same objection `trendSeries` already answers
   * by not emitting points for empty days. */
  const segments: WeightPoint[][] = [];
  for (const point of series) {
    const open = segments.at(-1);
    const previous = open?.at(-1);
    if (open && previous && daysBetween(previous.measured_on, point.measured_on) <= TREND_WINDOW_DAYS)
      open.push(point);
    else segments.push([point]);
  }

  const latest = series.at(-1);
  const goalInRange = goalKg !== null && goalKg > lo && goalKg < hi;

  const first = series[0]!;
  const shown = (kg: number) => displayWeight(kg, units);
  const label =
    series.length === 1
      ? `Weight trend: ${shown(first.trend_kg).value} ${shown(first.trend_kg).unit} on ${first.measured_on}.`
      : `Weight trend from ${shown(first.trend_kg).value} ${shown(first.trend_kg).unit} on ${first.measured_on} to ${shown(latest!.trend_kg).value} ${shown(latest!.trend_kg).unit} on ${latest!.measured_on}, over ${series.length} weigh-ins.`;

  return (
    <svg
      className="wchart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      {goalInRange && (
        <>
          <line
            className="wchart-goal"
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(goalKg)}
            y2={y(goalKg)}
            vectorEffect="non-scaling-stroke"
          />
          <text className="wchart-tag" x={W - PAD.right} y={y(goalKg) - 5} textAnchor="end">
            GOAL
          </text>
        </>
      )}

      {/* the raw morning readings — recessive on purpose: they are the noise
          the trend exists to see through */}
      {series.map((p) => (
        <circle
          key={`raw-${p.measured_on}`}
          className="wchart-raw"
          cx={x(p.measured_on)}
          cy={y(p.weight_kg)}
          r={1.7}
        />
      ))}

      {segments.map((seg) => (
        <path
          key={`seg-${seg[0]!.measured_on}`}
          className="wchart-trend"
          d={seg.map((p, n) => `${n ? "L" : "M"}${x(p.measured_on)} ${y(p.trend_kg)}`).join(" ")}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* where you are now. Accent here follows the frozen sketch's own weight
          spark, which fills its latest-point circle with --accent. */}
      {latest && (
        <circle className="wchart-now" cx={x(latest.measured_on)} cy={y(latest.trend_kg)} r={3} />
      )}

      <text className="wchart-tag" x={0} y={y(dataHi) + 3}>
        {shown(dataHi).value}
      </text>
      <text className="wchart-tag" x={0} y={y(dataLo) + 3}>
        {shown(dataLo).value}
      </text>
      <text className="wchart-tag" x={PAD.left} y={H - 5}>
        {axisDay(from)}
      </text>
      <text className="wchart-tag" x={W - PAD.right} y={H - 5} textAnchor="end">
        {axisDay(to)}
      </text>
    </svg>
  );
}

/** "18 MAY" — the axis idiom, matching the sketch's mono micro-captions.
 *  Built from the date parts rather than a `Date`, because a local `Date` from
 *  a plain YYYY-MM-DD lands on the previous day west of Greenwich. */
function axisDay(day: string): string {
  const months = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ");
  const [, m, d] = day.split("-") as [string, string, string];
  return `${Number(d)} ${months[Number(m) - 1]}`;
}
