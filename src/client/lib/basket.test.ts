import { expect, test } from "vitest";
import type { AnalyzedItem } from "../../shared/api";
import {
  type Capture,
  MAX_MEAL_ITEMS,
  basketItemCount,
  basketRows,
  correctable,
  droppedCount,
  droppedNote,
  needsDismissConfirm,
  reread,
  roomFor,
  roomForReread,
  sheetOpen,
  sheetSubtitle,
  showsGrams,
} from "./basket";
import { type EditableItem, editable, isEdited } from "./portion";

/** #81's rules, away from the screen that renders them.
 *
 *  Every one of these is invisible to a screenshot and to a single round of
 *  tapping — an append that quietly replaces looks like a sheet with one food
 *  on it, a dismiss guard counting the wrong thing looks like a confirmation
 *  that fires slightly too often, and a cap that never binds looks like
 *  nothing at all. That is #100's argument for why the rules live in a module
 *  rather than inside the component, and this file is the other half of it.
 *
 *  One assertion per test and no table walked in a loop: a broken run has to
 *  report on every case, not on the first one that threw. */

function food(name: string, calories = 100): AnalyzedItem {
  return { name, calories, protein_g: 5, carbs_g: 10, fat_g: 2, confidence: 0.8 };
}

/** The issue's own lunch: scan the patty, scan the bun, type the mustard. */
const patty: Capture = {
  items: [editable(food("Chicken patty", 190))],
  readMs: 380,
  source: "barcode",
  barcode: "5000112637922",
  grams: 114,
  base: [food("Chicken patty", 190)],
  baseGrams: 114,
};
const bun: Capture = {
  items: [editable(food("Brioche bun", 250))],
  readMs: 420,
  source: "barcode",
  barcode: "8712566341726",
};
const typed: Capture = {
  items: [editable(food("Yellow mustard", 15)), editable(food("Dill pickles", 12))],
  readMs: 1600,
  source: "text",
};
const photographed: Capture = {
  items: [editable(food("Fish and chips", 900))],
  readMs: 2400,
  source: "photo",
  photoKey: "user/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
};

// ── the flatten, and the provenance riding with it ───
// The sheet addresses rows by one flat index; a row that lost track of its
// capture would draw FROM THE BARCODE over a hand-typed mustard, which is the
// same false claim #75's analysis would read out of the stored column.

test("flattens every capture's foods into one list, in capture order", () => {
  expect(basketRows([patty, bun, typed]).map((r) => r.item.name)).toEqual([
    "Chicken patty",
    "Brioche bun",
    "Yellow mustard",
    "Dill pickles",
  ]);
});

test("each row still knows which capture produced it", () => {
  expect(basketRows([patty, bun, typed]).map((r) => r.from.source)).toEqual([
    "barcode",
    "barcode",
    "text",
    "text",
  ]);
});

