import { fmtDayAgo, fmtInt } from "../../lib/format";
import type { BudgetData } from "../types";

/** Instrument earned-kcal annotation (motif slot 1) — a legend beneath the
 *  dial, in the panel's own idiom: a hatched key square matching the groove's
 *  earned zone, then mono caps.
 *
 *  Deliberately quieter than Field Notes' stamp. This theme's argument is that
 *  the instrument reports and does not editorialise, so the earned credit is
 *  *labelled* rather than celebrated — the drama lives in the dial, where the
 *  zone is drawn.
 *
 *  The stale state (#69) reuses the same key with the accent drained out, the
 *  way Night Athletic does: a legend for a reading the panel could not take.
 */
export function EarnedNote({ budget }: { budget: BudgetData }) {
  if (budget.earned <= 0 && budget.staleSince) {
    return (
      <span className="in-legend stale">
        <span className="in-key" aria-hidden="true" />
        Runs last synced {fmtDayAgo(budget.staleSince)}
      </span>
    );
  }

  if (budget.earned <= 0) return null;

  return (
    <span className="in-legend">
      <span className="in-key" aria-hidden="true" />+{fmtInt(budget.earned)} kcal earned
      {budget.earnedLabel ? ` · ${budget.earnedLabel}` : ""}
    </span>
  );
}
