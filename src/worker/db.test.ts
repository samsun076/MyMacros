import { expect, test } from "vitest";
import { D1_MAX_BOUND_PARAMS, insertChunks } from "./db";

/** The ceiling nobody knew was there (#81).
 *
 *  D1 binds at most 100 parameters per statement, a `food_logs` row is 22
 *  columns wide, and `POST /api/food-logs` built one multi-row INSERT — so
 *  five foods was `too many SQL variables` and a 500 that discarded a confirm
 *  sheet living only in the browser's memory. Measured against real workerd
 *  and real D1 before the fix: 1–4 items returned 201, 5–20 returned 500.
 *
 *  The route test is the one that proves the fix; these are the arithmetic
 *  underneath it, and they exist because the *width* is what will move next —
 *  the next migration to add a column silently drops the rows-per-statement by
 *  one, and nothing else in the codebase would notice. */

const row22 = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`c${i}`, i]));
const row5 = { a: 1, b: 2, c: 3, d: 4, e: 5 };

test("a food_logs row is narrow enough for four per statement, not five", () => {
  // 22 × 4 = 88 placeholders; 22 × 5 = 110, which is what fired.
  expect(insertChunks(Array.from({ length: 5 }, () => row22)).map((c) => c.length)).toEqual([4, 1]);
});

test("twenty foods become five statements, not twenty", () => {
  // The point of chunking rather than looping one row at a time: the round
  // trip is the cost, on a route somebody is standing still waiting for.
  expect(insertChunks(Array.from({ length: 20 }, () => row22)).length).toBe(5);
});

test("every row survives the split", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ ...row22, c0: i }));
  expect(insertChunks(rows).flat().map((r) => r.c0)).toEqual(rows.map((r) => r.c0));
});

test("no chunk can exceed D1's parameter ceiling", () => {
  const chunks = insertChunks(Array.from({ length: 20 }, () => row22));
  expect(Math.max(...chunks.map((c) => c.length * 22))).toBeLessThanOrEqual(D1_MAX_BOUND_PARAMS);
});

test("a save that already fitted is still one statement", () => {
  // The shipped path must not grow a round trip: one to four foods is every
  // save the app has ever made.
  expect(insertChunks(Array.from({ length: 4 }, () => row22)).length).toBe(1);
});

test("a narrower row packs more per statement", () => {
  // The width is read off the row rather than restated, which is the whole
  // reason a migration cannot rot this the way a hand-counted 22 would.
  expect(insertChunks(Array.from({ length: 40 }, () => row5)).map((c) => c.length)).toEqual([20, 20]);
});

test("one row is one statement", () => {
  expect(insertChunks([row22]).length).toBe(1);
});

test("no rows is no statements", () => {
  expect(insertChunks([])).toEqual([]);
});

test("a row wider than the ceiling still yields one row per statement", () => {
  // It would fail at D1 either way; what it must not do is loop forever or
  // return empty chunks, which a naive `Math.floor` would.
  const wide = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`c${i}`, i]));
  expect(insertChunks([wide, wide]).map((c) => c.length)).toEqual([1, 1]);
});
