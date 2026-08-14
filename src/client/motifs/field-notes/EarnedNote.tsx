import { fmtDayAgo, fmtInt } from "../../lib/format";
import type { BudgetData } from "../types";

/** Field Notes earned-kcal annotation (motif slot 1) — **the stamp**, and the
 *  one hero motif of the whole theme (sketch: `.stamp`).
 *
 *  A rubber stamp thumped onto the page: mono caps inside a heavy vermilion
 *  rule, rotated a couple of degrees, multiplied into the paper and eaten at
 *  the edges by a noise mask so the ink is uneven the way a real stamp is.
 *  Where Night Athletic *annotates* the meter with a matching hatch swatch,
 *  this makes a separate mark on the page — which is the reason `BudgetData`
 *  goes to both slots rather than the screen placing one against the other
 *  (#43).
 *
 *  The stale state (#69) is deliberately NOT a stamp. A stamp is a thing you
 *  earned; "we haven't heard from your Mac since Thursday" is a margin note,
 *  and stamping it would celebrate an outage. Same decision Night Athletic
 *  makes by draining its hatch of accent — recessive, because the likeliest
 *  cause is a shut laptop and the screen is still about food.
 */
export function EarnedNote({ budget }: { budget: BudgetData }) {
  if (budget.earned <= 0 && budget.staleSince) {
    return (
      <span className="fn-margin-note">Runs last synced {fmtDayAgo(budget.staleSince)}</span>
    );
  }

  if (budget.earned <= 0) return null;

  return (
    <span className="fn-stamp">
      +{fmtInt(budget.earned)} kcal earned
      {budget.earnedLabel ? ` · ${budget.earnedLabel}` : ""}
    </span>
  );
}
