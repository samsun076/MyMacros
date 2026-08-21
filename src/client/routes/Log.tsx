import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AnalyzeResponse,
  AnalyzedItem,
  FavoritesResponse,
  FoodSource,
  MealSlot,
  RecentsResponse,
} from "../../shared/api";
import { CameraStage } from "../components/CameraStage";
import { LogModes, type LogMode } from "../components/LogModes";
import { NumericField } from "../components/NumericField";
import { Picks } from "../components/Picks";
import { ApiError, api, useApi } from "../lib/api";
import { releaseCamera } from "../lib/camera";
import { deviceTimezone, localDay, mealSlotFor } from "../lib/day";
import { fmtInt } from "../lib/format";
import { FOOD_LIMITS, type NumericRule, portionQtyRule } from "../lib/numeric";
import { type Pick, mergePicks } from "../lib/picks";
import { type EditableItem, editable, portionLabel, savedGrams, savedPortion, setPortionQty } from "../lib/portion";

/** The log flow: capture → editable confirm sheet → saved.
 *
 *  Chrome (top bar, modes row) and the sheet are ported from
 *  sketches/e-log-flow.html. M2 built the sheet, the save route and the toast
 *  input-agnostic on purpose (#10), so M3's photo path lights up the mode row
 *  in place rather than growing a second flow: both readers return the same
 *  `AnalyzeResponse` and hand it to the same sheet.
 *
 *  This screen owns the *photo* — the frozen frame and the request that
 *  persists and reads it — while CameraStage shows the viewfinder. The stage
 *  unmounts whenever TEXT is picked, so the still has to live out here to
 *  survive that. The camera *session* belongs to neither: it lives in
 *  `lib/camera.ts` for the length of one visit to this screen, and this screen
 *  ends it (#94). */

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
   *  repeated adjustments from drifting.
   *
   *  **Not the same `base` as `EditableItem.base` (#58)**, and the shared name
   *  is worth reading twice: this one is per *read* — one array of pristine
   *  per-100g figures for the whole barcode product — where an item's is per
   *  *row*, the as-read copy of that one food. Same technique at two scales,
   *  which is why they ended up with the same word; renaming this one would
   *  mean editing the shipped grams path to suit a new one. */
  grams?: number;
  base?: AnalyzedItem[];
  baseGrams?: number;
  /** #16: the read failed or found nothing, so the sheet opened on a blank row
   *  for the user to fill in. The photo is already stored — `photoKey` is set
   *  even here, which is the whole point of writing R2 before calling Claude. */
  manual?: string;
};

/** The sheet the failure path opens (#16). One empty row, the photo attached,
 *  and the save route unchanged — the recovery is the surface the happy path
 *  already uses, not a new screen. */
function manualRead(why: string, photoKey: string | undefined, ms: number): Read {
  const blank: AnalyzedItem = {
    name: "",
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    confidence: null,
  };
  return { items: [editable(blank)], readMs: ms, source: "photo", photoKey, manual: why };
}

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/** `/log#photo`, `/log#barcode`, `/log#text` and `/log#picks` name a stage so
 *  tools/shot-matrix.mjs can shoot each one deterministically, the way the
 *  frozen sketch addresses its own stages. Unlike `#confirm` these inject no
 *  demo data, so they aren't DEV-gated — `#picks` opens the panel over the
 *  live viewfinder and the rows in it are the signed-in user's real ones.
 *
 *  The default is PHOTO — the sketch's flow is "+ → straight to the
 *  viewfinder", and `#confirm` keeps landing on TEXT so M2's existing shot of
 *  the sheet is unchanged. */
