import type { TimelineRowProps } from "../types";

/** Night Athletic timeline row chrome (motif slot 4): the time rail column
 *  and the just-saved wash. The rail line itself is drawn by the screen's
 *  `.tl` container; the row contributes its time and its own accent bar when
 *  fresh. Rail narrows below 390px — in CSS.
 *
 *  **No node dot.** It collided with the fresh wash's accent bar by half a
 *  pixel and drew a second accent mark meaning the same thing (#80). Slot 4's
 *  contract is the rail alone now, which every theme pack inherits — see
 *  design/TOKENS.md. `kind` still distinguishes a run row, and a run needs a
 *  mark that is not the dot if one is ever built. */
export function TimelineRow({ when, kind = "meal", fresh = false, children }: TimelineRowProps) {
  const cls = ["entry", kind === "run" && "run", fresh && "fresh"].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <span className="when">{when}</span>
      {children}
    </div>
  );
}
