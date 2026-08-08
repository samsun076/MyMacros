/** Imperial ↔ SI, for the edge of the UI only.
 *
 *  Storage is SI everywhere — `weights.weight_kg`, `profiles.height_cm` — and
 *  `profiles.units` is a display preference (schema v1's own note). Converting
 *  at the edge is what keeps that true: nothing downstream of a form field
 *  ever has to ask which unit a number is in, because by then it is always
 *  kilograms and centimetres.
 */

const LB_PER_KG = 2.20462262185;
const CM_PER_IN = 2.54;

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inches: number) => inches * CM_PER_IN;

/** Centimetres as feet and whole inches, the way a height is spoken.
 *
 *  Rounds to the nearest inch *before* splitting, so 71.6 in reads 6'0" and
 *  not 5'12" — the bug you get from flooring the feet and rounding the
 *  remainder separately. */
export function cmToFtIn(cm: number): { ft: number; in: number } {
  const total = Math.round(cmToIn(cm));
  return { ft: Math.floor(total / 12), in: total % 12 };
}

export function ftInToCm(ft: number, inches: number): number {
  return inToCm(ft * 12 + inches);
}

/** A weight for display in the user's own units, rounded to a tenth. */
export function displayWeight(kg: number, units: "imperial" | "metric") {
  const value = units === "imperial" ? kgToLb(kg) : kg;
  return { value: Math.round(value * 10) / 10, unit: units === "imperial" ? "lb" : "kg" };
}
