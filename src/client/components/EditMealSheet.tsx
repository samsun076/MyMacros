import { useEffect, useMemo, useState } from "react";
import type { AnalyzedItem, FoodLog, FoodLogItemEdit, MealSlot } from "../../shared/api";
import { api } from "../lib/api";
import { fmtInt } from "../lib/format";
import { blankItem, editableFromLog, setPortionQty, type EditableItem } from "../lib/portion";
import { ItemRow } from "./ItemRow";

/** Reopen a saved timeline entry and correct it (#60).
 *
 *  **The rows are `ItemRow`, the chrome is not.** Everything a person touches
 *  here — the macro fields and their bounds, the portion control, tap to
 *  expand — is the same component the confirm sheet renders, which is what
 *  #60's "don't build a second one" is actually protecting. What is *not*
 *  shared is the head, the subtitle and the footer button, because the confirm
 *  sheet's are about a read that has not been saved (how long it took, whether
 *  it failed, whether to star it, `Log N kcal`) and this sheet has no read
 *  behind it at all. See `ItemRow` for the argument in full.
 *
 *  **It edits a copy and commits once.** Nothing is written until Save, so
 *  dismissing is a real cancel — unlike the timeline's other gesture, where
 *  #52 deletes immediately and offers an undo. The two are opposite on purpose:
 *  a delete is one motion and needs a way back, an edit is a page of fields and
 *  needs a way out.
 *
 *  **It cannot empty an entry.** The last row's Remove is disabled and says
 *  which gesture to use instead. `PATCH` refuses an empty list independently,
 *  so the rule is not a UI convention — but a control that simply refuses
 *  without explaining is the dead-button complaint #95 was filed about, and the
 *  thing to point at (a swipe, which has an undo) is not guessable.
 */
