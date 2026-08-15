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
