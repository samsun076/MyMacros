import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { AnalyzeResponse, AnalyzedItem, MealSlot } from "../../shared/api";
import { api } from "../lib/api";
import { deviceTimezone, localDay, mealSlotFor } from "../lib/day";
import { fmtInt } from "../lib/format";

/** The M2 log flow: text quick-add → editable confirm sheet → saved (#9/#10).
 *  Chrome (top bar, modes row) and the sheet are ported from
 *  sketches/e-log-flow.html; the sketch designs only the photo stage, so the
 *  text-entry block follows the system idiom rather than frozen markup.
 *  PHOTO and BARCODE light up in M3 (#13/#14). */

type EditableItem = AnalyzedItem & { orig: AnalyzedItem };

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** DEV-only: `/log#confirm` opens the sheet pre-filled with the sketch's
 *  demo meal, mirroring e-log-flow.html's hash-navigable stages so
 *  tools/shot-matrix.mjs can shoot the sheet without a Claude round trip.
 *  import.meta.env.DEV is a build-time literal — compiled out in prod. */
function demoRead(): { items: EditableItem[]; readMs: number } | null {
  if (!import.meta.env.DEV || window.location.hash !== "#confirm") return null;
  const items: AnalyzedItem[] = [
    { name: "Grilled chicken breast", calories: 280, protein_g: 52, carbs_g: 0, fat_g: 6, confidence: 0.9 },
    { name: "Jasmine rice", calories: 210, protein_g: 4, carbs_g: 45, fat_g: 0, confidence: 0.6 },
    { name: "Steamed broccoli", calories: 55, protein_g: 4, carbs_g: 11, fat_g: 1, confidence: 0.85 },
  ];
  return { items: items.map((it) => ({ ...it, orig: it })), readMs: 1800 };
}

