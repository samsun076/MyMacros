import { useId } from "react";
import type { AnalyzedItem, FoodSource } from "../../shared/api";
import { fmtInt } from "../lib/format";
import { FOOD_LIMITS, type NumericRule, portionQtyRule } from "../lib/numeric";
import { type EditableItem, portionLabel } from "../lib/portion";
import { NumericField } from "./NumericField";

/** One editable food, and the four-plus-one fields behind it — the row every
 *  sheet in this app that edits a meal is made of (#60).
 *
 *  **It moved here out of `Log.tsx`, and what it is protecting is per-item
 *  editing, not "a sheet".** #60 opens a second surface over the same data: the
 *  confirm sheet edits a *read* before it saves, the edit sheet edits *rows*
 *  that are already in D1. The thing that must not exist twice is what a person
 *  actually touches — the macro fields and their bounds, the portion control
 *  and the unit-aware rule behind it, tap-to-expand, and #98's structure where
 *  the numbers live *inside* the button. That is now literally one component
 *  with one table of limits, so the two sheets cannot drift about what a
 *  kilocalorie field accepts or about which taps open a row.
 *
 *  **The chrome around it is deliberately NOT shared**, and that is the whole
 *  shape of this extraction. Log's sheet head carries a star, a read time and
 *  #16's "couldn't read it" line; #15's grams field sits above the rows; the
 *  footer says `Log N kcal`. The edit sheet has none of that and gains none of
 *  it — forcing one sheet component with head/foot slots would mean pushing
 *  Log's read-only state (the favourite, `readMs`, `manual`, the barcode
 *  rescale) through props into a surface that has no read behind it, which is a
 *  worse coupling than two 25-line chromes that share this. #81 and #59 both
 *  operate on the *pre-save* sheet and would gain nothing from a fuller
 *  extraction either.
 *
 *  **The move was behaviour-preserving and was checked as such**, not asserted.
 *  `/log#confirm` and `/log#portion` were shot at 375/390/428 before and after.
 *  Byte-identity is *not* available as evidence here and saying so is part of
 *  the check: the sheet stamps `new Date()` twice, so two runs of the
 *  **unchanged** app already differ. So the control was measured first — two
 *  baseline runs differ in exactly two 11×16px bands, the minutes digit of the
 *  top-bar clock and of the slot chip (at 375: y 57–72 × 679–689, and y
 *  1377–1392 × 253–263). Before-vs-after differs in those same two bands and
 *  in nothing else, at all three widths. A screenshot that merely "looks the
 *  same" would not have distinguished this from a one-pixel reflow.
 */
