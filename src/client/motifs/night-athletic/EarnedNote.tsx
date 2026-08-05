import { fmtInt } from "../../lib/format";
import type { BudgetData } from "../types";

/** Night Athletic earned-kcal annotation (motif slot 1): the hatched legend
 *  swatch + accent text that matches the meter's earned zone. Ported from
 *  the sketch's .earned-note. Nothing earned → nothing celebrated. */
export function EarnedNote({ budget }: { budget: BudgetData }) {
  if (budget.earned <= 0) return null;

  return (
    <span className="earned-note">
      <span className="swatch" />+{fmtInt(budget.earned)} kcal earned
      {budget.earnedLabel ? ` · ${budget.earnedLabel}` : ""}
    </span>
  );
}
