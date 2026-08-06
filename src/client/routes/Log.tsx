import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AnalyzeResponse,
  AnalyzedItem,
  Favorite,
  FavoritesResponse,
  FoodSource,
  MealSlot,
  RecentMeal,
  RecentsResponse,
} from "../../shared/api";
import { CameraStage } from "../components/CameraStage";
import { LogModes, type LogMode } from "../components/LogModes";
import { ApiError, api, useApi } from "../lib/api";
import { deviceTimezone, localDay, mealSlotFor } from "../lib/day";
import { fmtInt } from "../lib/format";

/** The log flow: capture → editable confirm sheet → saved.
 *
 *  Chrome (top bar, modes row) and the sheet are ported from
 *  sketches/e-log-flow.html. M2 built the sheet, the save route and the toast
 *  input-agnostic on purpose (#10), so M3's photo path lights up the mode row
 *  in place rather than growing a second flow: both readers return the same
 *  `AnalyzeResponse` and hand it to the same sheet.
 *
 *  This screen owns the *photo* — the frozen frame and the request that
 *  persists and reads it — while CameraStage owns the camera. The stage tears
 *  its stream down the moment a frame is taken, so the still has to live out
 *  here to survive that. BARCODE stays parked until #15. */

type EditableItem = AnalyzedItem & { orig: AnalyzedItem };

/** One reading, whatever produced it. `source`, `photoKey` and `barcode` are
 *  the only things the sheet carries forward about which mode it came from. */
type Read = {
  items: EditableItem[];
  readMs: number;
  source: FoodSource;
  photoKey?: string;
  barcode?: string;
  /** Barcode reads only (#15): the grams the numbers are scaled to, plus the
   *  pristine figures at `baseGrams` that the grams field rescales from.
   *  Rescaling from the base rather than from the current values is what keeps
   *  repeated adjustments from drifting. */
  grams?: number;
  base?: AnalyzedItem[];
  baseGrams?: number;
};

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** `/log#photo`, `/log#barcode` and `/log#text` name a mode so
 *  tools/shot-matrix.mjs can shoot each stage deterministically, the way the
 *  frozen sketch addresses its own stages. Unlike `#confirm` these inject no
 *  demo data, so they aren't DEV-gated.
 *
 *  The default is PHOTO — the sketch's flow is "+ → straight to the
 *  viewfinder", and `#confirm` keeps landing on TEXT so M2's existing shot of
 *  the sheet is unchanged. */
function initialMode(): LogMode {
  switch (window.location.hash) {
    case "#text":
    case "#confirm":
      return "text";
    case "#barcode":
      return "barcode";
    default:
      return "photo";
  }
}

/** DEV-only: `/log#confirm` opens the sheet pre-filled with the sketch's
 *  demo meal, mirroring e-log-flow.html's hash-navigable stages so
 *  tools/shot-matrix.mjs can shoot the sheet without a Claude round trip.
 *  import.meta.env.DEV is a build-time literal — compiled out in prod. */
function demoRead(): Read | null {
  if (!import.meta.env.DEV || window.location.hash !== "#confirm") return null;
  const items: AnalyzedItem[] = [
    { name: "Grilled chicken breast", calories: 280, protein_g: 52, carbs_g: 0, fat_g: 6, confidence: 0.9 },
    { name: "Jasmine rice", calories: 210, protein_g: 4, carbs_g: 45, fat_g: 0, confidence: 0.6 },
    { name: "Steamed broccoli", calories: 55, protein_g: 4, carbs_g: 11, fat_g: 1, confidence: 0.85 },
  ];
  return { items: items.map((it) => ({ ...it, orig: it })), readMs: 1800, source: "text" };
}