export function ItemRow({
  item,
  manual,
  source,
  editing,
  onToggle,
  onChange,
  onPortion,
  onRemove,
  removeWhy,
}: {
  item: EditableItem;
  /** #16's blank row — nothing read it, so there is nothing to report about
   *  it. Also every row #60's edit sheet *adds* to a saved meal, for the same
   *  reason: no reader proposed it, so it has no confidence and no portion. */
  manual: boolean;
  /** How the meal was captured, and the only thing that makes a null
   *  confidence mean "exact" rather than "unknown" (#60).
   *
   *  It used to be inferred: a null confidence on the confirm sheet was a
   *  barcode's exact match, because that is the only read that produces one.
   *  The edit sheet breaks the inference — a `favorite` re-log stores a null
   *  confidence too, and inferring there would print FROM THE BARCODE on a row
   *  that was never scanned. So the row is told, instead of guessing. */
  source: FoodSource;
  editing: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<AnalyzedItem>) => void;
  /** #58. Never fires for a row the reader gave no portion — that row draws
   *  no control at all rather than one over an invented "1 serving". */
  onPortion: (qty: number) => void;
  /** #60's per-item delete, inside the open editor. Absent on the confirm
   *  sheet: nothing is saved there yet, so a row is removed by not saving it,
   *  and a delete control would be a second way to do what dismissing already
   *  does. */
  onRemove?: () => void;
  /** Why `onRemove` is refused right now, shown beside the disabled control.
   *  A hidden control cannot explain itself, and the rule it is enforcing —
   *  an entry always has at least one item — is not guessable from an absence. */
  removeWhy?: string;
}) {
  // low confidence gets the sketch's CHECK treatment (accent badge + open row)
  const low = item.confidence !== null && item.confidence < 0.75;
  // null confidence on a scanned row means nothing estimated it — a barcode's
  // exact match (#15)
  const exact = !manual && item.confidence === null && source === "barcode";
  const portion = manual ? null : portionLabel(item.portion);
  // One id per rendered row, so the portion field's <label> points at its own
  // input and not at the row above it. `useId` rather than the map index: the
  // index is a render-order fact, and a11y wiring that depends on sibling
  // order is the kind that breaks silently when the sheet grows a sort.
  const qtyId = useId();

  /* What the collapsed row says about how good its numbers are.
   *
   * The empty case is #60's and is deliberately empty: a saved `favorite` row
   * carries a null confidence and was never scanned, so there is nothing to
   * report about it. Printing `CONFIDENCE 0%` — which is what the fall-through
   * did, via `(item.confidence ?? 0)` — would be the app inventing a claim
   * about a number nobody ever estimated. Unreachable from the confirm sheet,
   * where a non-manual null confidence is always a barcode. */
  const note = manual
    ? "TYPE WHAT YOU ATE"
    : exact
      ? "FROM THE BARCODE"
      : item.confidence === null
        ? ""
        : low
          ? "BEST GUESS — TAP TO ADJUST"
          : `CONFIDENCE ${Math.round(item.confidence * 100)}%`;

  return (
    <div className={low || editing ? "item check" : "item"}>
      {/* **The numbers are inside the button** (#98). They used to be a
          *sibling* of it, so the calorie figure and the macro line — the one
          region a person reaches for when they want to change a number — did
          nothing at all, while the sheet's own copy two lines above said "tap
          anything to change it".

          Structure rather than a handler on `.item`, because the constraint
          here is that `.item-edit` lives in the same container: a container
          click handler has to *guard* against every tap inside the open
          editor, and that guard is a rule someone can get wrong later. Moving
          the numbers in instead leaves the editor a **sibling of the button,
          never a descendant**, so a tap on a field cannot reach this onClick
          in the first place — there is nothing to guard. Same reason
          `.item-hit` is still one real `<button>` with `aria-expanded`: the
          pointer target grew, the control did not change.

          `.item-text` exists so the button's grid is two cells and not four:
          the name and the label under it are one block in the left cell, the
          way they were when the button was the left cell. Without it the kcal
          figure spans two rows and grid hands its spare height to both of
          them, which moves the label. */}
      <button className="item-hit" onClick={onToggle} aria-expanded={editing}>
        <span className="item-text">
          <span className="name">
            {item.name || (manual ? "Untitled" : "")}
            {low && <span className="badge">CHECK</span>}
          </span>
          {/* The portion leads and the confidence signal follows it (#58).
              Both, not one: the amount is what people check first, and
              dropping "BEST GUESS — TAP TO ADJUST" to make room would remove
              the only thing on the collapsed row that says a number is
              uncertain. The pair is what gets measured at 375 — the sheet's
              totals row and save button must stay on screen with a row
              open. */}
          <span className="portion">
            {portion && <span className="qty">{portion}</span>}
            {note}
          </span>
        </span>
        <span className="kcal">
          {fmtInt(item.calories)}
          <small>
            {Math.round(item.protein_g)}P · {Math.round(item.carbs_g)}C · {Math.round(item.fat_g)}F
          </small>
        </span>
      </button>

      {editing && (
        <div className="item-edit">
          <label>
            NAME
            <input
              type="text"
              value={item.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          </label>
          {/* #58's control, inside the open row rather than on the collapsed
              one. The collapsed sheet has to stay compact at 375 — three rows,
              a totals line and the save button — and a stepper per row is
              three more controls competing with the one tap that opens a row.
              Above the four macro fields on purpose: it is the thing that
              *moves* them, so reading top-to-bottom is cause then effect.
              `live`, like every other field on this sheet: the row's own kcal
              and the footer total rescale as you type.

              **The bound follows the unit** (#109): `portionQtyRule`, never
              `FOOD_LIMITS.portion_qty` directly. 100 is a generous ceiling for
              a row counted in slices and a wrong one for a row measured in
              grams, and spreading the counted rule onto both is what stored
              200 g of chicken as 100 g. The clamp itself stays — a field
              somebody is typing in is where a clamp is *visible*, which is the
              #95/#96 typo-catcher pattern; what #109 forbids is rewriting a
              wire value nobody can see. */}
          {item.portion && (
            <div className="item-portion">
              <label htmlFor={qtyId}>HOW MUCH</label>
              <NumericField
                id={qtyId}
                value={item.portion.qty}
                onCommit={onPortion}
                live
                {...portionQtyRule(item.portion.unit)}
              />
              <span className="mono">{item.portion.unit.toUpperCase()}</span>
            </div>
          )}
          {/* All four are `live`: the footer total and the row's own kcal read
              off them, and a sheet whose total only catches up when you tap
              away reads as broken. Bounds and decimals both come from
              FOOD_LIMITS — three of these rows are the same rule, and stating
              it three times is how the four fields drifted apart last time. */}
          <div className="item-edit-nums">
            <NumField
              label="KCAL"
              value={item.calories}
              rule={FOOD_LIMITS.kcal}
              onChange={(calories) => onChange({ calories })}
            />
            <NumField
              label="PROTEIN"
              value={item.protein_g}
              rule={FOOD_LIMITS.macro_g}
              onChange={(protein_g) => onChange({ protein_g })}
            />
            <NumField
              label="CARBS"
              value={item.carbs_g}
              rule={FOOD_LIMITS.macro_g}
              onChange={(carbs_g) => onChange({ carbs_g })}
            />
            <NumField
              label="FAT"
              value={item.fat_g}
              rule={FOOD_LIMITS.macro_g}
              onChange={(fat_g) => onChange({ fat_g })}
            />
          </div>

          {/* **Disabled and explained, never hidden** (#60). The rule it is
              enforcing — an entry always has at least one item, because a
              PATCH that empties one would be a delete with no undo behind it —
              is not guessable from a control that simply is not there, and the
              user's next move (swipe the row, which *does* have an undo) is
              the thing the sentence has to point at. It sits at the bottom of
              the open editor, below the numbers, because it is the one action
              here that cannot be typed over afterwards. */}
          {onRemove && (
            <div className="item-remove">
              <button type="button" className="btn-text danger" disabled={!!removeWhy} onClick={onRemove}>
                Remove this item
              </button>
              {removeWhy && <span className="opt-hint">{removeWhy}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The sheet's own wrapper: the label cell of `.item-edit-nums`, around the
 *  shared field. Nothing but layout lives here — the commit rule, the clamp and
 *  what an empty field means are all `NumericField`'s, so the four macros and
 *  the portion field can't drift apart the way they had (#95).
 *
 *  It takes a whole `NumericRule` rather than a `decimals` prop and a hardcoded
 *  `min={0}`, because that hardcode was the last place on this screen still
 *  deciding a bound for itself — and it decided the same wrong thing four
 *  times, silently, by having no ceiling to state.
 *
 *  Not exported. It is `ItemRow`'s layout and nothing else uses it; a second
 *  consumer is what would make it worth a name outside this file. */
function NumField({
  label,
  value,
  rule,
  onChange,
}: {
  label: string;
  value: number;
  rule: NumericRule;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      {label}
      <NumericField value={value} onCommit={onChange} live {...rule} />
    </label>
  );
}
