import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AnalyzeResponse,
  AnalyzedItem,
  Favorite,
  FavoritesResponse,
  FoodSource,
  MealSlot,
  RecentsResponse,
} from "../../shared/api";
import { CameraStage } from "../components/CameraStage";
import { ItemRow } from "../components/ItemRow";
import { LogModes, type LogMode } from "../components/LogModes";
import { NumericField } from "../components/NumericField";
import { Picks } from "../components/Picks";
import { StarGlyph } from "../components/StarGlyph";
import { ApiError, api, useApi } from "../lib/api";
import { releaseCamera } from "../lib/camera";
import { deviceTimezone, localDay, mealSlotFor } from "../lib/day";
import { fmtInt } from "../lib/format";
import { FOOD_LIMITS } from "../lib/numeric";
import { type Pick, favoriteDraft, favoriteNamed, mergePicks } from "../lib/picks";
import { type EditableItem, editable, savedGrams, savedPortion, setPortionQty } from "../lib/portion";
import { SHEET_HANDLE_ATTR, useDragToDismiss } from "../lib/sheet-drag";

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
  const { data: recentData, reload: reloadRecents } = useApi<RecentsResponse>("/api/food-logs/recent");

  /** A star changes BOTH feeds, so a star re-reads both (#117).
   *
   *  It always moved a meal from the recents half to the favourites half; what
   *  it does now as well is free a slot for the next unstarred meal, because
   *  `GET /api/food-logs/recent` no longer spends one of its eight on a meal
   *  that is already listed above. Re-reading favourites alone would leave the
   *  panel one row shorter than what the server would send, until the screen
   *  was next mounted — the fix would be real and invisible on the surface it
   *  is about.
   *
   *  One statement, called from both stars: the picks row's and the confirm
   *  sheet's (#103). Nothing here is optimistic — the panel draws what the two
   *  routes say, and `mergePicks` is what covers the moment when the two
   *  answers are of different ages. */
  const reloadPicks = useCallback(() => {
    reloadFavs();
    reloadRecents();
  }, [reloadFavs, reloadRecents]);

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

  /** #103: the one meal this read would be starred as. `favoriteDraft` folds
   *  the sheet's rows with `foldMeals` — the same collapse the recents in the
   *  picks list come out of — and returns null when nothing on the sheet is
   *  named yet, which is #16's blank recovery row. It recomputes as the user
   *  types a name, so the star always describes what is on screen. */
  const draft = useMemo(() => favoriteDraft(read?.items ?? []), [read]);

  /** What the star has just been made to do, so it does not flicker back to
   *  its old state in the window between the write landing and
   *  `/api/favorites` being re-read. Keyed by the name it applies to: rename
   *  the meal and it stops applying, which is right — that is a different
   *  meal, and the list is the thing to ask about it. */
  const [starEdit, setStarEdit] = useState<{ name: string; favorite: Favorite | null } | null>(null);
  const [starring, setStarring] = useState(false);

  /** The favourite this read already has, or null. Free: `/api/favorites` is
   *  fetched for the picks list anyway, so the sheet can answer "already
   *  starred?" with no extra round trip. **It answers honestly and narrowly**
   *  — the match is exact, so it fires for a barcode read of a product that
   *  has been starred before (the fold is the product name, byte for byte) and
   *  usually will not for two photos of the same dinner, because the fold is
   *  whatever the model named the items this time. */
  const readFavorite =
    draft === null
      ? null
      : starEdit?.name === draft.name
        ? starEdit.favorite
        : favoriteNamed(favData?.favorites, draft.name);

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

  /** …and a downward drag closes it too (#102). Same reasoning one step over:
   *  the panel wears a grab handle, the handle promises a drag, and until this
   *  it promised one nobody could make. The confirm sheet below still doesn't
   *  honour its own — deliberately, see the comment on its `.grab`. */
  const closePicks = useCallback(() => setPicksOpen(false), []);
  const picksDrag = useDragToDismiss(closePicks);

  async function toggleStar(pick: Pick) {
    try {
      if (pick.favorite) await api.del(`/api/favorites/${pick.favorite.id}`);
      else await api.post("/api/favorites", pick.meal);
      reloadPicks();
    } catch {
      /* a failed star toggle is not worth an error state */
    }
  }

  /** The confirm sheet's star (#103).
   *
   *  **It fires now, not on save**, for three reasons and against one. Every
   *  other star in this app writes on tap; the sheet can be dismissed, and a
   *  control that quietly banks a decision for a save that may never happen is
   *  the dead-button complaint #95 was filed about; and firing now is what lets
   *  the same tap *unstar*, which is the undo an immediate write needs. What it
   *  costs is a favourite for a meal that was then thrown away — one row, in
   *  the one list of the app that has a delete control on every line.
   *
   *  **Nothing is optimistic.** The star fills when the write has landed, not
   *  when it was tapped: `starring` holds the control busy in between. A star
   *  that fills first and reverts on a failed request is a control that looked
   *  like it did something it hadn't.
   *
   *  A failure is spoken, unlike the picks list's silent `toggleStar` above —
   *  there, the row's own star is one of eight and the list is still standing;
   *  here it is the only star on the screen and going back to it costs the
   *  two-visit trip this issue exists to remove. */
  async function toggleReadStar() {
    if (!draft || starring) return;
    setStarring(true);
    setError(null);
    try {
      if (readFavorite) {
        await api.del(`/api/favorites/${readFavorite.id}`);
        setStarEdit({ name: draft.name, favorite: null });
      } else {
        setStarEdit({ name: draft.name, favorite: await api.post<Favorite>("/api/favorites", draft) });
      }
      reloadPicks();
    } catch {
      setError(
        readFavorite
          ? "Couldn't remove that from your favorites — check your connection."
          : "Couldn't save that to your favorites — check your connection.",
      );
    } finally {
      setStarring(false);
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
          // #112: the sheet renders *over* this stage rather than replacing it,
          // so the stage has to be told a read is up. Without it the scan loop
          // went on decoding behind the sheet and every re-read rebuilt it,
          // discarding the grams the user had typed — a wipe that, since #107
          // stores that number, lands in the row as the reader's default.
          // `read !== null` and nothing else: the picks panel deliberately
          // stays out of the camera's effects (#94), and `still`/`busy` are
          // about the capture, not about what is on screen.
          reviewing={read !== null}
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
          <div
            className="sheet picks-sheet"
            role="dialog"
            aria-label="Favorites and recents"
            style={{
              // Identity at rest, so a spring-back is a *removed* transform
              // rather than a `translate3d(0,0,0)` that reads the same and
              // isn't: the stylesheet's transition has nothing to ease from
              // if the property was never there.
              transform: picksDrag.state.offsetPx
                ? `translate3d(0,${picksDrag.state.offsetPx}px,0)`
                : undefined,
              // No easing while a finger is down, or the sheet lags behind it.
              transition: picksDrag.state.dragging ? "none" : undefined,
            }}
            {...picksDrag.handlers}
          >
            {/* The handle, and now a target rather than a picture of one
                (#102). `.grab` is 36 × 4; the band around it is 44px and
                `touch-action: none`, so a drag that starts here is this
                gesture's whatever the list is doing underneath. Still
                `aria-hidden`: Escape and the backdrop are the panel's
                non-pointer exits, and a decorative bar announcing itself
                would be a third one that doesn't exist. */}
            <div className="grab-band" aria-hidden="true" {...{ [SHEET_HANDLE_ATTR]: "" }}>
              <div className="grab" />
            </div>
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
            {/* **This handle stays, and it still doesn't drag** — #102's open
                question, answered here so it isn't answered twice.

                Removing it was the other legitimate answer and it loses on
                cost: the bar is also how a sheet says it is a sheet, it is in
                the frozen sketch this screen was ported from, and taking it
                out would restyle the app's most-photographed surface to fix an
                affordance nobody has complained about *here*. What was
                complained about is the picks panel, which now honours it.

                What the decision does cost is a real thing to say out loud:
                two sheets on one screen wear the same bar and only one of them
                drags. The reason they are not the same gesture is that they
                are not the same action — `dismiss()` throws the read away and
                with it #16's photo, already in R2, whose only handle on screen
                is this sheet. A cheap gesture for an expensive action needs its
                own commit distance or its own undo, and #102 is explicit that
                the decision is not its. Until someone makes it, the honest
                position is that this bar is decoration and is documented as
                decoration. */}
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
              {/* The star sits with the read's own facts rather than beside
                  the save (#103). Two reasons it is here and not in
                  `.sheet-foot`: this row is already where the sheet makes
                  claims about the *whole* read — which meal it is, how long it
                  took — and the star is exactly that kind of claim, where the
                  rows below it are claims about one food each; and the one
                  thing the control must not be is a second button competing
                  with `Log N kcal`, which this puts at the opposite corner of
                  the sheet, unfilled, at a sixth of the size. Rule 5's accent
                  is still spent on the save; the star borrows it only as the
                  16px mark that means "starred", the same mark and the same
                  two tokens the picks list has used since #12. */}
              <span className="sheet-head-end">
                <span className="mono">
                  {read.manual ? "COULDN'T READ IT" : `READ IN ${(read.readMs / 1000).toFixed(1)}S`}
                </span>
                {/* Disabled until something on the sheet has a name — #16's
                    recovery sheet opens blank, and a favourite called ", " is
                    the junk this must not be able to write. `favoriteDraft`
                    refuses the same case independently, so the guard is
                    structural rather than a rule about when to draw a
                    button. */}
                <button
                  className={readFavorite ? "sheet-star star-mark on" : "sheet-star star-mark"}
                  aria-pressed={readFavorite !== null}
                  aria-busy={starring}
                  disabled={!draft || starring}
                  aria-label={
                    !draft
                      ? "Star this meal — name it first"
                      : readFavorite
                        ? `Unstar ${draft.name}`
                        : `Star ${draft.name}`
                  }
                  onClick={() => void toggleReadStar()}
                >
                  <StarGlyph />
                </button>
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
                source={read.source}
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