export function Log() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LogMode>(initialMode);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Read | null>(demoRead);
  const [still, setStill] = useState<string | null>(null);
  const [slot, setSlot] = useState<MealSlot>(() => mealSlotFor());
  const [editing, setEditing] = useState<number | null>(null);
  const openedAt = useRef(Date.now());
  const { data: favData, reload: reloadFavs } = useApi<FavoritesResponse>("/api/favorites");
  const { data: recentData } = useApi<RecentsResponse>("/api/food-logs/recent");

  // An object URL is a document-lifetime handle on the frame's bytes, so the
  // previous one is released whenever it's replaced and on the way out.
  useEffect(() => {
    if (!still) return;
    return () => URL.revokeObjectURL(still);
  }, [still]);

  // favorites first (most-used), then recents that aren't already starred
  const picks = useMemo(() => {
    const favs = (favData?.favorites ?? []).map((f) => ({ meal: f as RecentMeal, favorite: f as Favorite | null }));
    const starred = new Set(favs.map((p) => p.meal.name.toLowerCase()));
    const recents = (recentData?.meals ?? [])
      .filter((m) => !starred.has(m.name.toLowerCase()))
      .map((meal) => ({ meal, favorite: null as Favorite | null }));
    return [...favs, ...recents].slice(0, 8);
  }, [favData, recentData]);

  async function toggleStar(pick: { meal: RecentMeal; favorite: Favorite | null }) {
    try {
      if (pick.favorite) await api.del(`/api/favorites/${pick.favorite.id}`);
      else await api.post("/api/favorites", pick.meal);
      reloadFavs();
    } catch {
      /* a failed star toggle is not worth an error state */
    }
  }

  /** #12's one tap: re-log at the slot the clock says it is right now. */
  async function relog(pick: { meal: RecentMeal; favorite: Favorite | null }) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/food-logs", {
        logged_on: localDay(),
        timezone: deviceTimezone(),
        meal_slot: mealSlotFor(),
        source: "favorite",
        favorite_id: pick.favorite?.id,
        items: [{ ...pick.meal, confidence: null, edited: false }],
      });
      void navigate("/", {
        state: {
          logged: {
            slot: mealSlotFor(),
            kcal: pick.meal.kcal,
            ms: Date.now() - openedAt.current,
            edited: 0,
          },
        },
      });
    } catch {
      setError("Couldn't log that — check your connection and try again.");
      setSaving(false);
    }
  }

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
      setRead({ items: items.map((it) => ({ ...it, orig: it })), readMs: Date.now() - t0, source: "text" });
      setEditing(null);
    } catch {
      setError("The AI reader is unreachable right now — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  /** One POST carries the photo (settled on #13): the Worker writes R2 first,
   *  then reads the bytes it already holds. The frame is frozen on screen
   *  before the request goes out, so a slow or failed read never leaves the
   *  user wondering whether the shutter fired. */
  async function readPhoto(photo: Blob) {
    setStill(URL.createObjectURL(photo));
    setBusy(true);
    setError(null);
    const t0 = Date.now();
    const form = new FormData();
    form.append("photo", photo, "meal.jpg");
    try {
      const { items, photo_key } = await api.postForm<AnalyzeResponse>("/api/analyze/photo", form);
      if (!items.length) {
        setError("Couldn't read any food in that photo — retake it, or switch to TEXT.");
        return;
      }
      setSlot(mealSlotFor());
      setRead({
        items: items.map((it) => ({ ...it, orig: it })),
        readMs: Date.now() - t0,
        source: "photo",
        photoKey: photo_key,
      });
      setEditing(null);
    } catch {
      setError("The AI reader is unreachable right now — retake the photo, or switch to TEXT.");
    } finally {
      setBusy(false);
    }
  }

  /** A decoded barcode (#15). No model runs and nothing is stored, so this is
   *  the cheapest and most exact of the three readers — the confirm sheet it
   *  fills is the same one. Memoised because it gates CameraStage's scan loop.
   */
  const readBarcode = useCallback(async (code: string) => {
    setBusy(true);
    setError(null);
    const t0 = Date.now();
    try {
      const { items, barcode, grams } = await api.get<AnalyzeResponse>(`/api/barcode/${code}`);
      if (!items.length) {
        setError("That product is listed, but without any nutrition information.");
        return;
      }
      setSlot(mealSlotFor());
      setRead({
        items: items.map((it) => ({ ...it, orig: it })),
        readMs: Date.now() - t0,
        source: "barcode",
        barcode,
        grams,
        base: items,
        baseGrams: grams,
      });
      setEditing(null);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "network";
      setError(
        code === "product_not_found"
          ? "That barcode isn't in the food database."
          : code === "no_nutrition"
            ? "That product is listed, but without any nutrition information."
            : "Couldn't reach the food database right now.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // stable identity: CameraStage's scan loop keys its effect on this, so a
  // fresh closure per render would tear the loop down and rebuild it each time
  const onScan = useCallback(
    (code: string) => {
      void readBarcode(code);
    },
    [readBarcode],
  );

  /** The grams field rescales every number linearly from the pristine base.
   *  `orig` moves with it: changing the portion is not correcting the read,
   *  and `edited` exists to flag corrections. */
  function setGrams(grams: number) {
    setRead((r) => {
      if (!r?.base || !r.baseGrams) return r;
      const scale = grams / r.baseGrams;
      return {
        ...r,
        grams,
        items: r.base.map((it) => {
          const scaled: AnalyzedItem = {
            ...it,
            calories: Math.round(it.calories * scale),
            protein_g: round1(it.protein_g * scale),
            carbs_g: round1(it.carbs_g * scale),
            fat_g: round1(it.fat_g * scale),
          };
          return { ...scaled, orig: scaled };
        }),
      };
    });
  }

  /** Photo mode: drop the frozen frame. Barcode mode: clear the failure that
   *  paused the scan loop, so it picks up again. */
  function retake() {
    setStill(null);
    setError(null);
  }

  /** Dismissing the sheet discards the read, and with it the frozen frame —
   *  the finder comes back live rather than stranding the user on a photo
   *  whose read they just threw away. */
  function dismiss() {
    setRead(null);
    setStill(null);
    setError(null);
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
        source: read.source,
        photo_key: read.photoKey,
        barcode: read.barcode,
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
    <>
      {mode === "text" ? (
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

          <LogModes mode={mode} onMode={setMode} barcodeReady={false} />

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

          {picks.length > 0 && (
            <section className="picks">
              <div className="sec-head">
                <span className="eyebrow">One tap</span>
                <span className="mono">LOGS AS {mealSlotFor().toUpperCase()}</span>
              </div>
              {picks.map((pick) => (
                <div className="pick" key={pick.favorite?.id ?? pick.meal.name}>
                  <button
                    className={pick.favorite ? "pick-star on" : "pick-star"}
                    aria-pressed={pick.favorite !== null}
                    aria-label={pick.favorite ? `Unstar ${pick.meal.name}` : `Star ${pick.meal.name}`}
                    onClick={() => void toggleStar(pick)}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" strokeWidth="1.4" strokeLinejoin="round">
                      <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3.1-3 4.3-.6z" />
                    </svg>
                  </button>
                  <button className="pick-main" disabled={saving} onClick={() => void relog(pick)}>
                    <span className="pick-name">{pick.meal.name}</span>
                    <span className="macros-mini">
                      {Math.round(pick.meal.protein_g)}P · {Math.round(pick.meal.carbs_g)}C ·{" "}
                      {Math.round(pick.meal.fat_g)}F
                    </span>
                  </button>
                  <span className="pick-kcal">
                    {fmtInt(pick.meal.kcal)}
                    <small>kcal</small>
                  </span>
                </div>
              ))}
            </section>
          )}
        </main>
      ) : (
        <CameraStage
          mode={mode}
          onMode={setMode}
          onClose={() => void navigate("/")}
          clock={clock.meridian}
          still={still}
          busy={busy}
          error={read ? null : error}
          onCapture={(photo) => void readPhoto(photo)}
          onRetake={retake}
          onScan={onScan}
        />
      )}

      {read && (
        <div
          className={still ? "sheet-wrap over-photo" : "sheet-wrap"}
          onClick={(e) => {
            if (e.target === e.currentTarget) dismiss();
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

            {/* Barcode reads land per-100g or per-package, so the portion is
                the one thing the database can't tell us (OpenFoodFacts leaves
                serving_size null even for Nutella). One field, scaling every
                number live — the sheet's own editing idiom, not a new screen. */}
            {read.grams !== undefined && (
              <div className="portion-row">
                <label className="eyebrow" htmlFor="grams">
                  How much
                </label>
                <input
                  id="grams"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={5000}
                  value={read.grams}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 1 && n <= 5000) setGrams(Math.round(n));
                  }}
                />
                <span className="mono">GRAMS</span>
              </div>
            )}

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
    </>
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
  // null confidence means nothing estimated it — a barcode's exact match (#15)
  const exact = item.confidence === null;

  return (
    <div className={low || editing ? "item check" : "item"}>
      <button className="item-hit" onClick={onToggle} aria-expanded={editing}>
        <span className="name">
          {item.name}
          {low && <span className="badge">CHECK</span>}
        </span>
        <span className="portion">
          {exact
            ? "FROM THE BARCODE"
            : low
              ? "BEST GUESS — TAP TO ADJUST"
              : `CONFIDENCE ${Math.round((item.confidence ?? 0) * 100)}%`}
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

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
