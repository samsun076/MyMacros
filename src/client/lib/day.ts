import type { MealSlot } from "../../shared/api";

/** The device owns the local day (#44): `logged_on` is the phone's local
 *  date with a MIDNIGHT cutoff — an 11pm meal counts against that day, not
 *  the next (explicitly not a 3-4am "late night" cutoff). Set once at
 *  creation, never recomputed on edit. */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Meal slot derives from the clock (settled on #44/#45): <11 breakfast,
 *  <16 lunch, <21 dinner, else snack. Shown on the confirm sheet, editable
 *  there; #12's one-tap re-log uses the same derivation. */
export function mealSlotFor(d = new Date()): MealSlot {
  const h = d.getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

/** IANA timezone, written to profiles.timezone with each log so M4's
 *  server-side budget engine can resolve a day boundary with no client
 *  present (#44). */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
