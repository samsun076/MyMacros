import { fmtInt } from "../../lib/format";
import type { BudgetData } from "../types";

/** Night Athletic budget meter (motif slot 2): 18px rounded bar, solid
 *  accent fill, hatched earned extension, and the scale beneath with the
 *  base target labelled on it. Ported from sketches/c2-night-athletic.html
 *  (.fuel / .fuel-scale).
 *
 *  Build rule 7 is structural here: track, earned and fill are three stacked
 *  layers, and the earned layer renders even at zero width (M2) so M4 fills
 *  in data, not layout. */
export function BudgetMeter({ budget }: { budget: BudgetData }) {
  const adjusted = budget.base + budget.earned;
  const basePct = adjusted > 0 ? (budget.base / adjusted) * 100 : 100;
  const fillPct = adjusted > 0 ? Math.min((budget.eaten / adjusted) * 100, 100) : 0;

  return (
    <>
      <div className="fuel" role="img" aria-label={meterLabel(budget, adjusted)}>
        <div className="track" />
        {/* the boundary tick only paints when an earned zone exists — at zero
            width it would misreport a bonus at the meter's end */}
        <div
          className="earned"
          style={{ left: `${basePct}%`, borderLeftWidth: budget.earned > 0 ? undefined : 0 }}
        />
        <div className="fill" style={{ width: `${fillPct}%` }} />
      </div>
      <div className="fuel-scale">
        <span>0</span>
        <span className="base" style={{ left: `${basePct}%` }}>
          BASE {fmtInt(budget.base)}&nbsp;▸
        </span>
        {/* with nothing earned the adjusted total IS the base — the BASE
            marker already labels the right end, so a second span would
            print the same number twice in the same spot */}
        {budget.earned > 0 && <span>{fmtInt(adjusted)}</span>}
      </div>
    </>
  );
}

/** The sketch's aria-label, with the extension clause only when it's true:
 *  "…; budget extended from a base of 1,810 by 340 kcal earned on a 6.2 mile
 *  run". */
function meterLabel(budget: BudgetData, adjusted: number) {
  let label = `${fmtInt(budget.eaten)} of ${fmtInt(adjusted)} kcal eaten`;
  if (budget.earned > 0) {
    label += `; budget extended from a base of ${fmtInt(budget.base)} by ${fmtInt(budget.earned)} kcal earned`;
    if (budget.earnedLabel) label += ` on a ${budget.earnedLabel}`;
  }
  return label;
}
