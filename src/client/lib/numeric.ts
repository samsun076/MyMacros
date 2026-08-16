/** What a typed string commits to (#95).
 *
 *  **One place, and nothing may decide this a second time.** Every numeric
 *  field in the app used to carry its own inline `Number(e.target.value)` plus
 *  its own range test, and the four copies already disagreed: the sheet's macro
 *  fields accepted 0 and the portion field silently discarded anything under 1,
 *  so the same keystroke meant "zero it" in one field and "nothing happened" in
 *  the next. That is #86's register defect at field scale — one rule, four
 *  statements of it. This file is the statement; `NumericField` decides only
 *  *when* to ask, never *what the answer is*.
 *
 *  **Nothing here runs while you type**, and that is the bug it exists to fix.
 *  A handler that parses on every keystroke re-renders the input with a value
 *  the DOM does not have — `""` parses to 0, `"0150"` parses to 150, `"5."`
 *  parses to 5 — and React answers the mismatch by writing the canonical text
 *  back into the element, which dumps the caret at the end. See
 *  `NumericField.tsx` for the other half of the fix.
 */

export type NumericRule = {
  /** Clamped, not rejected — and the clamp is *reported*, so a field can say
   *  what it did. The old portion field ignored an out-of-range value
   *  entirely, which is indistinguishable from a dead keyboard. */
  min?: number;
  max?: number;
  /** Decimal places at commit. Also picks the phone keypad: 0 asks for the
   *  digits-only pad, anything more asks for the one with a separator. */
  decimals?: number;
  /** Empty is a value here, not a mistake — goal weight's empty means "draw no
   *  goal line" (#22). Where empty means nothing, committing it is a revert. */
  allowEmpty?: boolean;
};

export type NumericCommit =
  | { kind: "value"; value: number; clamped: "min" | "max" | null }
  | { kind: "empty" }
  | { kind: "keep"; why: "blank" | "unparsable" };

/** What the confirm sheet's five fields accept, in one table.
 *
 *  #95 lifted the *mechanism* into one place and deliberately left the bounds
 *  as it found them, so that the fix stayed a fix. What it found was a hole:
 *  the portion field carried 1–5000 because the handler it replaced did, and
 *  the four macro fields carried `min: 0` and **no ceiling at all** — so a
 *  thumb that lands on the wrong key in KCAL puts five figures into the day's
 *  total and nothing anywhere says otherwise. The bound that was too loose was
 *  the visible one; the bound that was missing was the one next to it.
 *
 *  These are **typo-catchers, not opinions about food.** Each sits far enough
 *  above any single item that honest input cannot reach it — 10,000 kcal is
 *  four days of eating for the person this app is built for, 1,000 g of one
 *  macro in one item is not a food, and 2,000 g is the far end of "how much of
 *  this scanned product did you eat", which is what the portion field asks
 *  (#15) rather than how big the package is. A ceiling that fires on real
 *  meals teaches people to fight the field; one that only ever fires on a
 *  slipped thumb costs nothing, and that asymmetry is the whole design.
 *
 *  **Here, and not beside the fields, because here a test can reach it.** The
 *  numbers *are* the rule, so they are what `numeric.test.ts` asserts against;
 *  a table living in JSX is a rule with no test, and becomes a second
 *  statement of itself the first time a sixth field wants the same ceiling.
 *
 *  `decimals` rides along for the same reason the bounds do — it was three
 *  separate `decimals={1}` props on three macro fields, which is #86's defect
 *  at its smallest scale. The integer rows say nothing about it, because
 *  `NumericField` already defaults to 0 and restating a default is exactly how
 *  Onboarding's `?? 62` rotted against a column rebuilt to 58.
 */
export const FOOD_LIMITS = {
  /** The portion row on a barcode read. Min 1 because 0 g of something is not
   *  a small meal, it is a field being cleared, and clearing has its own answer. */
  grams: { min: 1, max: 2000 },
  /** Per item, never per meal — a sheet of several items may total more, and
   *  the footer is right to say so. */
  kcal: { min: 0, max: 10000 },
  /** Per item, per macro, and the same number for all three on purpose: they
   *  are the same mistake wearing three labels, and three different ceilings
   *  would only invite an argument about which. 1dp matches what the app
   *  stores and what the barcode rescale produces. */
  macro_g: { min: 0, max: 1000, decimals: 1 },
} as const satisfies Record<string, NumericRule>;

/** A decimal literal and nothing else. `Number()` alone is too generous to be
 *  a validator: it reads `"0x1f"` as 31 and `" "` as 0, so a field backed by it
 *  accepts strings no keypad can produce and turns whitespace into a number. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseNumeric(text: string, rule: NumericRule = {}): NumericCommit {
  // A comma is the decimal separator on most non-English phone keypads, and
  // `Number("1,5")` is NaN — so without this the field is unusable abroad
  // rather than merely awkward.
  const raw = text.trim().replace(",", ".");
  if (raw === "") return rule.allowEmpty ? { kind: "empty" } : { kind: "keep", why: "blank" };
  if (!DECIMAL.test(raw)) return { kind: "keep", why: "unparsable" };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { kind: "keep", why: "unparsable" };

  let value = n;
  let clamped: "min" | "max" | null = null;
  if (rule.min !== undefined && value < rule.min) {
    value = rule.min;
    clamped = "min";
  }
  if (rule.max !== undefined && value > rule.max) {
    value = rule.max;
    clamped = "max";
  }
  return { kind: "value", value: roundTo(value, rule.decimals ?? 0), clamped };
}

/** What the field shows when nobody is typing in it. Deliberately *not* a
 *  fixed-decimal format: `52` must not render as `52.0` in a field someone is
 *  about to edit, or every macro edit starts by deleting a zero. */
export function formatNumeric(value: number | null, decimals = 0): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(roundTo(value, decimals));
}

function roundTo(n: number, decimals: number) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
