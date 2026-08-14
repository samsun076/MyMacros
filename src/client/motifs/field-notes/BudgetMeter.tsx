import { fmtInt } from "../../lib/format";
import type { BudgetData } from "../types";

/** Field Notes budget meter (motif slot 2) — the ledger bar (sketch:
 *  `.meter`).
 *
 *  Shaped differently from Night Athletic's, not merely coloured differently,
 *  which is why it is a real variant rather than the same component under new
 *  tokens:
 *
 *   - the fill sits **inset inside a trough** (2px all round) so it reads as a
 *     ruled bar drawn within a printed channel, rather than a glowing bar that
 *     is the whole object;
 *   - the earned zone is anchored to the **right edge** and is pure hatch, with
 *     no boundary tick. Night Athletic needs that tick because its fill and its
 *     earned zone are both solid accent and would otherwise merge; here the
 *     fill is ink and the hatch is vermilion, so the materials already separate
 *     them.
 *
 *  Build rule 7 holds either way: base and earned draw separately, and the
 *  scale still labels where the base ends.
 */
export function BudgetMeter({ budget }: { budget: BudgetData }) {
  const adjusted = budget.base + budget.earned;
  const basePct = adjusted > 0 ? (budget.base / adjusted) * 100 : 100;
  const earnedPct = adjusted > 0 ? (budget.earned / adjusted) * 100 : 0;
  const fillPct = adjusted > 0 ? Math.min((budget.eaten / adjusted) * 100, 100) : 0;

  return (
    <>
      <div className="fn-meter" role="img" aria-label={meterLabel(budget, adjusted)}>
        <div className="fn-fill" style={{ width: `calc(${fillPct}% - 4px)` }} />
        {/* Rendered only when there is one. At zero width the hatch would be a
            2px vermilion smudge against the right edge, which on paper reads as
            a printing fault rather than as nothing. */}
        {budget.earned > 0 && (
          <div className="fn-earned" style={{ width: `calc(${earnedPct}% - 4px)` }} />
        )}
      </div>
      <div className="fuel-scale">
        <span>0</span>
        <span className="base" style={{ left: `${basePct}%` }}>
          BASE {fmtInt(budget.base)}&nbsp;▸
        </span>
        {budget.earned > 0 && <span>{fmtInt(adjusted)}</span>}
      </div>
    </>
  );
}

/** Same sentence Night Athletic reads out — the treatment is per theme, what
 *  the meter *means* is not. */
function meterLabel(budget: BudgetData, adjusted: number) {
  let label = `${fmtInt(budget.eaten)} of ${fmtInt(adjusted)} kcal eaten`;
  if (budget.earned > 0) {
    label += `; budget extended from a base of ${fmtInt(budget.base)} by ${fmtInt(budget.earned)} kcal earned`;
    if (budget.earnedLabel) label += ` on a ${budget.earnedLabel}`;
  }
  return label;
}
