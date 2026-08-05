import type { Theme } from "../../shared/api";
import * as fieldNotes from "./field-notes";
import * as instrument from "./instrument";
import { BudgetMeter } from "./night-athletic/BudgetMeter";
import { EarnedNote } from "./night-athletic/EarnedNote";
import { LogButton } from "./night-athletic/LogButton";
import { TimelineRow } from "./night-athletic/TimelineRow";
import type { MotifSet } from "./types";

const nightAthletic: MotifSet = { BudgetMeter, EarnedNote, LogButton, TimelineRow };

/** The motif registry (#43). Typing is the load-bearing part: MotifSet
 *  requires all four slots and this is a Record over every Theme, so a theme
 *  missing a variant is a compile error — `npm run check` enforces build
 *  rule 3 instead of a human remembering it. */
export const MOTIFS: Record<Theme, MotifSet> = {
  "night-athletic": nightAthletic,
  "field-notes": fieldNotes,
  instrument,
};

/** The active theme's motif set. The theme is a per-user setting carried as
 *  data-theme on <html> (index.html today; #29 makes it switchable) — not
 *  reactive, because nothing switches themes mid-session until M5. */
export function activeMotifs(): MotifSet {
  const theme = document.documentElement.dataset.theme as Theme | undefined;
  return MOTIFS[theme ?? "night-athletic"] ?? MOTIFS["night-athletic"];
}
