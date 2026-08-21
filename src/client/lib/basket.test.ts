import { expect, test } from "vitest";
import type { AnalyzedItem } from "../../shared/api";
import {
  type Capture,
  MAX_MEAL_ITEMS,
  basketItemCount,
  basketRows,
  needsDismissConfirm,
  roomFor,
  sheetOpen,
  showsGrams,
} from "./basket";
import { editable } from "./portion";

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
