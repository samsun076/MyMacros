/** What a typed string commits to (#95), and what a field does about it (#100).
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
 *  **`parseNumeric` never runs while you type**, and that is the bug it exists
 *  to fix. A handler that parses on every keystroke re-renders the input with a
 *  value the DOM does not have — `""` parses to 0, `"0150"` parses to 150,
 *  `"5."` parses to 5 — and React answers the mismatch by writing the canonical
 *  text back into the element, which dumps the caret at the end. See
 *  `NumericField.tsx` for the other half of the fix.
 *
 *  **`commitWhileTyping` and `commitOnBlur` moved down here with #100**, and
 *  they are the same argument one level up. They were four lines of JSX inside
 *  the component, which made the field's behaviour reachable only by rendering
 *  it — and the unit project has no DOM, so the only test that could exist was
 *  one that restated the rule in order to agree with it. #100 shipped precisely
 *  because every *endpoint* was covered and the *path* between them was not, so
 *  the path had to become something a test could walk. These two functions are
 *  that path: they take everything the field knows and return what it should
 *  do, and `NumericField` is now wiring.
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
  /** The per-item portion count (#58) — "4" in *4 slices*. **Derived here, not
   *  copied from the row above it**: `grams` measures a scanned product's
   *  weight and 2 kg is a plausible slip; this counts *things*, and the
   *  ceiling that matters is how many of one food a person eats at a sitting.
   *  100 is far past a real meal in every unit the reader emits (slices,
   *  tacos, cups, wings) and still catches the thumb that turns 4 into 44 or
   *  drops a decimal point.
   *
   *  1dp because half portions are ordinary — "1.5 cups", "half a bowl" —
   *  and min 0.1 for `grams`' reason exactly: 0 of something is not a small
   *  meal, it is a field being cleared, and clearing has its own answer. It is
   *  also load-bearing rather than tidy, because the rescale divides by the
   *  as-read qty and a committed 0 would be a divide-by-zero.
   *
   *  `normalize()` in `src/worker/routes/analyze.ts` states the same ceiling
   *  a second time for the wire. Deliberate, and explained there. */
  portion_qty: { min: 0.1, max: 100, decimals: 1 },
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

/** What a field should do with the text it is holding, and what it should say.
 *
 *  Every variant carries a `note`, including the ones that change nothing,
 *  because the note is not decoration. #95's whole finding was that a restore
 *  nobody can see is the reported bug wearing a different hat — so whatever
 *  decides *what happened* also has to decide *what to say about it*, in the
 *  same expression, where the two cannot drift. `note: null` is a positive
 *  statement that there is nothing to report, not an omission. */
export type FieldAction =
  | { do: "commit"; value: number; note: string | null }
  | { do: "clear"; note: string | null }
  | { do: "say"; note: string | null };

/** One keystroke, in a field that commits as you type.
 *
 *  Live only for a clean in-range number. Blank, unparsable and clamped are
 *  *decisions*, and a decision belongs at blur, where there is somewhere to
 *  explain it. `null` means this keystroke changes nothing — which includes
 *  text that parses to the number already stored, because the parent treats any
 *  `onCommit` as an edit and `"07"` after `"7"` is not one.
 *
 *  The return type is narrowed to the commit arm on purpose: live can produce
 *  nothing else, and saying so here is what spares both callers a `do` check
 *  they would have to invent an answer for. */
export function commitWhileTyping(
  text: string,
  rule: NumericRule,
  value: number | null,
): Extract<FieldAction, { do: "commit" }> | null {
  const res = parseNumeric(text, rule);
  if (res.kind !== "value" || res.clamped !== null || res.value === value) return null;
  return { do: "commit", value: res.value, note: null };
}

/** Leaving a field, and the one place that decides what a refused commit falls
 *  back to (#100).
 *
 *  **`atFocus`, never `value`.** In a `live` field `value` is not "what was
 *  there" — it is wherever the live commits have walked it, which for a field
 *  being cleared is an artifact of the deletion: hold backspace on `17.1` and
 *  `"17."`, `"17"` and `"1"` all parse and all commit, so by the time the text
 *  is empty the stored number is 1 and 17.1 exists nowhere. Falling back to
 *  `value` there is truthful about what the code did and wrong about what the
 *  person has. See `NumericField.tsx` for why this applies to unparsable text
 *  too, which is the arguable half.
 *
 *  The restored figure is **not re-clamped**, and that is the same rule as "a
 *  blur commits only what somebody typed": the portion row can legitimately
 *  leave 1,150 g of carbs in a field whose ceiling is 1,000, and putting that
 *  number back is a restore, not an entry. */
export function commitOnBlur(
  text: string,
  rule: NumericRule,
  { value, atFocus }: { value: number | null; atFocus: number | null },
): FieldAction {
  const decimals = rule.decimals ?? 0;
  const res = parseNumeric(text, rule);
  // Deliberately empty, where empty is a value. Not a revert — `allowEmpty`
  // means the person just said something. The caller drops it if `value` is
  // already null, so this can be returned without checking.
  if (res.kind === "empty") return { do: "clear", note: null };
  if (res.kind === "keep") {
    // Nothing to put back: the field held nothing when you arrived at it.
    // Where empty is a value, empty is what goes back; where it isn't, there is
    // no number to name and the only honest note is what the field still wants.
    if (atFocus === null) return { do: rule.allowEmpty ? "clear" : "say", note: "NEEDS A NUMBER" };
    const note = `KEPT ${formatNumeric(atFocus, decimals)}`;
    return atFocus === value ? { do: "say", note } : { do: "commit", value: atFocus, note };
  }
  const note = res.clamped ? `${res.clamped === "max" ? "MAX" : "MIN"} ${formatNumeric(res.value, decimals)}` : null;
  return res.value === value ? { do: "say", note } : { do: "commit", value: res.value, note };
}
