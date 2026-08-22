import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type {
  AnalyzeResponse,
  AnalyzedItem,
  Favorite,
  FavoritesResponse,
  MealSlot,
  RecentsResponse,
} from "../../shared/api";
import { CameraStage } from "../components/CameraStage";
import { HeldBar } from "../components/HeldBar";
import { ItemRow } from "../components/ItemRow";
import { LogModes, type LogMode } from "../components/LogModes";
import { NumericField } from "../components/NumericField";
import { type Correction, PhotoCorrection } from "../components/PhotoCorrection";
import { Picks } from "../components/Picks";
import { SheetHandle } from "../components/SheetHandle";
import { StarGlyph } from "../components/StarGlyph";
import { ApiError, api, useApi } from "../lib/api";
import {
  type Capture,
  MAX_MEAL_ITEMS,
  basketItemCount,
  basketRows,
  correctable,
  needsDismissConfirm,
  reread,
  roomFor,
  roomForReread,
  sheetOpen,
  showsGrams,
} from "../lib/basket";
import { releaseCamera } from "../lib/camera";
import { deviceTimezone, localDay, mealSlotFor } from "../lib/day";
import { fmtInt } from "../lib/format";
import { FOOD_LIMITS } from "../lib/numeric";
import { type Pick, favoriteDraft, favoriteNamed, mergePicks, relogItem } from "../lib/picks";
import {
  type EditableItem,
  editable,
  isEdited,
  savedGrams,
  savedPortion,
  setPortionQty,
} from "../lib/portion";
import { useDragToDismiss } from "../lib/sheet-drag";

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

/** The sheet the failure path opens (#16). One empty row, the photo attached,
 *  and the save route unchanged — the recovery is the surface the happy path
 *  already uses, not a new screen. */
function manualRead(why: string, photoKey: string | undefined, ms: number, note: string): Capture {
  const blank: AnalyzedItem = {
    name: "",
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    confidence: null,
  };
  return { items: [editable(blank)], readMs: ms, source: "photo", photoKey, manual: why, note: note || undefined };
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
    case "#basket":
    case "#correct":
      return "text";
    case "#barcode":
      return "barcode";
    default:
      return "photo";
  }
}

/** A syntactically valid key that belongs to nobody (#59's stage).
 *
 *  `ownedPhotoKey` compares the prefix against the signed-in user's id, and
 *  this one never matches — which is deliberate rather than a shortcut. The
 *  stage's job is to render the correction UI at three widths, and the client
 *  has no way to *hold* a real R2 key at mount: the only honest one comes back
 *  from a read that needs a camera headless Chrome does not have. So "Read it
 *  again" here drives the **refusal** path — 404, the sentence, and #16's
 *  requirement that a failed re-read leaves every item and the photo where they
 *  were. That is the half a screenshot can check; the happy path needs a real
 *  photo and is driven for real instead. */
const DEMO_PHOTO_KEY = "demo-user/00000000-0000-4000-8000-000000000000.jpg";

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
 *  the sheet is the subject, and a stage that needs a camera isn't one.
 *
 *  `/log#basket` is #81's, and it is the issue's own lunch: a scanned chicken
 *  patty, a scanned bun, and a typed line that read as two foods. **Three
 *  captures, four items, two sources** — which is the state nothing else here
 *  can reach, because reaching it for real needs two barcodes in front of a
 *  camera headless Chrome does not have. It is also the tall case on purpose:
 *  four rows carry a per-row provenance line each, the footer grows a second
 *  control beside the save, and the head says how many captures are held, so
 *  what has to survive at 375 is the totals row and the save button under all
 *  of that (build rule 6). A stage that shot the two-item case would produce a
 *  PNG that looks like evidence and measures nothing, which is the objection
 *  `/#editing` already records.
 *
 *  **No photo capture in it, deliberately.** A `photo` capture with items and
 *  no `photoKey` is a shape no reader produces — the Worker writes R2 before it
 *  calls Claude — so faking one would put a state on screen the app cannot
 *  reach. The mixed-source save including a photographed row is covered where
 *  it can be honest, in `food-logs.route.test.ts`.
 *
 *  `/log#correct` is #59's, and it is the one stage that DOES carry a photo
 *  capture — it has to, because the affordance it draws exists only on one
 *  (`correctable`). Its `photoKey` is `DEMO_PHOTO_KEY` above, which is why the
 *  paragraph above still holds: the shape on screen is one a reader produces,
 *  and the key's own unreachability is the point rather than a compromise. */
