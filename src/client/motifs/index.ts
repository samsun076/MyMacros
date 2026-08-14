import type { Theme } from "../../shared/api";
import { useTheme } from "../lib/theme";
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

/** The active theme's motif set, re-rendering the caller when the theme moves.
 *
 *  It used to read `data-theme` once per render and say so — "not reactive,
 *  because nothing switches themes mid-session until M5". M5 is #30, and the
 *  bug it left was subtler than a switch mid-session: on a light-theme user's
 *  **first** load the attribute starts at the HTML default and `ThemeFromProfile`
 *  corrects it once `/api/me` answers. Every token repainted; the components
 *  did not. The result was Night Athletic's rounded-square log button wearing
 *  Field Notes' vermilion, which reads as a botched port rather than as a
 *  stale render. */
export function useActiveMotifs(): MotifSet {
  return MOTIFS[useTheme()];
}
