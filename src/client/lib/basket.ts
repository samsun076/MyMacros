import type { AnalyzedItem, FoodSource } from "../../shared/api";
import { type EditableItem, editable } from "./portion";

/** One meal built out of several captures (#81).
 *
 *  The complaint: scan a chicken patty, scan its bun, and you get **two**
 *  timeline entries, because both non-photo readers called `setRead(...)`
 *  wholesale and the previous read was gone. The mustard never got logged at
 *  all, because typing it would have been a third entry.
 *
 *  **Almost nothing had to be built for this.** The confirm sheet has rendered
 *  `items.map(...)` since M2, `POST /api/food-logs` stamps every row of a save
 *  with one `logged_at` instant, and `foldMeals` folds rows sharing that
 *  instant back into one timeline entry — the photo path, where one photograph
 *  returns three foods, is the existence proof for all three. What was missing
 *  was the *navigation*: a way back to the capture modes that appends instead
 *  of replacing.
 *
 *  **So a basket is a list of CAPTURES, not a list of items**, and that shape
 *  is load-bearing three times over. A capture carries the provenance of the
 *  read that produced it — `source`, `photoKey`, `barcode`, and #15's per-read
 *  grams basis — and those are per *row* in `food_logs` precisely so a basket
 *  can mix them; flattening to one item list at capture time would throw away
 *  the only copy. It is also what "how many captures" counts, which is the
 *  question the dismiss guard asks (a single photo returning three foods is
 *  ONE capture and must keep the dismiss it ships with today). And it is what
 *  makes #15's grams field answerable: one field describing one product cannot
 *  describe two, so it is drawn only while there is exactly one capture.
 *
 *  **Here rather than inside `Log.tsx`** for #100's reason, which this screen
 *  has now paid twice: behaviour reachable only by rendering a component is
 *  behaviour the unit project cannot test, and the rules below are all
 *  invisible to a screenshot — an append that silently replaces, a cap that
 *  never binds, a dismiss guard that fires on the wrong count. */

/** One reading, whatever produced it — the shape that was `Read` inside
 *  `Log.tsx` until #81 needed a list of them.
 *
 *  `source`, `photoKey` and `barcode` are what the sheet carries forward about
 *  which mode a capture came from, and since #81 they are carried **per
 *  capture** all the way onto the wire: a basket holding a scan, a photo and a
 *  typed line writes three rows with three different `source` values, which is
 *  better data than one save could hold before and is what #75's per-source
 *  analysis reads. */
export type Capture = {
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
   *  is worth reading twice: this one is per *capture* — one array of pristine
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
  /** What the person told the reader when they last corrected it (#59), shown
   *  back to them under the rows it produced.
   *
   *  **It exists because a re-read that changes nothing is indistinguishable
   *  from a dead button.** The model can hold its answer — "no ham" on a photo
   *  that really does contain ham comes back the same — and with the note
   *  cleared and the rows unchanged, the user has no evidence anything
   *  happened. Echoing the note is what separates "it heard you and disagreed"
   *  from "the button did nothing".
   *
   *  Client-side only, and does not cross the wire: `food_logs` has no column
   *  for it, adding one is a migration this issue does not need, and the note's
   *  *effect* is already recorded — it is the numbers in the row. */
  note?: string;
};

/** How many foods one meal may hold.
 *
 *  **Restated from `MAX_ITEMS` in `src/worker/routes/food-logs.ts`, which owns
 *  it for the wire** (#86's house pattern for a bound the client also has to
 *  draw — the same shape as `FOOD_LIMITS` restating `energy()`'s ceilings).
 *  The copy is tolerable for the usual reason: the route refuses independently,
 *  so the worst a drifted copy does is show a control that 400s, never write a
 *  row nobody meant. `food-logs.route.test.ts` pins the server's.
 *
 *  It is stated **once** on this side rather than once per sheet. #60's edit
 *  sheet had the first client copy and #81 would have been the second, on a
 *  screen whose whole subject is growing an item list — two copies of a cap
 *  that only ever binds in the UI is the register's defect with nothing to
 *  catch it, because neither copy has ever been reached.
 *
 *  **Nothing has ever reached it, and #81 did not re-derive it either — say so
 *  rather than let the carry read as consideration.** #60 flagged the same
 *  bound and the flag is now two issues old. What #81 adds is worse news about
 *  it: 20 was never the number that bound anything, because a *lower* one sat
 *  four rows down and nobody knew. D1 takes 100 bound parameters per statement
 *  and a `food_logs` row is 22 columns, so the real ceiling was **four foods**
 *  — measured, 1–4 returned 201 and 5–20 returned 500 — and production's
 *  largest meal is four, one food short of firing, on a path that needs no
 *  basket at all. `insertChunks` fixes that, which means 20 is only NOW the
 *  operative bound for the first time since #10.
 *
 *  So its honest standing: it is a literal inherited from `routes/food-logs.ts`
 *  with a plausible sentence attached ("a plate does not have twenty distinct
 *  foods on it") and no measurement behind it. It is not obviously wrong — 20
 *  foods is five round trips and a sheet nobody can read on a phone — and it is
 *  not derived. If it is ever re-examined, the thing to measure is what a real
 *  basket costs, not what a plate looks like. Meanwhile the *reason* is drawn
 *  on screen beside the disabled control, so a user who does reach it meets a
 *  rule instead of discovering a 400. */
