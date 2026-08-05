import type { TimelineRowProps } from "../types";

/** Night Athletic timeline row chrome (motif slot 4): the time rail column,
 *  the node dot (accent-filled for runs), and the just-saved wash. The rail
 *  line itself is drawn by the screen's .tl container; each row places its
 *  own dot (sketch: .entry::after). Rail narrows below 390px — in CSS. */
export function TimelineRow({ when, kind = "meal", fresh = false, children }: TimelineRowProps) {
  const cls = ["entry", kind === "run" && "run", fresh && "fresh"].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <span className="when">{when}</span>
      {children}
    </div>
  );
}