function initialMode(): LogMode {
  switch (window.location.hash) {
    case "#text":
    case "#confirm":
    case "#portion":
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
 *  import.meta.env.DEV is a build-time literal — compiled out in prod.
 *
 *  `/log#portion` is the same sheet as a **barcode** read, which is the only
 *  shape that renders the portion row (#15). It had no stage until #95, and so
 *  no screenshot and no way to drive its field in a browser: the one control
 *  the bug report names by name was the one nothing could reach. Like
 *  `#confirm` it opens over the text screen rather than the live viewfinder —
 *  the sheet is the subject, and a stage that needs a camera isn't one. */
function demoRead(): Read | null {
  if (!import.meta.env.DEV) return null;
  if (window.location.hash === "#confirm") {
    // Portions are #58's subject, so the demo meal carries them — three items,
    // three different units, one of them fractional, so the control is
    // shootable and a drive can prove that scaling one leaves the other two
    // alone. The macro figures are the sketch's and are unchanged.
    const items: AnalyzedItem[] = [
      { name: "Grilled chicken breast", calories: 280, protein_g: 52, carbs_g: 0, fat_g: 6, confidence: 0.9, portion: { qty: 1, unit: "breast" } },
      { name: "Jasmine rice", calories: 210, protein_g: 4, carbs_g: 45, fat_g: 0, confidence: 0.6, portion: { qty: 1, unit: "cup" } },
      { name: "Steamed broccoli", calories: 55, protein_g: 4, carbs_g: 11, fat_g: 1, confidence: 0.85, portion: { qty: 1.5, unit: "cups" } },
    ];
    return { items: items.map(editable), readMs: 1800, source: "text" };
  }
  if (window.location.hash === "#portion") {
    // per-100g figures, the way OpenFoodFacts returns them, scaled to 150g
    const base: AnalyzedItem[] = [
      { name: "Greek yoghurt, 2%", calories: 97, protein_g: 9, carbs_g: 3.9, fat_g: 2.6, confidence: null },
    ];
    const items = base.map((it) => ({
      ...it,
      calories: Math.round(it.calories * 1.5),
      protein_g: round1(it.protein_g * 1.5),
      carbs_g: round1(it.carbs_g * 1.5),
      fat_g: round1(it.fat_g * 1.5),
    }));
    return {
      items: items.map(editable),
      readMs: 400,
      source: "barcode",
      barcode: "5000112637922",
      grams: 150,
      base,
      baseGrams: 100,
    };
  }
  return null;
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
  // #82's panel. PHOTO and BARCODE have no room for the list inline — the
  // viewfinder is the screen — so the deck button pulls it up over them.
  // `/log#picks` is the shootable stage; it injects nothing, it just opens.
  const [picksOpen, setPicksOpen] = useState(() => window.location.hash === "#picks");
  const openedAt = useRef(Date.now());
  const { data: favData, reload: reloadFavs } = useApi<FavoritesResponse>("/api/favorites");
  const { data: recentData } = useApi<RecentsResponse>("/api/food-logs/recent");

  // An object URL is a document-lifetime handle on the frame's bytes, so the
  // previous one is released whenever it's replaced and on the way out.
  useEffect(() => {
    if (!still) return;
    return () => URL.revokeObjectURL(still);
  }, [still]);

  // The camera goes out here and nowhere else (#94). Leaving the flow — the X,
  // a save, the tab bar — is the one moment nobody is about to point a phone at
  // a plate. Not on a freeze and not when CameraStage unmounts for TEXT: both
  // used to stop the tracks, and re-acquiring afterwards is a second
  // getUserMedia, which on iOS can be a second permission prompt for a grant
  // the user already gave. Deliberately *not* on `visibilitychange` either —
  // WebKit already suspends capture for a hidden page, so tearing down there
  // would buy nothing and cost a prompt on the way back.
  useEffect(() => releaseCamera, []);

  // favorites first (most-used), then recents that aren't already starred.
  // The join itself lives in lib/picks.ts and is tested there — this screen
  // renders it in two places now (#82) and neither may re-derive it.
  const picks = useMemo(
    () => mergePicks(favData?.favorites, recentData?.meals),
    [favData, recentData],
  );

  /** Escape closes the panel, the way it closes any dialog. The confirm sheet
   *  has no such key handler and doesn't grow one here: it is a *destructive*
   *  dismiss (the read is thrown away, #16's photo included) and giving that
   *  a keystroke is a separate decision from giving one to a list. */
  useEffect(() => {
    if (!picksOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicksOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picksOpen]);

  async function toggleStar(pick: Pick) {
    try {
      if (pick.favorite) await api.del(`/api/favorites/${pick.favorite.id}`);
      else await api.post("/api/favorites", pick.meal);
      reloadFavs();
    } catch {
      /* a failed star toggle is not worth an error state */
    }
  }

  /** #12's one tap: re-log at the slot the clock says it is right now. */
  async function relog(pick: Pick) {
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
      setRead({ items: items.map(editable), readMs: Date.now() - t0, source: "text" });
      setEditing(null);
    } catch (err) {
      // Text needs no manual-entry rescue: what the user typed is still in the
      // box, so retrying is one tap and nothing was lost (#16).
      setError(
        (err instanceof ApiError ? err.code : "") === "analyze_timeout"
          ? "That took too long to read — try again, or shorten the description."
          : "The AI reader is unreachable right now — try again in a moment.",
      );
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
      setSlot(mealSlotFor());
      if (!items.length) {
        // #16: no food found is a failure of the read, not of the user. The
        // photo is stored; open the sheet so it can still be logged.
        setRead(manualRead("No food found in that photo.", photo_key, Date.now() - t0));
        setEditing(0);
        return;
      }
      setRead({
        items: items.map(editable),
        readMs: Date.now() - t0,
        source: "photo",
        photoKey: photo_key,
      });
      setEditing(null);
    } catch (err) {
      // The photo survives an analysis failure by construction — the Worker
      // writes R2 before it calls Claude, so the key comes back on the error
      // body too, and the manual save path stays open (#13/#16).
      const detail = err instanceof ApiError ? (err.detail as { photo_key?: string } | null) : null;
      const code = err instanceof ApiError ? err.code : "network";
      setSlot(mealSlotFor());
      setRead(
        manualRead(
          code === "analyze_timeout"
            ? "The read took too long and was stopped."
            : code === "network"
              ? "Couldn't reach the reader."
              : "The reader couldn't handle that photo.",
          detail?.photo_key,
          Date.now() - t0,
        ),
      );
      setEditing(0);
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
        items: items.map(editable),
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
          return editable(scaled);
        }),
      };
    });
  }

  /** #58's control: rescale ONE item from its own as-read copy.
   *
   *  Deliberately not folded into `setGrams`. That field is per *read* and
   *  measured in grams for #15's reasons, it ships, and making the two
   *  symmetrical would mean refactoring a working path to suit a new one. They
   *  scale from different bases too — `r.base` is one array for the whole
   *  barcode read, `it.base` is per row — which is the actual difference
   *  between "how much of this product" and "how many of these four things". */
  function setItemQty(index: number, qty: number) {
    setRead((r) =>
      r ? { ...r, items: r.items.map((it, i) => (i === index ? setPortionQty(it, qty) : it)) } : r,
    );
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
    // #82: the panel is hidden rather than closed while a read is up, so
    // without this the sheet's backdrop tap would reveal it again.
    setPicksOpen(false);
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
    // `edited` answers "how good are the AI's estimates?", so a row the user
    // typed from scratch is not an edit — there was nothing to correct (#16).
    const manual = read.manual !== undefined;
    const edited = manual ? [] : read.items.filter(isEdited);
    // #107: a barcode read's portion is the HOW MUCH field, and it is one
    // number for the whole read — so it is resolved once, out here, rather
    // than per item inside the map. Every row of a barcode save gets the same
    // `portion_qty` because a barcode read is one product; see `savedGrams`.
    const readGrams = savedGrams(read);
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
          edited: !manual && isEdited(it),
          // #76: what the reader proposed, sent alongside what's being saved.
          // `orig` already exists — `isEdited` has always compared against it;
          // this stops it from being thrown away at save time, which is the
          // one moment those numbers can still be captured. Sent even when
          // nothing was edited, so the row distinguishes "the reader agreed"
          // from "we never recorded it". Withheld for #16's blank row: that
          // `orig` is a zero placeholder, not a read.
          ...(manual
            ? {}
            : {
                ai_kcal: it.orig.calories,
                ai_protein_g: it.orig.protein_g,
                ai_carbs_g: it.orig.carbs_g,
                ai_fat_g: it.orig.fat_g,
                // #104/#107: how much of it, and how much the reader said it
                // was. Same argument as the four above and the same window —
                // the portion lives in this sheet's memory and nowhere else
                // until the save. **Both functions read the as-read copy, not
                // `orig`**: a portion change deliberately moves `orig` (#58),
                // so after a rescale `orig` holds the *user's* number and
                // would record the reader as having said whatever the user
                // said. Withheld whole for a read that proposed no portion,
                // exactly as the `ai_*` set is withheld for #16's blank row.
                //
                // The barcode number wins where there is one, and the order is
                // stated rather than relied on: a barcode read's items carry
                // no per-item `portion` today, so in practice this chooses
                // between a value and a null — but the read-level grams is the
                // field the user was actually looking at, and if a reader ever
                // supplies both, that is the one the row should record.
                ...(readGrams ?? savedPortion(it)),
              }),
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
            <Picks
              picks={picks}
              saving={saving}
              onStar={(pick) => void toggleStar(pick)}
              onRelog={(pick) => void relog(pick)}
            />
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
          picksCount={picks.length}
          onPicks={() => setPicksOpen(true)}
        />
      )}

      {/* #82's panel: the same list, over the viewfinder. It is never rendered
          while a read is open — a barcode can decode while the panel is up,
          and two bottom sheets stacked is not a state worth designing — and
          `dismiss` closes it too, so throwing a read away lands you back on
          the camera rather than on a panel you had forgotten was open. The
          stream keeps running behind it; nothing here touches the camera. */}
      {picksOpen && !read && picks.length > 0 && (
        <div
          className="sheet-wrap"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPicksOpen(false);
          }}
        >
          <div className="sheet picks-sheet" role="dialog" aria-label="Favorites and recents">
            <div className="grab" aria-hidden="true" />
            <Picks
              picks={picks}
              saving={saving}
              onStar={(pick) => void toggleStar(pick)}
              onRelog={(pick) => void relog(pick)}
              className="picks in-sheet"
            />
          </div>
        </div>
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
              <span className="mono">
                {read.manual ? "COULDN'T READ IT" : `READ IN ${(read.readMs / 1000).toFixed(1)}S`}
              </span>
            </div>
            <p className="sheet-sub">
              {read.manual
                ? `${read.manual} Your photo is saved — type what you ate, or close this to retake.`
                : "Tap anything to change it before it saves."}
            </p>

            {/* Barcode reads land per-100g or per-package, so the portion is
                the one thing the database can't tell us (OpenFoodFacts leaves
                serving_size null even for Nutella). One field, scaling every
                number live — the sheet's own editing idiom, not a new screen. */}
            {read.grams !== undefined && (
              <div className="portion-row">
                <label className="eyebrow" htmlFor="grams">
                  How much
                </label>
                {/* `live` because that is this field's whole job: every number
                    on the sheet rescales as you type. What changed with #95 is
                    only that the *text* stops being rewritten under the cursor
                    — and that an out-of-range figure now clamps and says so,
                    where before it was silently discarded, which is
                    indistinguishable from a dead keyboard.

                    The ceiling came down from 5,000 g, which #95 inherited from
                    that discarding handler and kept so the fix stayed a fix.
                    5 kg was never a portion of anything; see FOOD_LIMITS. */}
                <NumericField id="grams" value={read.grams} onCommit={setGrams} live {...FOOD_LIMITS.grams} />
                <span className="mono">GRAMS</span>
              </div>
            )}

            {read.items.map((item, i) => (
              <ItemRow
                key={i}
                item={item}
                manual={read.manual !== undefined}
                editing={editing === i}
                onToggle={() => setEditing(editing === i ? null : i)}
                onChange={(patch) => update(i, patch)}
                onPortion={(qty) => setItemQty(i, qty)}
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
              {/* a blank row has nothing to save until it's named — the save
                  route rejects an empty name, so the button says so first */}
              <button
                className="save"
                disabled={saving || read.items.every((it) => !it.name.trim())}
                onClick={() => void save()}
              >
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
  manual,
  editing,
  onToggle,
  onChange,
  onPortion,
}: {
  item: EditableItem;
  /** #16's blank row — nothing read it, so there is nothing to report about it. */
  manual: boolean;
  editing: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<AnalyzedItem>) => void;
  /** #58. Never fires for a row the reader gave no portion — that row draws
   *  no control at all rather than one over an invented "1 serving". */
  onPortion: (qty: number) => void;
}) {
  // low confidence gets the sketch's CHECK treatment (accent badge + open row)
  const low = item.confidence !== null && item.confidence < 0.75;
  // null confidence means nothing estimated it — a barcode's exact match (#15)
  const exact = !manual && item.confidence === null;
  const portion = manual ? null : portionLabel(item.portion);
  // One id per rendered row, so the portion field's <label> points at its own
  // input and not at the row above it. `useId` rather than the map index: the
  // index is a render-order fact, and a11y wiring that depends on sibling
  // order is the kind that breaks silently when the sheet grows a sort.
  const qtyId = useId();

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
            {manual
              ? "TYPE WHAT YOU ATE"
              : exact
                ? "FROM THE BARCODE"
                : low
                  ? "BEST GUESS — TAP TO ADJUST"
                  : `CONFIDENCE ${Math.round((item.confidence ?? 0) * 100)}%`}
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
 *  times, silently, by having no ceiling to state. */
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