test("a row's index within its own capture survives the flatten", () => {
  // The sheet edits by translating flat → (capture, index). Off by one here
  // and typing into the mustard changes the pickles.
  expect(basketRows([patty, typed]).map((r) => [r.capture, r.index])).toEqual([
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
});

test("an empty basket flattens to nothing", () => {
  expect(basketRows([])).toEqual([]);
});

// ── the two counts, which are deliberately different ─

test("counts foods across every capture", () => {
  expect(basketItemCount([patty, bun, typed])).toBe(4);
});

test("one photo returning three foods is three foods", () => {
  const plate: Capture = { ...photographed, items: [food("a"), food("b"), food("c")].map(editable) };
  expect(basketItemCount([plate])).toBe(3);
});

// ── the dismiss guard: captures, not foods ───────────
// #52 argues against confirmations and for undo, and is right BECAUSE the row
// it deletes is recoverable from the server. Nothing here is.

test("one capture dismisses without asking, exactly as it shipped", () => {
  expect(needsDismissConfirm([patty])).toBe(false);
});

test("a single photo returning three foods still dismisses without asking", () => {
  // The case the guard must not change: it is ONE shutter press, the plate is
  // still in front of the camera, and #16's photo is already in R2. Counting
  // foods instead of captures would put a confirmation on the app's most-used
  // path to fix a failure that path does not have.
  const plate: Capture = { ...photographed, items: [food("a"), food("b"), food("c")].map(editable) };
  expect(needsDismissConfirm([plate])).toBe(false);
});

test("two captures are asked about before they are thrown away", () => {
  expect(needsDismissConfirm([patty, bun])).toBe(true);
});

test("an empty basket has nothing to ask about", () => {
  expect(needsDismissConfirm([])).toBe(false);
});

// ── the sheet's one boolean (#112, #81) ──────────────
// The sheet's render condition, CameraStage's `reviewing` prop and the scan
// loop's gate are all this call. If it were "the basket has something in it",
// the scanner would be dead for exactly the tap this issue adds.

test("the sheet is up when a basket is held and nobody is adding", () => {
  expect(sheetOpen({ basket: [patty], adding: false })).toBe(true);
});

test("the sheet is down while adding, with the basket still held", () => {
  // The state #81 creates and #112's `read !== null` could not express: full
  // basket, no sheet, scanner running.
  expect(sheetOpen({ basket: [patty, bun], adding: true })).toBe(false);
});

test("an empty basket is never the sheet, adding or not", () => {
  expect(sheetOpen({ basket: [], adding: false })).toBe(false);
});

test("an empty basket while adding is still not the sheet", () => {
  expect(sheetOpen({ basket: [], adding: true })).toBe(false);
});

// ── the cap ──────────────────────────────────────────
// Nothing has ever reached it in the app. These are the only executions of it
// that exist, which is the whole reason they are here.

test("a food fits while the basket is under the cap", () => {
  expect(roomFor(MAX_MEAL_ITEMS - 1, 1)).toBe(true);
});

test("a food that lands exactly on the cap fits", () => {
  expect(roomFor(MAX_MEAL_ITEMS - 1, 1) && roomFor(0, MAX_MEAL_ITEMS)).toBe(true);
});

test("a food that would pass the cap does not fit", () => {
  expect(roomFor(MAX_MEAL_ITEMS, 1)).toBe(false);
});

test("a multi-food read that would pass the cap is refused whole", () => {
  // The only shape that can overflow in one step: a photograph of a plate,
  // onto a basket already near the cap. Refused entire rather than truncated —
  // dropping foods off the end of a read is a silent edit of what it said.
  expect(roomFor(MAX_MEAL_ITEMS - 2, 5)).toBe(false);
});

test("the client's cap is the number the save route refuses past", () => {
  // Restated rather than imported — `routes/food-logs.ts` is a Worker module
  // the client must not pull in. If this ever disagrees, the symptom is a
  // control that 400s, which is precisely the discovery the cap exists to
  // prevent. `food-logs.route.test.ts` pins the server's own.
  expect(MAX_MEAL_ITEMS).toBe(20);
});

// ── #15's grams field, and its retirement ────────────

test("the grams field is drawn for a lone barcode capture", () => {
  expect(showsGrams([patty])).toBe(true);
});

test("the grams field retires once a second capture lands", () => {
  // Two scanned products have two weights and the field is per read (#15,
  // #58, #107). Applying it to the first would silently rescale one product
  // by the other's number.
  expect(showsGrams([patty, bun])).toBe(false);
});

test("a lone capture with no grams draws no field", () => {
  expect(showsGrams([typed])).toBe(false);
});

test("an empty basket draws no field", () => {
  expect(showsGrams([])).toBe(false);
});

// ── #59: telling the reader it got the food wrong ────
// Every claim here is invisible to a screenshot. A re-read that quietly filed
// itself as a user edit renders identically to one that did not; a re-read
// that emptied a capture on a failed read looks like a sheet with nothing on
// it, which is exactly the blank manual row #16 says never to drop somebody
// into. That is #100's argument, and #81's finding — nothing in this repo
// executes `Log.tsx`, so a rule left in the component has no oracle at all.

/** The failed read #16 opens a sheet on: the photo is in R2, the row is
 *  blank, and the person types what they ate. */
const failed: Capture = {
  items: [editable(food("", 0))],
  readMs: 20000,
  source: "photo",
  photoKey: "user/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
  manual: "The read took too long and was stopped.",
};

/** What a corrected read comes back with. */
const hamless = [food("Cheese toastie", 340), food("Side salad", 45)];

test("a photographed capture can be corrected", () => {
  expect(correctable(photographed)).toBe(true);
});

test("a barcode capture cannot — the numbers came from a database, not a judgement", () => {
  expect(correctable(patty)).toBe(false);
});

test("a typed capture cannot — the text already is the person's own words", () => {
  expect(correctable(typed)).toBe(false);
});

test("a photo whose R2 write failed cannot — there are no bytes to re-read", () => {
  // `photo_store_failed`: the one shape that reaches the sheet as a photo
  // capture with no key at all, and the one where the manual path is all
  // there is.
  expect(correctable({ ...photographed, photoKey: undefined })).toBe(false);
});

test("#16's blank recovery row CAN be corrected — a second attempt at a read that never landed", () => {
  expect(correctable(failed)).toBe(true);
});

// ── the cap, asked the way a REPLACEMENT has to ask it ──

test("a two-for-two swap fits on a basket that is already full", () => {
  // The distinction `roomFor` cannot make: a re-read replaces, so the basket
  // it has to fit into is the one WITHOUT the capture being re-read. Asking
  // `roomFor(all, 2)` here would refuse a swap that changes nothing.
  const full: Capture[] = [
    { ...photographed, items: [editable(food("a")), editable(food("b"))] },
    { ...typed, items: Array.from({ length: MAX_MEAL_ITEMS - 2 }, (_, i) => editable(food(`x${i}`))) },
  ];
  expect(roomForReread(full, 0, 2)).toBe(true);
});

test("a re-read that would push the basket past the cap does not fit", () => {
  const full: Capture[] = [
    { ...photographed, items: [editable(food("a")), editable(food("b"))] },
    { ...typed, items: Array.from({ length: MAX_MEAL_ITEMS - 2 }, (_, i) => editable(food(`x${i}`))) },
  ];
  expect(roomForReread(full, 0, 3)).toBe(false);
});

// ── the replacement itself ───────────────────────────

test("replaces that capture's foods with the fresh read", () => {
  const after = reread([photographed], 0, hamless, 3900, "no ham");
  expect(after[0]?.items.map((i) => i.name)).toEqual(["Cheese toastie", "Side salad"]);
});

test("leaves every other capture alone", () => {
  const after = reread([patty, photographed, typed], 1, hamless, 3900, "no ham");
  expect([after[0], after[2]]).toEqual([patty, typed]);
});

/** **The claim this issue turns on.** A re-read produces fresh AI numbers, so
 *  it resets `orig` and must not set `edited` — the AI is correcting *itself*
 *  at the user's request, where `edited` answers "did the user override the
 *  AI?" (#58/#76). The fixture is deliberately a capture whose items HAD been
 *  hand-edited: seeded from a pristine read, both implementations agree, and
 *  the test would pass against code that carried the old `orig` through. */
const handEdited: EditableItem = {
  ...editable(food("Ham and cheese toastie", 430)),
  calories: 300,
  name: "Toastie",
};
const corrected: Capture = { ...photographed, items: [handEdited] };

/** Split from the test below rather than asserted inside it. A fixture check
 *  that throws leaves the assertion after it neither green nor red — it simply
 *  never runs, while the test's name goes on claiming coverage (CLAUDE.md). */
test("the fixture for the test below is genuinely a hand edit", () => {
  expect(isEdited(handEdited)).toBe(true);
});

test("a re-read resets orig, so nothing in it counts as edited", () => {
  expect(reread([corrected], 0, hamless, 3900, "no ham")[0]?.items.some(isEdited)).toBe(false);
});

test("keeps the photo it re-read — same source, same key", () => {
  const after = reread([photographed], 0, hamless, 3900, "no ham");
  expect(after[0]).toMatchObject({ source: "photo", photoKey: photographed.photoKey });
});

test("clears #16's couldn't-read-it line once the read has succeeded", () => {
  const after = reread([failed], 0, hamless, 3900, "two slices of pizza");
  expect(after[0]?.manual).toBeUndefined();
});

test("records the note, so a re-read that changed nothing still shows it was heard", () => {
  const after = reread([photographed], 0, hamless, 3900, "no ham");
  expect(after[0]?.note).toBe("no ham");
});

test("stamps the new read time", () => {
  const after = reread([photographed], 0, hamless, 3900, "no ham");
  expect(after[0]?.readMs).toBe(3900);
});

// ── the refusals, which are all #16's rule ───────────

test("a re-read that found nothing leaves every item on screen", () => {
  // The failure #16 owns: never drop somebody into the blank manual row they
  // had already escaped. Emptying the capture would do exactly that.
  expect(reread([photographed], 0, [], 3900, "no ham")).toEqual([photographed]);
});

test("a re-read that would overflow the cap changes nothing", () => {
  const full: Capture[] = [
    { ...photographed, items: [editable(food("a"))] },
    { ...typed, items: Array.from({ length: MAX_MEAL_ITEMS - 1 }, (_, i) => editable(food(`x${i}`))) },
  ];
  expect(reread(full, 0, hamless, 3900, "no ham")).toEqual(full);
});

test("an index that names no capture changes nothing", () => {
  expect(reread([photographed], 4, hamless, 3900, "no ham")).toEqual([photographed]);
});

test("a capture that cannot be corrected is refused here too", () => {
  // The caller checks `correctable` before it draws the control; this guard is
  // the one that cannot be forgotten by a fourth caller added later — the same
  // split `stow` has between a refusal that can speak and one that cannot.
  expect(reread([patty], 0, hamless, 3900, "no ham")).toEqual([patty]);
});

// ── #110: a dropped food is not allowed to be silent ─
// `normalize()` refuses an item outright when one of its four figures is out
// of range, because a macro has no null representation to refuse into the way
// a portion does. So a photograph of a plate can come back with fewer foods on
// it than the plate has — and a silent drop is the same defect as the silent
// clamp it replaces, one level up.

test("says nothing when nothing was dropped", () => {
  expect(droppedNote(0)).toBeNull();
  expect(droppedNote(-1)).toBeNull();
});

test("says it in the singular for one food", () => {
  expect(droppedNote(1)).toBe("One food came back with numbers that can't be right, so it was left out.");
});

test("says it in the plural, with the count, for more than one", () => {
  expect(droppedNote(3)).toBe("3 foods came back with numbers that can't be right, so they were left out.");
});

test("counts a capture's drops", () => {
  expect(droppedCount([{ ...typed, dropped: 2 }])).toBe(2);
});

test("counts across the basket, not just the first capture", () => {
  // #16's recovery row aside, every capture in a basket can lose a food and
  // the sheet has one paragraph to say so in.
  expect(droppedCount([typed, { ...patty, dropped: 1 }, { ...bun, dropped: 2 }])).toBe(3);
});

test("counts zero for a basket that dropped nothing", () => {
  expect(droppedCount([typed, patty, bun])).toBe(0);
});

test("skips a capture that was refused whole — its `manual` already says so", () => {
  // Counting it too would print the same fact twice in one paragraph: the
  // subtitle leads with `manual` and would then add the note behind it.
  expect(droppedCount([{ ...photographed, manual: "One food came back…", dropped: 1 }])).toBe(0);
});

test("still counts another capture's drops when the first was refused whole", () => {
  const basket: Capture[] = [
    { ...photographed, manual: "One food came back…", dropped: 1 },
    { ...typed, dropped: 2 },
  ];
  expect(droppedCount(basket)).toBe(2);
});

// ── the subtitle, whole ──────────────────────────────
// Nothing in this repo executes `Log.tsx`, so the copy is only a rule if it
// lives somewhere a test can reach. These are the assertions that go red when
// a sentence stops being said.

test("a plain read gets the standing instruction and nothing else", () => {
  expect(sheetSubtitle([typed])).toBe("Tap anything to change it before it saves.");
});

test("a basket says what a save of it will produce", () => {
  expect(sheetSubtitle([patty, bun])).toBe("Tap anything to change it. One save, one entry on Today.");
});

test("a dropped food is named, and the instruction stays", () => {
  // It displaces nothing: "tap anything to change it" is discoverable by
  // tapping, and a food that is silently absent is discoverable by nothing.
  expect(sheetSubtitle([{ ...typed, dropped: 1 }])).toBe(
    "One food came back with numbers that can't be right, so it was left out. Tap anything to change it before it saves.",
  );
});

test("#16's recovery row still leads with why the sheet is blank", () => {
  expect(sheetSubtitle([{ ...photographed, manual: "No food found in that photo." }])).toBe(
    "No food found in that photo. Your photo is saved — type what you ate, or close this to retake.",
  );
});

test("a refused-whole read does not say the same thing twice", () => {
  const manual = "One food came back with numbers that can't be right, so it was left out.";
  expect(sheetSubtitle([{ ...photographed, manual, dropped: 1 }])).toBe(
    `${manual} Your photo is saved — type what you ate, or close this to retake.`,
  );
});

test("a recovery row beside a lossy capture says both", () => {
  // The case the nested ternary this replaced could not express: it could only
  // ever print one of the two.
  const basket: Capture[] = [
    { ...photographed, manual: "No food found in that photo.", dropped: 0 },
    { ...typed, dropped: 1 },
  ];
  expect(sheetSubtitle(basket)).toBe(
    "No food found in that photo. One food came back with numbers that can't be right, so it was left out. Your photo is saved — type what you ate, or close this to retake.",
  );
});

test("an empty basket still returns a sentence rather than an empty paragraph", () => {
  expect(sheetSubtitle([])).toBe("Tap anything to change it before it saves.");
});

// ── #110 on the re-read path ─────────────────────────

test("a re-read replaces the dropped count rather than adding to it", () => {
  // It describes the read that is on the sheet NOW. Accumulating would report
  // foods dropped from an answer nobody can see any more.
  const after = reread([{ ...photographed, dropped: 2 }], 0, hamless, 3900, "no ham", 1);
  expect(after[0]?.dropped).toBe(1);
});

test("a clean re-read takes the sentence back off the sheet", () => {
  const after = reread([{ ...photographed, dropped: 2 }], 0, hamless, 3900, "no ham");
  expect(after[0]?.dropped).toBe(0);
});
