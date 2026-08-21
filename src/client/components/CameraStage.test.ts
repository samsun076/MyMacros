import { expect, test } from "vitest";
import { scanEnabled } from "./CameraStage";

/** #112. The barcode scan loop is a live camera loop inside a React effect, and
 *  this repo has no way to render a component in a test — the `unit` project is
 *  `environment: "node"`, there is no jsdom and no testing-library, and no
 *  component test exists to follow. So the loop's *wiring* is proved by driving
 *  the running app (tools/), and what is pinned here is the rule the wiring
 *  reads: `scanEnabled` is the effect's only state dependency, so the condition
 *  set below and the dependency list are the same statement. That equivalence
 *  is the reason a pure test is enough here and would not have been before —
 *  the old effect could have this rule right and still scan behind a sheet,
 *  because its six-item dependency array was a second place to get it wrong.
 *
 *  One assertion per test, and no table walked in a loop: a broken run has to
 *  report on every case, not on the first one that threw. */

/** Barcode mode, camera up, nothing pending — the one state that scans. */
const scanning = {
  mode: "barcode",
  finder: "live",
  busy: false,
  still: false,
  error: false,
  reviewing: false,
} as const;

test("scans in barcode mode with a live finder and nothing pending", () => {
  expect(scanEnabled(scanning)).toBe(true);
});

// ── #112 ─────────────────────────────────────────────
// The sheet renders over the stage, not instead of it. A read open on it means
// the next frame would rebuild that sheet and throw away what was typed.

test("stops while a read is open on the confirm sheet (#112)", () => {
  expect(scanEnabled({ ...scanning, reviewing: true })).toBe(false);
});

test("a barcode read is reviewed with no frozen frame and nothing in flight (#112)", () => {
  // The reason `still` and `busy` could not have served as the lever: at the
  // moment the grams were being wiped, both were false. This asserts the state
  // the bug actually occurred in is reachable and is exactly the one above.
  expect(scanEnabled({ ...scanning, reviewing: true, still: false, busy: false })).toBe(false);
});

test("dismissing the sheet puts the loop back (#112)", () => {
  // The regression this fix could introduce, and it is worse than the bug: a
  // scanner that never comes back means the next scan silently does nothing.
  expect(scanEnabled({ ...scanning, reviewing: false })).toBe(true);
});

// ── the five conditions that were already there (#15) ─
// Regression guards. None of them separates the fixed loop from the broken one.

test("does not scan in photo mode", () => {
  expect(scanEnabled({ ...scanning, mode: "photo" })).toBe(false);
});

test("does not scan in text mode", () => {
  expect(scanEnabled({ ...scanning, mode: "text" })).toBe(false);
});

test("does not scan before the finder has produced a frame", () => {
  expect(scanEnabled({ ...scanning, finder: "starting" })).toBe(false);
});

test("does not scan when the camera was refused", () => {
  expect(scanEnabled({ ...scanning, finder: "denied" })).toBe(false);
});

test("does not scan when there is no viewfinder to be had", () => {
  expect(scanEnabled({ ...scanning, finder: "unsupported" })).toBe(false);
});

test("does not scan while a lookup is in flight", () => {
  expect(scanEnabled({ ...scanning, busy: true })).toBe(false);
});

test("does not scan while a frame is frozen", () => {
  expect(scanEnabled({ ...scanning, still: true })).toBe(false);
});

test("does not scan while a failure is showing", () => {
  // Load-bearing since #15: otherwise the next frame re-reads the same code and
  // the failure repeats forever.
  expect(scanEnabled({ ...scanning, error: true })).toBe(false);
});
