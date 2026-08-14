/** Tiny hand-rolled validators shared by the API routes (extracted from
 *  routes/me.ts when #10 added the second write route — same idiom, zero new
 *  dependencies; C1 probed this style adversarially and it held).
 *
 *  Convention: each returns the (possibly normalized) value on success and
 *  `undefined` on rejection, so route-level allowlists can treat `undefined`
 *  uniformly as "invalid field". */

export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function positive(v: unknown) {
  return isNum(v) && v > 0 ? v : undefined;
}

/** Integer percent 0–100. */
export function pct(v: unknown) {
  return isNum(v) && v >= 0 && v <= 100 ? Math.round(v) : undefined;
}

/** YYYY-MM-DD — a day in the user's life, never a timestamp. */
export function isDay(v: unknown) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

/** An ISO-8601 instant, normalised to the form the app stores (#52).
 *
 *  Returns the *round-tripped* string rather than the input, so a valid but
 *  differently-spelled instant ("2026-08-14T11:10:00+00:00", or one with
 *  milliseconds omitted) lands in the column looking like every other row —
 *  `foldMeals` groups meals by string equality on this value, so two spellings
 *  of one instant would silently split a restored meal into two entries.
 *
 *  `Date.parse` alone is too permissive: it accepts "2026" and, in V8, plenty
 *  of loose formats. Requiring the shape first is what makes this a validator
 *  rather than a coercion. */
export function isInstant(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(v)) {
    return undefined;
  }
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export function oneOf<T extends string>(allowed: readonly T[]) {
  return (v: unknown) => (typeof v === "string" && allowed.includes(v as T) ? (v as T) : undefined);
}
