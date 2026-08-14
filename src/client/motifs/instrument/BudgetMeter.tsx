import { fmtInt } from "../../lib/format";
import type { BudgetData } from "../types";

/** Instrument budget meter (motif slot 2) — the machined groove (sketch:
 *  the Braun dial's channel).
 *
 *  Four parts, and each is a material rather than a colour: a **recessed
 *  channel** cut into the panel, a **milled ink bar** with a lit top edge
 *  filling it, a **hatched earned zone** ruled off inside the same channel,
 *  and a **needle** at the consumed mark that crosses the whole face.
 *
 *  **Ported as a treatment, not as markup.** The sketch draws this as an SVG
 *  on a fixed 350-unit grid, with the numerals, the 500-kcal ticks and the
 *  needle all at literal x-coordinates for one particular budget. That is a
 *  picture of a dial rather than a dial: it cannot follow 375 → 428, and it
 *  cannot follow a target that isn't 2,490. Everything here is a percentage of
 *  the adjusted total, so the ticks land on real numbers.
 *
 *  Build rule 7 holds the same way it does everywhere: the base and the earned
 *  extension are separate marks in the channel, never one merged bar.
 */
export function BudgetMeter({ budget }: { budget: BudgetData }) {
  const adjusted = budget.base + budget.earned;
  const basePct = adjusted > 0 ? (budget.base / adjusted) * 100 : 100;
  const earnedPct = adjusted > 0 ? (budget.earned / adjusted) * 100 : 0;
  const fillPct = adjusted > 0 ? Math.min((budget.eaten / adjusted) * 100, 100) : 0;

  return (
    <>
      <div className="in-groove" role="img" aria-label={meterLabel(budget, adjusted)}>
        <div className="in-fill" style={{ width: `${fillPct}%` }} />
        {budget.earned > 0 && (
          <div className="in-earned" style={{ left: `${basePct}%`, width: `${earnedPct}%` }} />
        )}
        {/* The needle reads the consumed mark off the face. Suppressed at zero
            because a needle pinned to the left stop is a reading, and "you have
            eaten nothing" is not the reading it would be taken for. */}
        {fillPct > 0 && <div className="in-needle" style={{ left: `${fillPct}%` }} />}
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

/** The treatment is per theme; what the meter means is not. */
function meterLabel(budget: BudgetData, adjusted: number) {
  let label = `${fmtInt(budget.eaten)} of ${fmtInt(adjusted)} kcal eaten`;
  if (budget.earned > 0) {
    label += `; budget extended from a base of ${fmtInt(budget.base)} by ${fmtInt(budget.earned)} kcal earned`;
    if (budget.earnedLabel) label += ` on a ${budget.earnedLabel}`;
  }
  return label;
}