export const MAX_MEAL_ITEMS = 20;

/** Every food in the basket, in capture order, each still knowing which
 *  capture it came from.
 *
 *  The sheet addresses rows by a single flat index — one `editing`, one
 *  `update(i, patch)` — because that is what it did when a basket was one
 *  read, and re-indexing the sheet by a pair would have been a rewrite of the
 *  surface rather than of the navigation. `capture` rides along so a row can
 *  still answer what read produced it, which is what `ItemRow`'s `source` and
 *  `manual` props are and what the save writes per row. */
export function basketRows(
  basket: readonly Capture[],
): { capture: number; index: number; item: EditableItem; from: Capture }[] {
  return basket.flatMap((from, capture) =>
    from.items.map((item, index) => ({ capture, index, item, from })),
  );
}

/** How many foods the basket holds — the number the cap bounds and the number
 *  the capture screen shows. Deliberately NOT the number the dismiss guard
 *  reads; see `needsDismissConfirm`. */
export function basketItemCount(basket: readonly Capture[]): number {
  return basket.reduce((n, c) => n + c.items.length, 0);
}

/** Whether a capture of `incoming` foods still fits on top of `held`.
 *
 *  Asked *before* the append rather than after, because a read that would
 *  overflow has to be refused with a sentence — the alternative is appending it
 *  and letting the save come back 400, which is the discovery this cap exists
 *  to prevent. A photograph returning five foods onto a basket of eighteen is
 *  the only shape that can overflow in one step: "Add another" is disabled at
 *  the cap, so a second capture is unreachable once the basket is full, and a
 *  barcode read is one product and therefore one food.
 *
 *  **It takes a count rather than the basket**, which is not a style
 *  preference. `readBarcode` is memoised because it gates the camera's scan
 *  loop (#112), so whatever it closes over is a dependency of that loop — and
 *  the item *count* changes only when a capture is stowed or thrown away, where
 *  the basket array changes on every keystroke in the sheet. Passing the count
 *  is what keeps a rebuild of the scan loop off the path of typing a number
 *  into it. */
export function roomFor(held: number, incoming: number): boolean {
  return held + incoming <= MAX_MEAL_ITEMS;
}

/** Can this capture's read be corrected? (#59)
 *
 *  Two conditions and both are structural rather than policy. It has to be a
 *  **photo**, because a re-read reads a picture — a barcode is a database
 *  lookup and a typed line is already the person's own words, and neither has
 *  anything for a note to overrule. And it has to have a **`photoKey`**,
 *  because that key is the only handle on the bytes: the client's blob is gone
 *  once the sheet is up (the frozen still is an object URL, not a JPEG source),
 *  which is why the re-read reads R2 rather than uploading again.
 *
 *  **#16's blank recovery row qualifies, and that is the point rather than an
 *  accident.** A capture whose read failed is `source: "photo"` with a
 *  `photoKey` and one empty item — so the same affordance is a second attempt
 *  at a read that never landed, with the person's own description as the note.
 *  The one shape excluded is the capture whose R2 write itself failed
 *  (`photo_store_failed`): no key, no bytes, nothing to re-read, and the manual
 *  path is all there is. */
export function correctable(capture: Capture): boolean {
  return capture.source === "photo" && capture.photoKey !== undefined;
}

/** Whether a re-read of `capture` returning `incoming` foods still fits.
 *
 *  It **replaces** rather than appends, so what the cap has to be asked about
 *  is the rest of the basket plus the new read — not the whole basket plus the
 *  new read, which is `roomFor`'s question and would refuse a two-for-two swap
 *  on a full basket. A re-read is the one operation here that can make a basket
 *  smaller. */
export function roomForReread(
  basket: readonly Capture[],
  capture: number,
  incoming: number,
): boolean {
  return roomFor(basketItemCount(basket) - (basket[capture]?.items.length ?? 0), incoming);
}

