/** How long a feed may stay quiet before the app stops vouching for it (#69).
 *
 *  The launchd job runs every 30 minutes, so almost any threshold "works" in
 *  the sense of eventually firing. What sets this number is the false alarm:
 *  a laptop shut at 11pm doesn't sync until it wakes, and the app is opened on
 *  a phone at breakfast. Anything under about twelve hours therefore reports a
 *  dead sync every single morning, and a warning that is usually wrong is
 *  worse than no warning — it trains you past the one time it's right.
 *
 *  Eighteen hours clears a normal overnight with room to spare and still
 *  catches a genuinely dead feed within the same day. Settled with Dave.
 */
export const STALE_AFTER_HOURS = 18;

/** Has this feed been quiet too long?
 *
 *  **Null is not stale.** A feed that has never checked in at all isn't
 *  broken, it was never set up — a fresh install, or a self-hoster who syncs
 *  nothing. Telling them their runs are stale would be inventing a problem out
 *  of an absence. Staleness is only meaningful for a feed that was working and
 *  stopped.
 */
export function feedStale(lastSuccessAt: string | null | undefined, now: Date): boolean {
  if (!lastSuccessAt) return false;

  const last = Date.parse(lastSuccessAt);
  // An unparseable timestamp is a bug somewhere upstream, and guessing "stale"
  // would put a warning on screen that no amount of syncing could clear.
  if (Number.isNaN(last)) return false;

  return now.getTime() - last > STALE_AFTER_HOURS * 3_600_000;
}