function demoBasket(): Capture[] {
  if (!import.meta.env.DEV) return [];
  if (window.location.hash === "#correct") {
    // #59's own complaint, from 2026-08-07: a photo came back "ham and cheese"
    // when there was no ham in it. Two items rather than one because the note
    // is about *which* food is wrong, and a one-row sheet cannot show that a
    // correction is aimed at one row and not the other.
    const items: AnalyzedItem[] = [
      { name: "Ham and cheese toastie", calories: 430, protein_g: 22, carbs_g: 38, fat_g: 21, confidence: 0.55, portion: { qty: 1, unit: "toastie" } },
      { name: "Side salad", calories: 45, protein_g: 2, carbs_g: 6, fat_g: 1.5, confidence: 0.6, portion: { qty: 1, unit: "bowl" } },
    ];
    return [{ items: items.map(editable), readMs: 4300, source: "photo", photoKey: DEMO_PHOTO_KEY }];
  }
  if (window.location.hash === "#basket") {
    // The patty and the bun are barcode captures — each one product, each with
    // its own code — and the mustard was typed. Two of them carry `grams`, and
    // the sheet still draws no grams field, which is the retirement `showsGrams`
    // exists to make visible rather than silent.
    const patty: AnalyzedItem = {
      name: "Chicken breast patty",
      calories: 190, protein_g: 23, carbs_g: 9.5, fat_g: 7,
      confidence: null,
    };
    const bun: AnalyzedItem = {
      name: "Brioche burger bun",
      calories: 250, protein_g: 8, carbs_g: 42, fat_g: 5.5,
      confidence: null,
    };
    const typed: AnalyzedItem[] = [
      { name: "Yellow mustard", calories: 15, protein_g: 0.9, carbs_g: 1.4, fat_g: 0.6, confidence: 0.7, portion: { qty: 2, unit: "tsp" } },
      { name: "Dill pickle spears", calories: 12, protein_g: 0.5, carbs_g: 2.6, fat_g: 0.1, confidence: 0.55, portion: { qty: 3, unit: "spears" } },
    ];
    return [
      { items: [editable(patty)], readMs: 380, source: "barcode", barcode: "5000112637922", grams: 114, base: [patty], baseGrams: 114 },
      { items: [editable(bun)], readMs: 420, source: "barcode", barcode: "8712566341726", grams: 67, base: [bun], baseGrams: 67 },
      { items: typed.map(editable), readMs: 1600, source: "text" },
    ];
  }
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
    return [{ items: items.map(editable), readMs: 1800, source: "text" }];
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
    return [
      {
        items: items.map(editable),
        readMs: 400,
        source: "barcode",
        barcode: "5000112637922",
        grams: 150,
        base,
        baseGrams: 100,
      },
    ];
  }
  return [];
}

/** DEV-only: `/log#correct` opens with the form already up and a note typed
 *  into it, because the state worth measuring is the tall one — a textarea, a
 *  hint, and two controls under two item rows, at 375. A stage that shot the
 *  collapsed one-line button would produce a PNG that looks like evidence and
 *  measures nothing, which is the objection `/#editing` and `/log#basket`
 *  already record. */
function demoCorrection(): Correction | null {
  if (!import.meta.env.DEV || window.location.hash !== "#correct") return null;
  return { capture: 0, note: "there's no ham in it — just cheese", busy: false, error: null };
}

/** DEV-only: `/log#note` opens the **pre-capture** note field with a note
 *  already typed (#120) — PHOTO's viewfinder behind it, not `#correct`'s sheet.
 *
 *  **It fakes nothing about the keyboard, and that is the point.** The stage
 *  supplies the one thing a browser cannot be told to do — open the field —
 *  and the keyboard itself is fabricated *as an input*, by the tooling
 *  replacing `window.visualViewport` before any app script runs
 *  (`--keyboard` in shot-matrix and verify-viewport). So the lift on screen is
 *  the real `useKeyboardLift` reading a real measurement of a fake viewport,
 *  which is the same discipline `/trends#empty` follows in running the real
 *  `buildTrends` over fabricated inputs: fabricate what goes in, never what
 *  comes out. A stage that hardcoded the lift would render a screen the app
 *  cannot produce and call it evidence.
 *
 *  Without `--keyboard` it is still a legitimate screen — the note field open,
 *  keyboard down — which is exactly what every check in this repo saw before
 *  this issue, and exactly what it could not see the other half of. */
function demoNote(): string | null {
  if (!import.meta.env.DEV || window.location.hash !== "#note") return null;
  return "wife's plate, no ham";
}

