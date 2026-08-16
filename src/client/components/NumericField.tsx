import { useEffect, useRef, useState } from "react";
import { type NumericRule, formatNumeric, parseNumeric } from "../lib/numeric";

/** One numeric input, for every numeric input in the app (#95).
 *
 *  **The reported bug was two defects at once, and only one of them was React.**
 *  All of this was measured against the running app with CDP, reading
 *  `value` and `selectionStart` back after each keystroke — not reasoned about.
 *
 *  1. *The coercion loop.* The old fields parsed on every keystroke and fed the
 *     result straight back in as `value`. `Number("")` is 0 and passes a
 *     `n >= 0` test, so backspacing a macro field to empty wrote a real **0**
 *     into the meal and the field showed `0` — clearing it was impossible.
 *     Typing `5` then `.` left `"5"`: the parse says 5, React writes `"5"` back
 *     over `"5."`, and the point is gone. The portion field failed the other
 *     way — its handler ignored anything outside 1–5000, so backspacing to
 *     empty updated no state and React restored `"150"` under the cursor, which
 *     is the shape the issue predicted. Whenever the canonical text differs
 *     from what the element holds, React assigns `input.value`, and that
 *     assignment moves the caret to the end.
 *  2. *`type="number"` has no selection model at all.* Measured: `selectionStart`
 *     reads `null` and `setSelectionRange` throws
 *     `InvalidStateError: … type ('number') does not support selection`. iOS
 *     Safari's tap-to-place-caret, the loupe and the Select All menu are all
 *     built on that model, so select-all-and-retype cannot work in a number
 *     field on a phone no matter what React does — this half of the report was
 *     never React's fault and fixing (1) alone would not have touched it.
 *
 *  So: `type="text"` with an `inputMode`, and the cost is real — no spinners
 *  (desktop only), no native range enforcement (`parseNumeric` clamps instead,
 *  in one place), and the element will accept letters, which now commit as a
 *  visible revert rather than being swallowed by the browser. In exchange the
 *  caret is placeable, and readable, which is also the only reason any of the
 *  above could be measured rather than guessed at.
 *
 *  The fix for (1) is the idiom `GoalWeightField` already used and this
 *  component lifts: **hold the raw text while the field is being typed in, and
 *  never coerce until commit.** While `typing` is non-null the element's value
 *  is exactly what the user put there, so React has nothing to correct and the
 *  caret never moves.
 *
 *  **An empty commit reverts, and says so.** The alternative on the table was
 *  treating it as removing the item, and it doesn't survive contact: these are
 *  four numbers *inside* an item plus a portion size, and there is no coherent
 *  reading of "I cleared the carbs field" that means "delete the meal" — the
 *  sheet has no per-item delete precisely because a hidden one would be worse
 *  than none. Committing 0 was the other option and is the reported bug with
 *  better manners: you clear a field meaning to retype it, tap Save, and log a
 *  meal with no calories in it. So the previous number goes back — and the
 *  field prints `KEPT 280` where nothing was before, because a restore nobody
 *  can see is the same defect wearing a different hat.
 *
 *  **Blur commits only what somebody typed.** It used to commit
 *  unconditionally, so tapping into a field and straight back out ran a parse,
 *  a clamp and possibly an `onCommit` over text the user never touched. That
 *  is wrong on its own terms — a number must not change because you looked at
 *  it — and once the fields carry real ceilings (`FOOD_LIMITS`) it is a defect
 *  you can walk into: the portion field rescales every macro on the sheet, 2 kg
 *  of Nutella computes to 1,150 g of carbs, and an untouched blur would have
 *  quietly cut that to the 1,000 g ceiling and printed `MAX 1000` about an
 *  edit nobody made. The guard is `typing === null`, which reads as "no
 *  keystroke has landed since the last commit" — and since `commit` is reached
 *  from nowhere but blur, that is the same statement as "not edited since this
 *  field took focus".
 *
 *  **It cannot strand a `live` field**, which is the half worth checking
 *  rather than assuming. A live commit fires from `onChange`, which has
 *  already set `typing` and never clears it, so the field is *always* in the
 *  typed state by the time blur arrives. And the cases where blur is doing the
 *  real work are exactly the three that live refuses to commit — blank,
 *  unparsable, and clamped — every one of which leaves `typing` set. So
 *  `KEPT 280` and `MAX 2000` still fire off the last keystroke, and the only
 *  commit the guard can ever swallow is one over text the field wrote itself.
 */
export function NumericField({
  value,
  onCommit,
  onClear,
  live = false,
  min,
  max,
  decimals = 0,
  allowEmpty = false,
  id,
  ariaLabel,
  placeholder,
  disabled,
  autoFocus,
}: NumericRule & {
  value: number | null;
  onCommit: (n: number) => void;
  /** Only meaningful with `allowEmpty`. */
  onClear?: () => void;
  /** Also commit on every keystroke that parses to a clean, in-range number.
   *  For fields whose commit is local state — the confirm sheet's totals have
   *  to move as you type, and the portion field rescales the whole sheet. Never
   *  for a field that writes to the network: `GoalWeightField` is blur-only
   *  because per-character PATCHes save "7", "77", "776" to a column Trends
   *  draws a line from, and a dropped connection leaves one of them behind. */
  live?: boolean;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const rule: NumericRule = { min, max, decimals, allowEmpty };
  const [typing, setTyping] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  function say(text: string | null) {
    clearTimeout(timer.current ?? undefined);
    setNote(text);
    // Long enough to read after looking away from the keyboard, short enough
    // that a stale notice isn't still sitting there next time you open the row.
    if (text) timer.current = setTimeout(() => setNote(null), 5000);
  }

  function commit(text: string) {
    setTyping(null);
    const res = parseNumeric(text, rule);
    if (res.kind === "empty") {
      say(null);
      if (value !== null) onClear?.();
      return;
    }
    if (res.kind === "keep") {
      say(value === null ? "NEEDS A NUMBER" : `KEPT ${formatNumeric(value, decimals)}`);
      return;
    }
    say(res.clamped ? `${res.clamped === "max" ? "MAX" : "MIN"} ${formatNumeric(res.value, decimals)}` : null);
    if (res.value !== value) onCommit(res.value);
  }

  return (
    <span className="numfield">
      <input
        id={id}
        // Not type="number" — see this component's own note. `inputMode` still
        // asks for the right phone keypad, and it follows `decimals` so an
        // integer field can't offer a separator key that its own commit rule
        // would round away.
        type="text"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        enterKeyHint="done"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        value={typing ?? formatNumeric(value, decimals)}
        onChange={(e) => {
          const text = e.target.value;
          setTyping(text);
          say(null); // you're typing again; whatever it said is about the past
          if (!live) return;
          const res = parseNumeric(text, rule);
          // Live only for a clean in-range number. Blank, unparsable and
          // clamped are *decisions*, and a decision belongs at commit, where
          // there is somewhere to explain it.
          if (res.kind === "value" && res.clamped === null && res.value !== value) {
            onCommit(res.value);
          }
        }}
        // Committing is for values a person typed. `typing === null` means the
        // element is showing text this component wrote from `value`, and
        // re-committing that is at best a no-op and at worst a silent clamp of
        // a number arrived at some other way. See the note above.
        onBlur={(e) => {
          if (typing !== null) commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {/* Rendered even when empty so the live region exists in the a11y tree
          before it has anything to announce — VoiceOver is unreliable about
          regions that appear at the same moment as their first message. */}
      <span className="numfield-note" role="status">
        {note}
      </span>
    </span>
  );
}
