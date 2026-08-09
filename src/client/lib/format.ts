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

/** How long ago, in the coarsest form that is still true (#69).
 *
 *  The useful answer is a shape, not a duration: "yesterday" is something you
 *  can act on, "19 hours ago" is arithmetic you then have to do. Weekday names
 *  carry a week; past that it's a date, because "last Thursday" stops being
 *  unambiguous.
 *
 *  Coarsens as it goes rather than staying uniform, because precision matters
 *  in inverse proportion to age — the difference between 5 and 40 minutes says
 *  whether a 30-minute sync is healthy, while the difference between 9 and 11
 *  days says nothing at all.
 */
export function fmtDayAgo(iso: string, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "at some point";

  /* Calendar days apart, not 24-hour blocks, and checked BEFORE the hour
   * count — a sync at 11pm looked at from 9am is ten hours to a clock and
   * "yesterday" to a human. Testing hours first swallows that case entirely,
   * which is the exact reading this format exists to produce. */
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(then)) / 86_400_000);

  if (days <= 0) {
    const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 7) return then.toLocaleDateString("en-US", { weekday: "long" });
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
