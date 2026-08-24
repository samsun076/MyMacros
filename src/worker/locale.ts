import type { Units } from "../shared/api";

/** Where a new account is, in the two terms the app stores (#37).
 *
 *  `profiles` shipped with `timezone DEFAULT 'America/New_York'` and
 *  `units DEFAULT 'imperial'` — the author's own two preferences, baked into
 *  the schema, so every self-hosted instance inherits them.
 *
 *  **The timezone one is not cosmetic.** `food_logs.logged_on`,
 *  `weights.measured_on` and `runs.ran_on` are user-local dates, so a wrong
 *  timezone silently files meals under the wrong day and skews every daily
 *  total — and Settings deliberately *shows* timezone without letting anyone
 *  edit it (`Settings.tsx:36`). Somebody in Berlin therefore had New York days
 *  and no way whatsoever to say otherwise. That is what makes detection the
 *  fix rather than an improvement.
 *
 *  Read from Cloudflare's `request.cf` rather than from the browser, because
 *  the row is created inside the auth ceremony where there is no client to ask
 *  — and because it then holds for a self-hoster who never opens Settings,
 *  which was #37's whole test. A VPN or a plane gets this wrong; the deployment
 *  default got it wrong for everyone outside one timezone, so it is strictly
 *  better and Settings can still change `units`.
 */

/** The only three countries that do not use the metric system. GB is metric
 *  officially and mixed in practice (stones for body weight); it is not on this
 *  list, and that is a guess either way — which is the argument for leaving
 *  `units` editable in Settings and not for adding a fourth entry here. */
const IMPERIAL_COUNTRIES = new Set(["US", "LR", "MM"]);

/** An IANA zone looks like `Area/Location`. Worth checking rather than
 *  trusting: this value goes into a column nothing lets the user correct, and
 *  a junk string there would silently misfile every date the account ever
 *  writes. Anything unrecognised falls back to the column default, which is at
 *  least a real zone. */
function usableTimezone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tz = raw.trim();
  if (!/^[A-Za-z_+-]+\/[A-Za-z0-9_+\-/]+$/.test(tz) && tz !== "UTC") return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** What a new profile row should say about where its owner is.
 *
 *  Returns only the fields it is confident about, so the caller can spread it
 *  over the insert and let the column defaults stand for whatever is missing.
 *  An empty object is the honest answer when the edge told us nothing — which
 *  is exactly what happens in local dev, where miniflare supplies no `cf`. */
export function localeDefaults(cf: unknown): { timezone?: string; units?: Units } {
  const info = (cf ?? {}) as { timezone?: unknown; country?: unknown };
  const out: { timezone?: string; units?: Units } = {};

  const tz = usableTimezone(info.timezone);
  if (tz) out.timezone = tz;

  // A two-letter code, or Cloudflare's "T1"/"XX" for Tor and unknown — both of
  // which mean "no idea", and no idea must leave the column default alone
  // rather than assert metric about somebody in Ohio.
  const country = typeof info.country === "string" ? info.country.toUpperCase() : null;
  if (country && /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1") {
    out.units = IMPERIAL_COUNTRIES.has(country) ? "imperial" : "metric";
  }

  return out;
}