export function Log() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<LogMode>(initialMode);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The basket: every capture that will become one meal (#81). One reading was
   *  a `Read | null` until this issue; it is now a list, and everything the
   *  sheet renders is derived from it rather than from a "current" read. */
  const [basket, setBasket] = useState<Capture[]>(demoBasket);
  /** The user tapped "Add another" and is back on the capture modes with the
   *  basket still held.
   *
   *  **Explicit state, and it may not be inferred from the basket.** The
   *  obvious shortcut is to clear the sheet by emptying the basket, which is
   *  what `read = null` used to mean — and that is exactly the bug this issue
   *  is about, one layer up: "no sheet" and "nothing held" would be the same
   *  value again, so the next capture would have nothing to append to and
   *  would replace. The two states are different and are stored as two things;
   *  `sheetOpen` is where they are combined, once. */
  const [adding, setAdding] = useState(false);
  /** A backdrop tap arrived on a basket holding more than one capture, so the
   *  sheet is asking before it throws three trips to the fridge away. Cleared
   *  by either answer, and by a successful append — see `needsDismissConfirm`
   *  for why this exists at all when #52 argues against confirmations. */
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  /** #59's correction, and it is **one** piece of state on purpose.
   *
   *  Which capture is being corrected, what is being said about it, whether
   *  the re-read is in flight and what came back if it failed are four facts
   *  about one thing — held apart they are four ways to end up with a spinner
   *  on a form that is closed, or an error about a capture that has been
   *  discarded. `null` is the whole answer to "is anybody correcting
   *  anything?", which is #112's rule about a condition and its dependencies
   *  being one statement rather than a list. */
  const [correction, setCorrection] = useState<Correction | null>(demoCorrection);
  /** The note that will accompany the NEXT photo (#59), or `null` for "no note
   *  field is open".
   *
   *  **One value, not a boolean beside a string.** The camera's note field is
   *  drawn when this is non-null, so there is no state where a note exists and
   *  nothing on screen says so — which is the trap the obvious two-value
   *  version has: type a note, switch to TEXT and back (the stage unmounts),
   *  and a collapsed field would silently attach it to the next photo. */
  const [note, setNote] = useState<string | null>(demoNote);
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

  /** Every food in the basket, flattened once and in capture order, each still
   *  carrying the capture it came from (#81). The sheet addresses rows by one
   *  flat index the way it always has — `editing`, `update(i, …)` — and a row's
   *  provenance travels with it rather than being looked up by position. */
  const rows = useMemo(() => basketRows(basket), [basket]);

  /** **The one boolean** (#112, #81). The sheet renders when this is true, the
   *  camera stage is told `reviewing` from it, and its scan loop is gated on
   *  the same value — so there is no second place for a condition to go
   *  missing from. `adding` is what separates it from "the basket has
   *  something in it", which is the state #81 adds and the state the scanner
   *  has to keep running through. */
  const open = sheetOpen({ basket, adding });
  const held = basketItemCount(basket);
  /** A re-read is in flight (#59). Read by the two footer controls and by the
     backdrop tap, so "the sheet is waiting for the reader" is one statement
     rather than three `correction?.busy` checks that can drift apart. */
  const rereading = correction?.busy === true;
  /** The capture the sheet's *whole-read* chrome speaks for: the read time,
   *  #16's "couldn't read it" line, #15's grams field. All three were
   *  properties of the one read a sheet used to hold; with a basket they are
   *  properties of the first capture, and each one says so at its own site
   *  rather than pretending the basket has a single answer. */
  const first = basket[0];

  /** #103: the one meal this basket would be starred as. `favoriteDraft` folds
   *  the sheet's rows with `foldMeals` — the same collapse the recents in the
   *  picks list come out of — and returns null when nothing on the sheet is
   *  named yet, which is #16's blank recovery row. It recomputes as the user
   *  types a name, so the star always describes what is on screen.
   *
   *  Across the *whole* basket since #81, which is right rather than merely
   *  convenient: what a star saves is the meal, the meal is every capture, and
   *  starring a patty-and-bun basket has to produce the favourite that re-logs
   *  both. */
  const draft = useMemo(() => favoriteDraft(rows.map((r) => r.item)), [rows]);

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
   *  it promised one nobody could make. */
  const closePicks = useCallback(() => setPicksOpen(false), []);
  const picksDrag = useDragToDismiss(closePicks);

  /** The confirm sheet's, which #102 deferred and #118 decided (see the
   *  handle's own comment for the argument).
   *
   *  **`dismiss`, hoisted, and never `discard`.** The distinction is the entire
   *  safety of this gesture: `dismiss` is the function the backdrop tap calls,
   *  so it carries #81's more-than-one-capture confirmation and #59's refusal
   *  while a re-read is in flight. `discard` is the destruction those two
   *  guards stand in front of, and it has exactly one caller — the
   *  confirmation's own button. Wiring a gesture to it would be handing the
   *  cheapest input in the app the one action in the app with no undo. */
  const confirmDrag = useDragToDismiss(dismiss);

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
        // Named fields, never a spread of `pick.meal` — a starred pick's meal
        // IS the `Favorite` row, and spreading it put `photo_key` on the wire,
        // which #81 made a *statement* rather than noise (#118). `relogItem`
        // owns that and is tested; this line cannot own it, because nothing
        // executes this file.
        items: [relogItem(pick)],
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
  }, [basket]); // eslint-disable-line react-hooks/exhaustive-deps -- re-stamp when the sheet opens

  /** Put a capture in the basket and bring the sheet back (#81).
   *
   *  **It appends, always, and that is one rule rather than two.** Appending
   *  onto an empty basket *is* replacing, so there is no "first capture or
   *  later capture?" branch here to get wrong — which matters because that
   *  branch is the bug this issue is about, in its original form: both
   *  non-photo readers called `setRead(...)` wholesale, so the patty was gone
   *  the moment the bun was scanned.
   *
   *  **The cap is enforced here as well as at the three call sites**, and the
   *  duplication is deliberate rather than defensive. Each reader refuses first
   *  because a refusal needs a *sentence*, and only the reader knows how many
   *  foods came back and what to say about them; this guard cannot speak, so it
   *  would be a silent discard if it ever fired alone. What it is, is the
   *  refusal that cannot be forgotten by a fourth reader added later, checked
   *  against the basket as it actually is rather than as a closure remembers
   *  it. If it ever does the work on its own, the symptom is a capture that
   *  vanishes without a word — so a fourth reader owes a sentence, not a guard.
   *
   *  `adding` goes false because a capture is the answer to "add another": the
   *  sheet is what comes back, with the new food at the bottom of it. */
  const stow = useCallback((capture: Capture) => {
    setBasket((b) => (roomFor(basketItemCount(b), capture.items.length) ? [...b, capture] : b));
    setAdding(false);
    setEditing(null);
    setConfirmDismiss(false);
    setCorrection(null);
  }, []);

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
      if (!roomFor(held, items.length)) {
        setError(overfull(held, items.length));
        return;
      }
      setSlot(mealSlotFor());
      stow({ items: items.map(editable), readMs: Date.now() - t0, source: "text" });
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
   *  user wondering whether the shutter fired.
   *
   *  **The note goes with it (#59), and it is spent the moment the shutter
   *  fires.** `PHOTO_SYSTEM` has said "trust the note over the picture" since
   *  #13 and nothing ever sent one — a prompt contract built and unreachable.
   *  A note before the capture ("wife's plate, no ham") prevents the bad read
   *  rather than repairing it, which is the cheaper half of this issue by a
   *  long way.
   *
   *  Cleared here rather than on success because a note describes *this*
   *  frame: keeping it would silently attach "wife's plate" to the next
   *  photograph, which is the failure the single `note` value is shaped to
   *  avoid. What that costs is retyping after a read the cap refuses — rare,
   *  and the alternative is a note nobody can see applying to a plate it was
   *  never about. */
  async function readPhoto(photo: Blob) {
    setStill(URL.createObjectURL(photo));
    setBusy(true);
    setError(null);
    const t0 = Date.now();
    const form = new FormData();
    form.append("photo", photo, "meal.jpg");
    const said = note?.trim() ?? "";
    if (said) form.append("note", said);
    setNote(null);
    try {
      const { items, photo_key } = await api.postForm<AnalyzeResponse>("/api/analyze/photo", form);
      // The one read that can overflow the cap in a single step: a plate can
      // come back as five foods, and only a photograph does that. Refused
      // whole rather than truncated — dropping foods off the end of a read to
      // make it fit is a silent edit of what the reader said, and the photo is
      // in R2 either way, so nothing is lost by logging what is held first.
      if (!roomFor(held, items.length)) {
        setError(overfull(held, items.length));
        setStill(null);
        return;
      }
      setSlot(mealSlotFor());
      if (!items.length) {
        // #16: no food found is a failure of the read, not of the user. The
        // photo is stored; open the sheet so it can still be logged.
        stow(manualRead("No food found in that photo.", photo_key, Date.now() - t0, said));
        setEditing(held);
        return;
      }
      stow({
        items: items.map(editable),
        readMs: Date.now() - t0,
        source: "photo",
        photoKey: photo_key,
        note: said || undefined,
      });
    } catch (err) {
      // The photo survives an analysis failure by construction — the Worker
      // writes R2 before it calls Claude, so the key comes back on the error
      // body too, and the manual save path stays open (#13/#16).
      const detail = err instanceof ApiError ? (err.detail as { photo_key?: string } | null) : null;
      const code = err instanceof ApiError ? err.code : "network";
      setSlot(mealSlotFor());
      stow(
        manualRead(
          code === "analyze_timeout"
            ? "The read took too long and was stopped."
            : code === "network"
              ? "Couldn't reach the reader."
              : "The reader couldn't handle that photo.",
          detail?.photo_key,
          Date.now() - t0,
          said,
        ),
      );
      // The blank row is the LAST one now, not the zeroth: a recovery row
      // appended to a basket opens on itself, not on whatever the first
      // capture put at index 0.
      setEditing(held);
    } finally {
      setBusy(false);
    }
  }

  /** Tell the reader it got the food wrong, and have it try again (#59).
   *
   *  **It re-reads the stored photo; it never re-uploads.** The key is on the
   *  capture, the bytes are in R2, and the Worker reads them back — which is
   *  why the client can do this at all from a sheet whose only copy of the
   *  frame is an object URL. Re-uploading would write a second R2 object per
   *  attempt and orphan the first, on the one path a frustrated user hits
   *  twice.
   *
   *  **The previous answer goes with the note, because a correction is a
   *  diff.** "No ham" has no antecedent on its own — the route folds the names
   *  back into the prompt so the model knows what it is being corrected about,
   *  and bounds them there (untrusted text reaching a prompt is bounded on the
   *  server, never on the client that sent it).
   *
   *  **Failure changes nothing on screen** (#16). No item is touched, the
   *  photo is untouched, and nobody is dropped into the blank manual row they
   *  had already escaped — the sentence lands inside the correction block and
   *  the sheet stays exactly where it was. That is also why every refusal here
   *  is a `setCorrection`, never a `setBasket`. */
  async function reanalyze(index: number) {
    const capture = basket[index];
    if (!capture?.photoKey || correction?.busy) return;
    const said = correction?.note.trim() ?? "";
    if (!said) return;

    setCorrection({ capture: index, note: said, busy: true, error: null });
    const t0 = Date.now();
    const form = new FormData();
    form.append("photo_key", capture.photoKey);
    form.append("note", said);
    // What the reader previously said about THIS capture, in its order. #16's
    // blank row contributes an empty string, which the route drops — so a
    // failed first read asks for a first read with a note on it, which is
    // exactly what it is.
    for (const it of capture.items) form.append("previous", it.name);

    const fail = (why: string) =>
      setCorrection((c) => (c ? { ...c, busy: false, error: why } : c));

    try {
      const { items } = await api.postForm<AnalyzeResponse>("/api/analyze/photo", form);
      if (!items.length) {
        fail("It read the photo again and still found no food in it. Your items are untouched.");
        return;
      }
      if (!roomForReread(basket, index, items.length)) {
        fail(
          `It came back with ${items.length} foods, which is more than one meal holds. Log what's here first.`,
        );
        return;
      }
      setBasket((b) => reread(b, index, items, Date.now() - t0, said));
      // The rows underneath have just been replaced, so an open editor is
      // pointing at a food that no longer exists at that index.
      setEditing(null);
      setCorrection(null);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "network";
      fail(
        code === "analyze_timeout"
          ? "That took too long to read again. Your items are untouched — try once more, or edit them by hand."
          : code === "photo_not_found"
            ? "That photo isn't available any more, so it can't be read again. Your items are untouched."
            : "The AI reader is unreachable right now. Your items are untouched — try again in a moment.",
      );
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
      if (!roomFor(held, items.length)) {
        setError(overfull(held, items.length));
        return;
      }
      setSlot(mealSlotFor());
      stow({
        items: items.map(editable),
        readMs: Date.now() - t0,
        source: "barcode",
        barcode,
        grams,
        base: items,
        baseGrams: grams,
      });
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
    // `held` and nothing else. This callback gates the scan loop, so every
    // value it closes over is a dependency of a camera effect (#94/#112) —
    // which is why the cap is asked as a *count* rather than handed the
    // basket. The count moves when a capture is stowed or thrown away, both of
    // which stop the loop anyway; the array moves on every keystroke in the
    // sheet, which would rebuild the loop while somebody is typing into it.
  }, [held, stow]);

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
   *  and `edited` exists to flag corrections.
   *
   *  **It edits capture 0 and is only ever drawn when there is exactly one**
   *  (`showsGrams`). The field is per *read* — one number for one product —
   *  so a basket holding two scanned products has nothing for it to mean, and
   *  it retires rather than silently applying to the first. See `showsGrams`
   *  for what that costs and why #58 forbids the tidier fix. */
  function setGrams(grams: number) {
    setBasket((b) => {
      const r = b[0];
      if (b.length !== 1 || !r?.base || !r.baseGrams) return b;
      const scale = grams / r.baseGrams;
      return [
        {
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
        },
      ];
    });
  }

  /** Change one food, wherever in the basket it sits (#81).
   *
   *  The sheet still addresses rows by a single flat index — `editing`,
   *  `update(i, …)`, `setItemQty(i, …)` — because that is the surface it had
   *  when a basket was one read, and re-indexing every handler by a pair would
   *  have been a rewrite of the sheet rather than of the navigation. `rows`
   *  holds the translation, in one place, derived from the basket. */
  function patchItem(flat: number, fn: (it: EditableItem) => EditableItem) {
    const row = rows[flat];
    if (!row) return;
    setBasket((b) =>
      b.map((c, ci) =>
        ci === row.capture
          ? { ...c, items: c.items.map((it, ii) => (ii === row.index ? fn(it) : it)) }
          : c,
      ),
    );
  }

  /** #58's control: rescale ONE item from its own as-read copy.
   *
   *  Deliberately not folded into `setGrams`. That field is per *read* and
   *  measured in grams for #15's reasons, it ships, and making the two
   *  symmetrical would mean refactoring a working path to suit a new one. They
   *  scale from different bases too — a capture's `base` is one array for the
   *  whole barcode read, `it.base` is per row — which is the actual difference
   *  between "how much of this product" and "how many of these four things". */
  function setItemQty(index: number, qty: number) {
    patchItem(index, (it) => setPortionQty(it, qty));
  }

  /** Photo mode: drop the frozen frame. Barcode mode: clear the failure that
   *  paused the scan loop, so it picks up again. */
  function retake() {
    setStill(null);
    setError(null);
  }

  /** Throw the whole basket away, and with it the frozen frame — the finder
   *  comes back live rather than stranding the user on a photo whose read they
   *  just threw away.
   *
   *  Split from `dismiss` by #81 so that the *guard* and the *destruction* are
   *  two functions: the confirmation's own button calls this one, and nothing
   *  else may. */
  function discard() {
    setBasket([]);
    setAdding(false);
    setConfirmDismiss(false);
    setCorrection(null);
    setNote(null);
    setStill(null);
    setError(null);
    // #82: the panel is hidden rather than closed while a read is up, so
    // without this the sheet's backdrop tap would reveal it again.
    setPicksOpen(false);
  }

  /** The backdrop tap. One capture goes straight out, exactly as it has since
   *  M2; more than one is asked about first — see `needsDismissConfirm` for why
   *  this is the one place in the app that gets a confirmation instead of an
   *  undo, and why the count is of captures rather than of foods. */
  function dismiss() {
    // A re-read is in flight (#59). A backdrop tap here would throw the basket
    // away *while the user is waiting for the thing they asked for*, which is
    // the one moment a stray tap is likeliest — the sheet has been sitting
    // still for five seconds. It is refused rather than confirmed: there is
    // nothing to decide, the request is about to land.
    if (rereading) return;
    if (needsDismissConfirm(basket)) {
      setConfirmDismiss(true);
      return;
    }
    discard();
  }

  /** #81's whole feature: keep the basket, go back to the capture modes.
   *
   *  The frozen frame goes because it is the *previous* capture's, and coming
   *  back to a still with a retake button on it is landing on a photo you have
   *  already read rather than on a viewfinder. #16's copy of it is safe: the
   *  photo is in R2 and its key is on the capture in the basket, which is
   *  precisely what is being kept. */
  function addAnother() {
    setAdding(true);
    setEditing(null);
    setConfirmDismiss(false);
    setCorrection(null);
    setStill(null);
    setError(null);
  }

  function update(index: number, patch: Partial<AnalyzedItem>) {
    patchItem(index, (it) => ({ ...it, ...patch }));
  }

  /** One save, whatever it took to build it (#81).
   *
   *  **One capture sends exactly the body it sent before this issue.** The
   *  per-item `source`/`photo_key`/`barcode` fields are added only when the
   *  basket holds more than one capture, so #76's `ai_*` set, #104's portion
   *  triple and #107's grams all cross the wire on the shipped path untouched
   *  — a deliberate narrowing of what this issue can break, and the reason the
   *  three-line conditional is worth more than the uniformity of always
   *  sending them.
   *
   *  **The body-level three come from the FIRST capture and the items say the
   *  rest.** The route reads each column off the item when the item names it
   *  and off the body when it does not, so the fallback is exercised by every
   *  single-capture save in the app. A basket's later captures state their own,
   *  including an explicit `null` where there is none — a hand-typed mustard
   *  inside a save whose body carries a photographed capture's key must not
   *  inherit it, because the photo does not show the mustard.
   *
   *  **`savedGrams` is resolved per CAPTURE, not per save.** It was one call
   *  out here when a save was one read (#107: one product, one number, every
   *  row scaled by it). A basket can hold two scanned products with different
   *  weights, and asking once would stamp the first product's grams onto the
   *  second one's row. The retired-field decision in `showsGrams` is about
   *  what can still be *adjusted*; what was already produced is real data and
   *  each capture keeps its own. */
  async function save() {
    if (!basket.length) return;
    setSaving(true);
    setError(null);
    const first = basket[0] as Capture;
    const mixed = basket.length > 1;
    // `edited` answers "how good are the AI's estimates?", so a row the user
    // typed from scratch is not an edit — there was nothing to correct (#16).
    // Per capture, because #16's blank recovery row can now sit in a basket
    // beside two rows that were genuinely read.
    const edited = basket.flatMap((c) => (c.manual !== undefined ? [] : c.items.filter(isEdited)));
    try {
      await api.post("/api/food-logs", {
        logged_on: localDay(),
        timezone: deviceTimezone(),
        meal_slot: slot,
        source: first.source,
        photo_key: first.photoKey,
        barcode: first.barcode,
        items: basket.flatMap((capture) => {
        const manual = capture.manual !== undefined;
        // #107: a barcode read's portion is the HOW MUCH field, and it is one
        // number for the whole read — so it is resolved once per capture,
        // rather than per item inside the map. Every row of a barcode capture
        // gets the same `portion_qty` because a barcode read is one product;
        // see `savedGrams`.
        const readGrams = savedGrams(capture);
        return capture.items.map((it) => ({
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
          // Where this food came from, stated per row for a basket and left to
          // the body for a single capture (#81). `?? null` rather than
          // omission: absent means "take the body's", and a typed row in a
          // photographed meal has to be able to say it has no photo of its own.
          ...(mixed
            ? {
                source: capture.source,
                photo_key: capture.photoKey ?? null,
                barcode: capture.barcode ?? null,
              }
            : {}),
        }));
        }),
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
    const items = rows.map((r) => r.item);
    return {
      kcal: items.reduce((s, it) => s + it.calories, 0),
      p: Math.round(items.reduce((s, it) => s + it.protein_g, 0)),
      c: Math.round(items.reduce((s, it) => s + it.carbs_g, 0)),
      f: Math.round(items.reduce((s, it) => s + it.fat_g, 0)),
    };
  }, [rows]);

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

          {held > 0 && !open && <HeldBar held={held} onReview={() => setAdding(false)} />}

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
            {error && !open && (
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
          error={open ? null : error}
          // #112: the sheet renders *over* this stage rather than replacing it,
          // so the stage has to be told a read is up. Without it the scan loop
          // went on decoding behind the sheet and every re-read rebuilt it,
          // discarding the grams the user had typed — a wipe that, since #107
          // stores that number, lands in the row as the reader's default.
          //
          // **`open`, not "the basket has something in it"** (#81). Those were
          // the same statement until this issue and are not any more: while the
          // user is adding a second food the basket is full of captures and the
          // scanner has to be *running*, which is the whole point of the tap
          // that got them here. It is `sheetOpen(...)` and nothing else — one
          // boolean, computed once, feeding the sheet's own render condition,
          // this prop and the loop's gate, so a condition cannot reach one of
          // the three and miss the others. The picks panel deliberately stays
          // out of the camera's effects (#94), and `still`/`busy` are about the
          // capture, not about what is on screen.
          reviewing={open}
          // What is held, over the viewfinder (#81). An invisible basket that a
          // stray tap destroys is the failure this issue names — and the way
          // back to the sheet must not be "capture something else", which is
          // the only way back a bare `adding` flag would leave.
          held={held}
          onReview={() => setAdding(false)}
          onCapture={(photo) => void readPhoto(photo)}
          onRetake={retake}
          onScan={onScan}
          note={note}
          onNote={setNote}
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
      {picksOpen && !open && picks.length > 0 && (
        <div className="sheet-wrap" {...picksDrag.backdrop}>
          <div
            className="sheet picks-sheet"
            role="dialog"
            aria-label="Favorites and recents"
            // Both halves of what a dragged sheet says inline now come from the
            // hook (#118). They were written out here while this was the only
            // sheet that dragged; with three, "identity at rest" and "no easing
            // under a finger" are one rule with three consumers — see
            // `dragStyle`, which is where the argument moved rather than being
            // deleted.
            style={picksDrag.style}
            {...picksDrag.handlers}
          >
            <SheetHandle />
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

      {open && first && (
        <div
          className={still ? "sheet-wrap over-photo" : "sheet-wrap"}
          {...confirmDrag.backdrop}
        >
          <div
            className="sheet"
            role="dialog"
            aria-label="Confirm what you ate"
            style={confirmDrag.style}
            {...confirmDrag.handlers}
          >
            {/* **The handle drags now, and it is `dismiss` — the backdrop's own
                function, not a copy of it** (#118).

                #102 left this bar decoration and stated the price: two sheets
                on one screen wearing the same bar where only one drags. Its
                objection was real — this dismiss is destructive where the
                picks panel's is not, and it throws away #16's photo's only
                handle on screen — and its condition was *"its own commit
                distance **or** its own undo"*.

                **#81 paid the second one.** More than one capture already opens
                a discard confirmation before anything is binned, and calling
                `dismiss` rather than `discard` is what puts the drag behind it:
                three trips to the fridge cannot be thrown away by a gesture any
                more than by a stray backdrop tap, and a single capture goes
                straight out exactly as it has since M2. `dismiss` also refuses
                outright while a re-read is in flight, which the drag inherits
                for free.

                So the drag adds no way to lose anything that a tap beside the
                sheet could not already reach — which is the argument, and it is
                also why no new commit distance was invented. That number is a
                share of this sheet's own rendered height (#114): measured at
                375x812, 396px on a single typed read and 585px on #81's
                four-item basket, which a fixed distance would have made half
                again as eager on the basket as on the read. (The *widest*
                range is the edit sheet's — 298 to 676 — which is why the same
                share serves both and neither needed a number of its own.) */}
            <SheetHandle />
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
                {/* What produced what is on this sheet. One capture keeps the
                    read time it has reported since M2 — a first-class quality
                    signal, and the number the toast repeats. Several captures
                    have several read times and no single one of them describes
                    the sheet, so the honest thing to say is how many there
                    are; it is also the count the dismiss guard is about, which
                    means the sentence in the confirmation is not the first
                    time the number is mentioned. */}
                <span className="mono">
                  {basket.length > 1
                    ? `${basket.length} CAPTURES`
                    : first.manual
                      ? "COULDN'T READ IT"
                      : `READ IN ${(first.readMs / 1000).toFixed(1)}S`}
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
            {/* **The guard, and it is the only confirmation in the app** —
                see `needsDismissConfirm` for why this one earns what #52
                argues against everywhere else: a basket lives in this screen's
                memory and nowhere else, so there is no row to restore and no
                undo to offer. It replaces the subtitle rather than stacking
                under it, because the sheet is asking one question and a page
                of editing instructions above the question is noise; and it is
                at the *top* so it cannot be scrolled past on a tall basket,
                which is exactly the basket this can fire on. */}
            {confirmDismiss ? (
              <div className="sheet-confirm" role="alertdialog" aria-label="Discard everything in this meal?">
                <p>
                  Throw away all {basket.length} captures? Nothing here is saved yet, and there is no
                  undo — {rows.length === 1 ? "the one food" : `all ${rows.length} foods`} would go.
                </p>
                <div className="sheet-confirm-acts">
                  <button type="button" className="btn btn-quiet" onClick={() => setConfirmDismiss(false)}>
                    Keep editing
                  </button>
                  <button type="button" className="btn-text danger" onClick={discard}>
                    Discard everything
                  </button>
                </div>
              </div>
            ) : (
              <p className="sheet-sub">
                {first.manual
                  ? `${first.manual} Your photo is saved — type what you ate, or close this to retake.`
                  : basket.length > 1
                    ? "Tap anything to change it. One save, one entry on Today."
                    : "Tap anything to change it before it saves."}
              </p>
            )}

            {/* Barcode reads land per-100g or per-package, so the portion is
                the one thing the database can't tell us (OpenFoodFacts leaves
                serving_size null even for Nutella). One field, scaling every
                number live — the sheet's own editing idiom, not a new screen. */}
            {showsGrams(basket) && first.grams !== undefined && (
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
                <NumericField id="grams" value={first.grams} onCommit={setGrams} live {...FOOD_LIMITS.grams} />
                <span className="mono">GRAMS</span>
              </div>
            )}

            {/* **The retirement, said rather than silently applied — and the
                number SHOWN rather than merely promised** (#81/#58).

                The grams field describes one product; a second capture leaves
                it with nothing to mean, so it goes, and a control that simply
                disappears is the dead-affordance complaint #95 was filed about
                with the button removed instead of disabled.

                **A frozen number that is shown is a documented limitation; a
                frozen number that is hidden is a trap**, and that distinction
                is not hypothetical here. Production holds a barcode row at
                155 g of a 55 g bar — 564 kcal, 22% of that day's intake —
                which is either a real portion or a slipped thumb, and the only
                way anybody can tell is by reading the number. So each retired
                amount is printed against the food it belongs to, read-only.
                Nothing is lost either: it is already in that capture's macros
                and goes to the `portion_qty`/`ai_portion_qty` columns
                `savedGrams` writes. What is gone is the ability to CHANGE it
                here, and the sentence says so. */}
            {basket.length > 1 && basket.some((c) => c.grams !== undefined) && (
              <div className="sheet-retired">
                <p className="opt-hint">
                  HOW MUCH describes one scanned product, so it steps aside here. These amounts are
                  saved as they stand — reopen the meal from Today to change one.
                </p>
                <ul>
                  {basket
                    .filter((c) => c.grams !== undefined)
                    .map((c, i) => (
                      <li key={i}>
                        <span>{c.items.map((it) => it.name).join(", ")}</span>
                        <span className="mono">{c.grams} G</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {rows.map(({ item, from, capture, index }, i) => (
              <Fragment key={`${i}`}>
                <ItemRow
                  item={item}
                  manual={from.manual !== undefined}
                  // Per row, not per sheet (#81). A basket mixes provenance by
                  // design, and FROM THE BARCODE has to sit on the row that was
                  // actually scanned — the same reason #60's edit sheet reads
                  // `source` off the stored row rather than off the entry.
                  source={from.source}
                  editing={editing === i}
                  onToggle={() => setEditing(editing === i ? null : i)}
                  onChange={(patch) => update(i, patch)}
                  onPortion={(qty) => setItemQty(i, qty)}
                />
                {/* #59, under the LAST row of each photo capture. The rows are
                    addressed by one flat index (#81) and this control is not —
                    it belongs to the capture, so it is drawn once per capture
                    rather than once per row, at the boundary `basketRows`
                    already knows about. Which captures get one is
                    `correctable`'s decision and not a condition spelled out
                    here: a barcode is a database lookup and a typed line is
                    already the person's own words, and neither has anything
                    for a note to overrule. */}
                {index === from.items.length - 1 && correctable(from) && (
                  <PhotoCorrection
                    manual={from.manual !== undefined}
                    sent={from.note}
                    state={correction?.capture === capture ? correction : null}
                    onOpen={() =>
                      setCorrection({ capture, note: "", busy: false, error: null })
                    }
                    onNote={(note) => setCorrection((c) => (c ? { ...c, note } : c))}
                    onCancel={() => setCorrection(null)}
                    onSubmit={() => void reanalyze(capture)}
                  />
                )}
              </Fragment>
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
              {/* **"Add another" sits beside the save, not above the rows**
                  (#81). Both are decisions about the whole basket, which is
                  what the footer is for, and the two together are the question
                  the sheet is actually asking after a capture: is this the
                  meal, or is there more of it? Put by the item list it would
                  read as "add a blank row", which is #60's control on a
                  different sheet and a different thing entirely — this one goes
                  back to the camera.

                  Rule 5's accent stays on the save. The add is `.btn-quiet`,
                  sized to its own text so the primary keeps the rest of the
                  row; at 375 with a five-figure total that is the tightest this
                  gets, which is what `/log#basket` exists to measure. */}
              <div className="sheet-acts">
                <button
                  type="button"
                  className="btn btn-quiet sheet-add-another"
                  // Both footer controls are held while a re-read is in flight
                  // (#59), and for the same reason rather than for symmetry:
                  // each would act on rows that are about to be replaced. Add
                  // another leaves the sheet with a request still running
                  // against it, and a save would write the numbers the user
                  // has just said are wrong.
                  disabled={saving || rereading || held >= MAX_MEAL_ITEMS}
                  onClick={addAnother}
                >
                  + Add another
                </button>
                {/* a blank row has nothing to save until it's named — the save
                    route rejects an empty name, so the button says so first */}
                <button
                  className="save"
                  disabled={saving || rereading || rows.every(({ item }) => !item.name.trim())}
                  onClick={() => void save()}
                >
                  {saving ? "Logging…" : `Log ${fmtInt(totals.kcal)} kcal`}
                </button>
              </div>
              {/* The cap, met as a rule rather than discovered as a 400 (#81).
                  `MAX_MEAL_ITEMS` is the client's one restatement of the save
                  route's `MAX_ITEMS`; the route refuses independently. Nothing
                  has ever reached it — see the note on the constant. */}
              {held >= MAX_MEAL_ITEMS && (
                <p className="opt-hint">
                  That's as many foods as one meal holds. Log these and start another.
                </p>
              )}
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

/** Why a read was refused rather than appended (#81). One sentence, naming
 *  both numbers, because "that didn't work" on a scan the user just made is
 *  indistinguishable from a broken scanner. */
function overfull(held: number, incoming: number) {
  return `That would put ${held + incoming} foods in one meal, and ${MAX_MEAL_ITEMS} is the most one save holds. Log what's here first.`;
}

/** "breakfast" → "Breakfast" */
function label(slot: MealSlot) {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
