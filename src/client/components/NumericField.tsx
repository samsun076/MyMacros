import { useEffect, useRef, useState } from "react";
import { type NumericRule, commitOnBlur, commitWhileTyping, formatNumeric } from "../lib/numeric";

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
 *
 *  ---
 *
 *  **What a revert reverts to: the value at focus, never the current one
 *  (#100).** Everything above says "the previous number goes back", and in a
 *  `live` field there is no such thing by the time it is asked for. Holding
 *  backspace on `17.1` walks the text through `"17."`, `"17"` and `"1"` — each
 *  parses, each is in range, each commits — so at the moment the field is empty
 *  the item really does hold **1**, and `KEPT 1` is an accurate report of a
 *  number nobody typed. Found on device against a scanned bar; the tell is that
 *  the row header already reads `1C` while the keyboard is still up, so the
 *  wrong figure had reached the sheet before blur was involved at all.
 *
 *  So the field remembers what it held when it took focus (`atFocus`) and puts
 *  *that* back, committing it where the live commits have moved the real one.
 *  Blur-only fields get the same treatment and cannot tell the difference —
 *  their `value` can't move while you type — which is the reason it is
 *  unconditional. "It depends whether the field is live" would be a second rule
 *  with no visible boundary.
 *
 *  **The decision, made rather than fallen into: unparsable reverts to the
 *  focus value too.** The two cases arrive at the same line of code and could
 *  be split. Blank is unarguable — clearing a field means "I am about to retype
 *  this". Unparsable is arguable: type `125`, land a stray character, and
 *  reverting to focus discards a number you did fully type, where keeping
 *  `value` would hand it back.
 *
 *  It is one rule anyway, for three reasons.
 *
 *  1. *The user cannot see the boundary.* Both cases look identical from the
 *     outside — a field you changed, then tapped away from — and both print
 *     `KEPT n`. Two rules would make that note name two different kinds of
 *     number with nothing to distinguish them.
 *  2. *The failure modes are not the same size.* Reverting to focus can only
 *     undo something done in this visit to the field: the worst case is
 *     retyping, and the field names the number it put back, so you can see it
 *     is the old one. Reverting to `value` can hand back a *prefix* of a number
 *     nobody meant — a plausible figure, silently wrong, which is the exact
 *     class of defect rule 4b exists for.
 *  3. *"The last good keystroke" is not the salvage it sounds like.* `"12a"`
 *     keeps 12 only because 12 happened to be complete; `"5.."` keeps 5, and
 *     `"1.2.3"` keeps 1.2 — half-typed numbers, restored with a note that
 *     presents them as considered. On a phone the keypad has no letters at all
 *     (`inputMode` is numeric/decimal), so the realistic unparsable string is a
 *     malformed decimal *mid-construction*, which is where salvage is worst.
 *
 *  The cost is real and accepted: a hardware-keyboard typo at the end of a long
 *  entry costs the whole entry. It costs it visibly.
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
  // What `value` was when this field took focus (#100). Boxed rather than a
  // bare `number | null`, because `null` is a real focus value — the goal
  // weight field starts empty — and "focused on nothing" has to be
  // distinguishable from "never focused". A ref, not state: reading it must not
  // depend on a render having happened since the focus event.
  const atFocus = useRef<{ was: number | null } | null>(null);

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
    // A blur with no focus behind it isn't a state React produces — `typing`
    // can only be non-null because a keystroke landed in a focused element —
    // so the fallback is unreachable rather than load-bearing. It is `value`,
    // which is the behaviour this component had before #100, on the principle
    // that an unreachable branch should degrade to the old answer rather than
    // to a new one nobody has thought about.
    // `?.was ?? value` would be wrong here and quietly: a field focused while
    // empty has `was: null`, which `??` cannot tell from no box at all.
    const action = commitOnBlur(text, rule, { value, atFocus: atFocus.current ? atFocus.current.was : value });
    atFocus.current = null;
    say(action.note);
    if (action.do === "commit") onCommit(action.value);
    // Redundant where the field is already empty, and `onClear` is absent
    // entirely unless `allowEmpty` — the guard is here rather than in the rule
    // so the rule can say "make it empty" without also knowing whether it is.
    if (action.do === "clear" && value !== null) onClear?.();
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
        // Where the revert target comes from (#100). Once per visit to the
        // field, before any keystroke can move `value` out from under it.
        onFocus={() => {
          atFocus.current = { was: value };
        }}
        onChange={(e) => {
          const text = e.target.value;
          setTyping(text);
          say(null); // you're typing again; whatever it said is about the past
          if (!live) return;
          const action = commitWhileTyping(text, rule, value);
          if (action) onCommit(action.value);
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
