import type { TimelineRowProps } from "../types";

/** Instrument timeline row chrome (motif slot 4) — a scale down the left edge.
 *
 *  The rail is a milled hairline and each row hangs a short **gradation tick**
 *  off it, the way the dial's face carries its 500-kcal marks. That is not a
 *  node dot returning by another name: a dot sat *on* the rail at the row's
 *  centre and collided with the fresh wash's accent bar by half a pixel (#80);
 *  a gradation is a short stroke on the rail's own axis, in the time column,
 *  nowhere near the card. The rule that matters — one accent mark per row — is
 *  kept, because the tick is `--line` and never accent, including on a fresh
 *  row.
 *
 *  Rows are divided by rules rather than by space, the panel's habit.
 */
export function TimelineRow({ when, kind = "meal", fresh = false, children }: TimelineRowProps) {
  const cls = ["entry", "in-entry", kind === "run" && "run", fresh && "fresh"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="when">{when}</span>
      {children}
    </div>
  );
}