export function Log() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<{ items: EditableItem[]; readMs: number } | null>(demoRead);
  const [slot, setSlot] = useState<MealSlot>(() => mealSlotFor());
  const [editing, setEditing] = useState<number | null>(null);
  const openedAt = useRef(Date.now());

  const clock = useMemo(() => {
    const now = new Date();
    const h = now.getHours() % 12 || 12;
    const m = String(now.getMinutes()).padStart(2, "0");
    return { short: `${h}:${m}`, meridian: `${h}:${m}${now.getHours() < 12 ? "A" : "P"}` };
  }, [read]); // eslint-disable-line react-hooks/exhaustive-deps -- re-stamp when the sheet opens

  async function readText() {
    setBusy(true);
    setError(null);
    const t0 = Date.now();
    try {
      const { items } = await api.post<AnalyzeResponse>("/api/analyze/text", { text: text.trim() });
      if (!items.length) {
        setError("Couldn't find any food in that — try describing what you ate.");
        return;
      }
      setSlot(mealSlotFor());
      setRead({ items: items.map((it) => ({ ...it, orig: it })), readMs: Date.now() - t0 });
      setEditing(null);
    } catch {
      setError("The AI reader is unreachable right now — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  function update(index: number, patch: Partial<AnalyzedItem>) {
    setRead((r) =>
      r
        ? { ...r, items: r.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }
        : r,
    );
  }

  async function save() {
    if (!read) return;
    setSaving(true);
    setError(null);
    const edited = read.items.filter(isEdited);
    try {
      await api.post("/api/food-logs", {
        logged_on: localDay(),
        timezone: deviceTimezone(),
        meal_slot: slot,
        source: "text",
        items: read.items.map((it) => ({
          name: it.name,
          kcal: it.calories,
          protein_g: it.protein_g,
          carbs_g: it.carbs_g,
          fat_g: it.fat_g,
          confidence: it.confidence,
          edited: isEdited(it),
        })),
      });
      // the saved toast renders on Today (sketch stage 4): slot, kcal,
      // elapsed time as a first-class quality signal, and the edited count
      void navigate("/", {
        state: {
          logged: {
            slot,
            kcal: totals.kcal,
            ms: Date.now() - openedAt.current,
            edited: edited.length,
          },
        },
      });
    } catch {
      setError("Couldn't save — check your connection and try again.");
      setSaving(false);
    }
  }

  const totals = useMemo(() => {
    const items = read?.items ?? [];
    return {
      kcal: items.reduce((s, it) => s + it.calories, 0),
      p: Math.round(items.reduce((s, it) => s + it.protein_g, 0)),
      c: Math.round(items.reduce((s, it) => s + it.carbs_g, 0)),
      f: Math.round(items.reduce((s, it) => s + it.fat_g, 0)),
    };
  }, [read]);

  return (
    <main className="frame log-screen">
      <div className="log-top">
        <button className="cam-x" aria-label="Close" onClick={() => void navigate("/")}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <span className="eyebrow">
          <span className="tick" />
          Log
        </span>
        <span className="mono">{clock.meridian}</span>
      </div>

      <div className="modes" role="tablist" aria-label="Input mode">
        <span role="tab" aria-selected="false" title="Photo — coming in M3">
          PHOTO
        </span>
        <span role="tab" aria-selected="false" title="Barcode — coming in M3">
          BARCODE
        </span>
        <b role="tab" aria-selected="true">
          TEXT
        </b>
      </div>

      <section className="log-ask">
        <label className="eyebrow" htmlFor="describe">
          What did you eat?
        </label>
        <textarea
          id="describe"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="chipotle chicken bowl, no rice, extra beans"
          autoFocus
          rows={4}
        />
        <p className="log-hint">DESCRIBE IT — AI FILLS THE MACROS</p>
        <button
          className="btn btn-accent"
          disabled={busy || !text.trim()}
          onClick={() => void readText()}
        >
          {busy ? "Reading…" : "Read it"}
        </button>
        {error && !read && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {read && (
        <div
          className="sheet-wrap"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRead(null);
          }}
        >
          <div className="sheet" role="dialog" aria-label="Confirm what you ate">
            <div className="grab" aria-hidden="true" />
            <div className="sheet-head">
              {/* slot is derived from the clock and shown; tapping cycles it.
                  The sketch designs no picker control (#44), so the existing
                  chip doubles as the override — no new control invented. */}
              <button
                className="slot-btn"
                onClick={() => setSlot(SLOTS[(SLOTS.indexOf(slot) + 1) % SLOTS.length] ?? "snack")}
                aria-label={`Meal slot: ${slot}. Tap to change.`}
              >
                <span className="eyebrow">
                  <span className="tick" />
                  {label(slot)} · {clock.short}
                </span>
              </button>
              <span className="mono">READ IN {(read.readMs / 1000).toFixed(1)}S</span>
            </div>
            <p className="sheet-sub">Tap anything to change it before it saves.</p>

            {read.items.map((item, i) => (
              <ItemRow
                key={i}
                item={item}
                editing={editing === i}
                onToggle={() => setEditing(editing === i ? null : i)}
                onChange={(patch) => update(i, patch)}
              />
            ))}

            <div className="sheet-foot">
              <div className="totals">
                <span className="sum">
                  {fmtInt(totals.kcal)} <span>kcal</span>
                </span>
                <span className="mono">
                  {totals.p}P · {totals.c}C · {totals.f}F
                </span>
              </div>
              <button className="save" disabled={saving} onClick={() => void save()}>
                {saving ? "Logging…" : `Log ${fmtInt(totals.kcal)} kcal`}
              </button>
              {error && (
                <p className="signin-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ItemRow({
  item,
  editing,
  onToggle,
  onChange,
}: {
  item: EditableItem;
  editing: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<AnalyzedItem>) => void;
}) {
  // low confidence gets the sketch's CHECK treatment (accent badge + open row)
  const low = item.confidence !== null && item.confidence < 0.75;

  return (
    <div className={low || editing ? "item check" : "item"}>
      <button className="item-hit" onClick={onToggle} aria-expanded={editing}>
        <span className="name">
          {item.name}
          {low && <span className="badge">CHECK</span>}
        </span>
        <span className="portion">
          {low ? "BEST GUESS — TAP TO ADJUST" : `CONFIDENCE ${Math.round((item.confidence ?? 0) * 100)}%`}
        </span>
      </button>
      <span className="kcal">
        {fmtInt(item.calories)}
        <small>
          {Math.round(item.protein_g)}P · {Math.round(item.carbs_g)}C · {Math.round(item.fat_g)}F
        </small>
      </span>

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
          <div className="item-edit-nums">
            <NumField label="KCAL" value={item.calories} onChange={(calories) => onChange({ calories })} />
            <NumField label="PROTEIN" value={item.protein_g} onChange={(protein_g) => onChange({ protein_g })} />
            <NumField label="CARBS" value={item.carbs_g} onChange={(carbs_g) => onChange({ carbs_g })} />
            <NumField label="FAT" value={item.fat_g} onChange={(fat_g) => onChange({ fat_g })} />
          </div>
        </div>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
      />
    </label>
  );
}

function isEdited(item: EditableItem) {
  return (
    item.name !== item.orig.name ||
    item.calories !== item.orig.calories ||
    item.protein_g !== item.orig.protein_g ||
    item.carbs_g !== item.orig.carbs_g ||
    item.fat_g !== item.orig.fat_g
  );
}

/** "breakfast" → "Breakfast" */
function label(slot: MealSlot) {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}
