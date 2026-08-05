import type { ComponentType, ReactNode } from "react";

/** Everything a theme's budget-meter family needs to draw base vs earned.
 *
 *  Handed to BOTH BudgetMeter and EarnedNote: the sketches couple the two
 *  differently per theme (Night Athletic layers the earned zone inside the
 *  meter; Field Notes stamps it outside as a sibling), so each theme decides
 *  where the earned mark lives — a screen must never hard-place one against
 *  the other (#43, C2 note). */
export type BudgetData = {
  /** kcal eaten so far today. */
  eaten: number;
  /** The base target — profiles.target_kcal. */
  base: number;
  /** kcal earned from runs. Always 0 in M2; #21 makes it real. */
  earned: number;
  /** Where the earned kcal came from, e.g. "6.2 mi run". Null when none. */
  earnedLabel: string | null;
};

export type TimelineRowProps = {
  /** Already-formatted local time, e.g. "12:38 PM". */
  when: string;
  kind?: "meal" | "run";
  /** The just-saved highlight (sketch: .entry.fresh). */
  fresh?: boolean;
  children: ReactNode;
};

/** The four motif slots — the ONLY components with per-theme code
 *  (PLAN.md Theming; treatments named in design/TOKENS.md). Every theme
 *  must provide all four: MOTIFS is a Record<Theme, MotifSet>, so a missing
 *  variant fails `npm run check` (build rule 3, enforced by type). */
export type MotifSet = {
  /** Slot 2 — the hero meter, with its scale. Base and earned always draw
   *  separately (build rule 7). */
  BudgetMeter: ComponentType<{ budget: BudgetData }>;
  /** Slot 1 — how "+340 kcal earned" is celebrated. Renders nothing when
   *  nothing is earned. */
  EarnedNote: ComponentType<{ budget: BudgetData }>;
  /** Slot 3 — the log button in the bottom chrome. */
  LogButton: ComponentType<{ onClick: () => void }>;
  /** Slot 4 — timeline row chrome: time rail, node dot, run accenting. */
  TimelineRow: ComponentType<TimelineRowProps>;
};
