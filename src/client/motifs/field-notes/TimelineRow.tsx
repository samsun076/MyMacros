import type { TimelineRowProps } from "../types";

/** Field Notes timeline row chrome (motif slot 4) — a ledger line (sketch:
 *  `.ledger` / `.entry`).
 *
 *  The rail is the **red margin rule** down the left of the time column, and
 *  the rows are separated by hairline rules rather than by whitespace, which is
 *  what makes the timeline read as a page of a book rather than a list of
 *  cards. Same contract as every other pack since #80: **the rail and nothing
 *  else** — no node dots. The sketch draws none here either, which is a piece
 *  of luck rather than foresight.
 *
 *  The just-saved state is a vermilion bar in the margin, in the position a
 *  reader would pencil one. It stays the single accent mark on the row (#80).
 */
export function TimelineRow({ when, kind = "meal", fresh = false, children }: TimelineRowProps) {
  const cls = ["entry", "fn-entry", kind === "run" && "run", fresh && "fresh"]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <span className="when">{when}</span>
      {children}
    </div>
  );
}