export function EditMealSheet({
  entry,
  onClose,
  onSaved,
}: {
  /** The rows this timeline entry folded from — `/api/day`'s own, held by the
   *  screen. The sheet never refetches: the list it is editing is the list the
   *  user is looking at, and a second read could disagree with it. */
  entry: { rows: FoodLog[]; slot: MealSlot; desc: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  /** Seeded once. A saved row becomes an `EditableItem` whose `base` is the
   *  STORED figures, so the portion control rescales from what was logged
   *  rather than from what the reader originally counted — see
   *  `editableFromLog`, which is where that decision is argued and tested.
   *
   *  `id` rides alongside rather than inside the item: `EditableItem` is the
   *  confirm sheet's shape and has no row behind it, and giving it an optional
   *  id would let a pre-save row carry one. An added row's id is `null`, which
   *  is what the PATCH body says by omitting it. */
  const [items, setItems] = useState<{ id: string | null; item: EditableItem }[]>(() =>
    entry.rows.map((row) => ({ id: row.id, item: editableFromLog(row) })),
  );
  const [slot, setSlot] = useState<MealSlot>(entry.slot);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Escape closes it, the way it closes any dialog.
   *
   *  **`Log.tsx`'s confirm sheet still has no such handler and this is not an
   *  inconsistency with it — it is that comment's own carve-out.** The reason
   *  the confirm sheet is denied a keystroke is that dismissing it is
   *  *destructive*: the read is thrown away and #16's photo, already in R2,
   *  loses its only handle on screen. Nothing here is destroyed. The entry is
   *  in D1 and stays there; what a dismiss discards is a page of unsaved
   *  fields.
   *
   *  The decisive part is that **the backdrop tap already discards them, with
   *  no confirmation.** Escape is not a new hazard, it is the same exit reached
   *  by a keyboard — and withholding it would make this sheet
   *  pointer-dismissable only, which is the exact principle the `vh-button` in
   *  `SwipeToDelete` exists to deny. So: destructive dismiss, no key (the
   *  confirm sheet); cheap dismiss, key (the picks panel, and this).
   *
   *  Not while a save is in flight: the request is already going to land, and
   *  closing over it would leave the screen unable to say whether it did. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  /* Which row's `source` a note is drawn from. Per row and not per sheet: a
     meal can now hold rows of different provenance — a photographed plate with
     a hand-typed olive oil added to it — and the row that says FROM THE BARCODE
     has to be the one that was scanned. Rows added in this sheet have no stored
     row at all, so they take `manual` and say TYPE WHAT YOU ATE. */
  const sourceOf = (index: number) => entry.rows.find((r) => r.id === items[index]?.id)?.source ?? "text";

  const totals = useMemo(() => {
    const list = items.map((i) => i.item);
    return {
      kcal: list.reduce((s, it) => s + it.calories, 0),
      p: Math.round(list.reduce((s, it) => s + it.protein_g, 0)),
      c: Math.round(list.reduce((s, it) => s + it.carbs_g, 0)),
      f: Math.round(list.reduce((s, it) => s + it.fat_g, 0)),
    };
  }, [items]);

  function update(index: number, patch: Partial<AnalyzedItem>) {
    setItems((list) =>
      list.map((row, i) => (i === index ? { ...row, item: { ...row.item, ...patch } } : row)),
    );
  }

  function setQty(index: number, qty: number) {
    setItems((list) =>
      list.map((row, i) => (i === index ? { ...row, item: setPortionQty(row.item, qty) } : row)),
    );
  }

  function remove(index: number) {
    // The open row is addressed by index, so removing one above it would leave
    // the editor open on a different food. Close instead of renumbering: a
    // sheet that silently re-points an open editor is the worse of the two.
    setEditing(null);
    setItems((list) => list.filter((_, i) => i !== index));
  }

  function add() {
    setItems((list) => [...list, { id: null, item: blankItem() }]);
    // Opened, because a collapsed blank row is a row called "Untitled" with no
    // visible way in — the same dead affordance #98 fixed on the row above it.
    setEditing(items.length);
  }

  const unnamed = items.some((row) => !row.item.name.trim());

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/food-logs`, {
        ids: entry.rows.map((r) => r.id),
        meal_slot: slot,
        items: items.map(({ id, item }): FoodLogItemEdit => ({
          ...(id === null ? {} : { id }),
          name: item.name.trim(),
          kcal: item.calories,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fat_g: item.fat_g,
          // Only where there is a stored portion to move. The route refuses a
          // qty on a row that has none — a portion nobody read is #58's
          // invented "1 serving" — and an added row never has one.
          ...(item.portion ? { portion_qty: item.portion.qty } : {}),
        })),
      });
      onSaved();
    } catch {
      setError("Couldn't save those changes — check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div
      className="sheet-wrap"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-label={`Edit ${entry.desc}`}>
        {/* Decoration, and documented as decoration — the same position
            `Log.tsx`'s confirm sheet takes and for the same unresolved reason
            (#102). Dismissing here is cheap rather than destructive, so a drag
            would be defensible; what it is not is *this* issue's decision, and
            a third sheet inventing its own commit distance is exactly what
            `gesture.ts` exists to prevent. */}
        <div className="grab" aria-hidden="true" />

        <div className="sheet-head">
          {/* The same chip the confirm sheet uses, and tapping still cycles it
              — no new control invented (#44). A slot change deliberately does
              not mark the entry `edited`: a slot is not something the AI said,
              and the PATCH route derives that flag rather than trusting this. */}
          <button
            className="slot-btn"
            onClick={() => setSlot(SLOTS[(SLOTS.indexOf(slot) + 1) % SLOTS.length] ?? "snack")}
            aria-label={`Meal slot: ${slot}. Tap to change.`}
          >
            <span className="eyebrow">
              <span className="tick" />
              {label(slot)} · {clock12(entry.rows[0]?.logged_at)}
            </span>
          </button>
          {/* The time is the ENTRY's, not the clock's, and it is not a control.
              `logged_at` is set once (#44) and is also what folds these rows
              into one meal — editing it would split the entry or merge it into
              another one — so the sheet shows when the meal was logged and
              offers no way to move it. */}
          <span className="mono">LOGGED</span>
        </div>
        <p className="sheet-sub">Tap anything to change it. Nothing saves until you say so.</p>

        {items.map(({ id, item }, i) => (
          <ItemRow
            key={id ?? `added-${i}`}
            item={item}
            manual={id === null}
            source={sourceOf(i)}
            editing={editing === i}
            onToggle={() => setEditing(editing === i ? null : i)}
            onChange={(patch) => update(i, patch)}
            onPortion={(qty) => setQty(i, qty)}
            onRemove={() => remove(i)}
            removeWhy={
              items.length > 1
                ? undefined
                : "An entry keeps at least one item — swipe the row on Today to delete the whole meal, which you can undo."
            }
          />
        ))}

        <div className="sheet-add">
          {/* #16's blank row, reached deliberately instead of by a failed read.
              Capped where the save route caps (`MAX_ITEMS`), and the cap is met
              here rather than discovered as a 400. */}
          <button type="button" className="btn-text" disabled={items.length >= MAX_ITEMS} onClick={add}>
            + Add an item
          </button>
          {items.length >= MAX_ITEMS && <span className="opt-hint">That's as many foods as one meal holds.</span>}
        </div>

        <div className="sheet-foot">
          <div className="totals">
            <span className="sum">
              {fmtInt(totals.kcal)} <span>kcal</span>
            </span>
            <span className="mono">
              {totals.p}P · {totals.c}C · {totals.f}F
            </span>
          </div>
          <button className="save" disabled={saving || unnamed} onClick={() => void save()}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {/* The route refuses an unnamed item and would refuse the whole meal
              with it, so the reason is said here rather than arriving as a
              failed save. The confirm sheet's equivalent guard is looser
              (`every` rather than `some`) because a fresh read cannot have a
              named row beside a blank one; this sheet can, the moment you add
              one. */}
          {unnamed && !saving && <p className="opt-hint">Name every item before saving.</p>}
          {error && (
            <p className="signin-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Restated from `routes/food-logs.ts`, which owns it for the wire (#86). The
 *  house pattern for a bound the client also has to draw — same shape as
 *  `FOOD_LIMITS` restating `energy()`'s ceilings — and the reason the copy is
 *  tolerable is the same: the route refuses independently, so the worst a
 *  drifted copy does is show a button that 400s, never write a row nobody
 *  meant. `food-logs.route.test.ts` pins the server's. */
const MAX_ITEMS = 20;

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** "breakfast" → "Breakfast" */
function label(slot: MealSlot) {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

/** "7:12 AM" — the timeline rail's own format, so the sheet's header names the
 *  meal by the same clock the row it came from does. */
function clock12(iso: string | undefined) {
  return iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
}
