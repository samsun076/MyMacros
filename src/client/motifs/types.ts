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
  /** Set only when the runs feed has gone quiet past the threshold (#69):
   *  the ISO instant it last checked in.
   *
   *  Lives on BudgetData rather than being a prop of its own because the
   *  doubt belongs to the same number the slot already draws — `earned: 0`
   *  means "no run today" or "we haven't heard from your Mac since Thursday",
   *  and only this distinguishes them. Each theme decides how to voice it,
   *  which is what makes it a motif concern rather than a screen one. */
  staleSince: string | null;
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
