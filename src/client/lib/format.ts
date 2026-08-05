/** Number formatting matched to the frozen sketches ("1,240", "2,150") —
 *  pinned to en-US so the design doesn't reflow under a device locale. */
export function fmtInt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

/** "12:38 PM" — the timeline's time-rail format (sketch: .entry .when). */
export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