/** Replace one capture's items with a fresh read of the same photo (#59).
 *
 *  **A re-read is not an edit, and this function is where that is decided.**
 *  Every item is rebuilt with `editable`, so `orig` and `base` are the *new*
 *  numbers — which means `isEdited` is false, `edited` goes to the wire as 0,
 *  and `ai_*` records what the reader said *this* time. That is the correct
 *  claim: the AI is overriding itself at the user's request, and `edited`
 *  answers "did the user override the AI?" (#58/#76). Carrying the old `orig`
 *  through would file every correction as a user edit and quietly poison the
 *  one column #75's estimate-quality analysis reads.
 *
 *  **ONE capture, never the basket** (#81). A basket is a list of captures and
 *  a note is about the photo one of them came from; a re-read that replaced the
 *  sheet would throw away a scanned bun because the plate was misread. With a
 *  single capture that is the whole sheet, which is today's common case and is
 *  why the distinction is easy to lose.
 *
 *  **Everything that is not the reading survives**: `source` and `photoKey`,
 *  because the photo did not change, and the capture's position, so the rows
 *  come back where they were. `manual` is cleared — a read that has now
 *  succeeded is no longer #16's failure, and leaving it would keep "couldn't
 *  read it" on a sheet full of foods.
 *
 *  Refusals return the basket **unchanged**, and every one of them is also
 *  checked by the caller with a sentence to say — same split as `stow`: this
 *  guard cannot speak, so on its own it would be a silent discard. An empty
 *  read is refused here rather than emptying the capture, which is #16's rule
 *  exactly: a failed re-read leaves what is on screen on screen. */
export function reread(
  basket: readonly Capture[],
  capture: number,
  items: readonly AnalyzedItem[],
  readMs: number,
  note: string,
): Capture[] {
  const target = basket[capture];
  if (!target || !correctable(target)) return [...basket];
  if (!items.length) return [...basket];
  if (!roomForReread(basket, capture, items.length)) return [...basket];
  return basket.map((c, i) => {
    if (i !== capture) return c;
    const { manual: _cleared, ...kept } = c;
    return { ...kept, items: items.map(editable), readMs, note };
  });
}

/** The confirm sheet is up — **the one boolean, and the reason it is a
 *  function** (#112).
 *
 *  `CameraStage`'s scan loop must be off while the sheet is rendered and **on
 *  while the basket is held and the user is capturing the next food**, which
 *  is a state that did not exist before #81: a basket with items in it and no
 *  sheet on screen. Writing that as `basket.length > 0` — which is what
 *  `read !== null` meant — would leave the scanner dead for exactly the tap
 *  this issue adds, and writing it as two separate conditions in a dependency
 *  array is #112 verbatim: the rule in one place and its dependencies in
 *  another, drifting the moment a third condition arrives.
 *
 *  So the sheet's own render condition, the stage's `reviewing` prop and the
 *  scan loop's gate are all this one call. A condition added here cannot fail
 *  to reach the effect, because it *is* what the effect depends on. */
export function sheetOpen({ basket, adding }: { basket: readonly Capture[]; adding: boolean }): boolean {
  return basket.length > 0 && !adding;
}

/** Is throwing this basket away worth asking about first?
 *
 *  **Captures, not items** — and the distinction is the whole rule. #52 argues
 *  against confirmations and for undo, and that argument is right *because the
 *  row it deletes is recoverable from the server*: the undo toast re-POSTs a
 *  meal that D1 still described a moment ago. Nothing here is recoverable from
 *  anywhere. A basket exists in this screen's memory and nowhere else, so a
 *  stray backdrop tap on three captures destroys three trips to the fridge with
 *  no restore path to offer — the failure #81 names in as many words. Where
 *  undo is impossible the confirmation is the only thing left between the tap
 *  and the loss.
 *
 *  **One capture keeps the dismiss it ships with today, whatever it holds.**
 *  A photograph that returned three foods is ONE capture: dismissing it costs
 *  one shutter press, the frame is still in front of the camera, and #16's
 *  photo is already in R2. Counting items instead would have put a confirmation
 *  in front of the app's most-used path to fix a failure that path does not
 *  have — and changing the shipped single-capture dismiss is precisely what
 *  this must not do. */
export function needsDismissConfirm(basket: readonly Capture[]): boolean {
  return basket.length > 1;
}

/** #15's grams field applies to exactly one product, so it is drawn only while
 *  the basket holds exactly one capture.
 *
 *  **The retirement is real narrowing and is stated on screen rather than
 *  silently applied.** The field is per *read* (#15, #58 and #107 all say so
 *  explicitly and #58 says to leave it alone), so a basket holding two barcode
 *  products has no single number for it to mean. When a second capture is
 *  appended the amount it has already produced is frozen into that capture's
 *  macros and into the `portion_qty`/`ai_portion_qty` columns `savedGrams`
 *  writes — correct data, just no longer adjustable from this sheet.
 *
 *  The cleaner answer is to normalise a barcode capture's grams into its item's
 *  own `portion`, so #58's per-item control simply takes over and nothing
 *  retires. That is deliberately not done here: it means refactoring the
 *  shipped grams path to make a new one symmetrical, which #58 forbids in as
 *  many words, and it would change what a *single*-capture barcode save writes
 *  — the one path this issue must leave alone. */
export function showsGrams(basket: readonly Capture[]): boolean {
  return basket.length === 1 && basket[0]?.grams !== undefined;
}
