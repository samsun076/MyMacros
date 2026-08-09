import { fmtDayAgo, fmtInt } from "../../lib/format";
import type { BudgetData } from "../types";

/** Night Athletic earned-kcal annotation (motif slot 1): the hatched legend
 *  swatch + accent text that matches the meter's earned zone. Ported from
 *  the sketch's .earned-note. Nothing earned → nothing celebrated.
 *
 *  Except when nothing earned might be wrong (#69). This slot rendering null
 *  is precisely how a dead sync used to disappear: no runs synced looks
 *  identical to no runs taken, and the screen quietly draws a rest day you
 *  didn't take. When the feed has gone quiet the slot speaks instead of going
 *  silent — recessive rather than alarming, because the likeliest cause is a
 *  laptop that's off and the screen is still about food. */
export function EarnedNote({ budget }: { budget: BudgetData }) {
  if (budget.earned <= 0 && budget.staleSince) {
    return (
      <span className="earned-note stale">
        <span className="stale-mark" aria-hidden="true" />
        Runs last synced {fmtDayAgo(budget.staleSince)}
      </span>
    );
  }

  if (budget.earned <= 0) return null;

  return (
    <span className="earned-note">
      <span className="swatch" />+{fmtInt(budget.earned)} kcal earned
      {budget.earnedLabel ? ` · ${budget.earnedLabel}` : ""}
    </span>
  );
}
