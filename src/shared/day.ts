/** Resolving "what day is it for this user" on the server.
 *
 *  The client has its own answer in `src/client/lib/day.ts`: the device owns
 *  the local day, and `logged_on` is the phone's own date (#44). That is
 *  right whenever a person is present.
 *
 *  M4 introduces the case where nobody is: the budget engine recalculating a
 *  target, and `/api/sync` writing `ran_on`/`measured_on` from a script on a
 *  Mac (#19). Those need a day too, and `new Date()` on a Worker is UTC — for
 *  a user in America/New_York that is the *next* day for the last five hours
 *  of every evening. `profiles.timezone` exists for exactly this, written
 *  with every log by the client (#44).
 */

/** The calendar day `instant` falls on in `timeZone`, as YYYY-MM-DD.
 *
 *  `en-CA` because its short date format *is* ISO — the alternative is
 *  reassembling `formatToParts`, which is the same answer with more places to
 *  get it wrong. An unknown timezone would make Intl throw, so it falls back
 *  to UTC: a day that is occasionally off by one beats a 500 on a route that
 *  was only trying to work out the date. */
export function dayInTimezone(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}
