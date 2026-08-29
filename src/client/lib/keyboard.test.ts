import { expect, test } from "vitest";
import { KEYBOARD_GAP_PX, deckLift, keyboardHeight, keyboardInsetStyle, sheetInset } from "./keyboard";

/** #120. The camera deck rises so the pre-capture note clears the keyboard.
 *
 *  **This is the whole oracle for that behaviour, and it has to be**, because
 *  nothing in this repo executes `CameraStage.tsx` — three mutations of it in
 *  one day came back green across the entire suite. What the component does is
 *  hold two refs and put a `transform` on a `style` prop; every number in the
 *  feature is decided by the two functions below.
 *
 *  What it still cannot see is a keyboard. Headless Chrome has none, iOS's is
 *  not a rectangle of a known size, and the *feel* of a deck sliding under a
 *  thumb is not a property of arithmetic. Those are the drive and the device,
 *  in that order.
 *
 *  One assertion per test and no table walked in a loop: an assertion inside a
 *  loop whose earlier iteration threw reports nothing at all, while the test's
 *  name goes on suggesting coverage. */

/** The reference device with the keyboard up (build rule 6): a 13 mini is
 *  375x812, iOS's portrait keyboard plus its accessory bar takes roughly 336
 *  of that, and the camera deck under the note row — its margin, the mode
 *  tabs, the shutter and the deck's bottom padding — measures about 170.
 *
 *  The exact numbers are a scenario, not a claim: what every assertion below
 *  turns on is the *relation* between them. */
const H = 812;
const KEYBOARD = 336;
const VISIBLE = H - KEYBOARD;
const BELOW = 170;

// ── keyboardHeight ───────────────────────────────────

test("no visualViewport means no keyboard, not a lift computed from nothing", () => {
  expect(keyboardHeight(null, H)).toBe(0);
});

test("the keyboard is the layout viewport less the visual one", () => {
  expect(keyboardHeight({ height: VISIBLE, scale: 1 }, H)).toBe(KEYBOARD);
});

test("no keyboard when the two viewports agree", () => {
  expect(keyboardHeight({ height: H, scale: 1 }, H)).toBe(0);
});

/** Pinch-zoom shrinks the visual viewport exactly the way a keyboard does, and
 *  a deck that jumped when someone zoomed in to read a label would be this
 *  feature firing on the one gesture it has nothing to do with. */
test("a zoomed page is magnification, not a keyboard", () => {
  expect(keyboardHeight({ height: VISIBLE, scale: 2 }, H)).toBe(0);
});

test("a visual viewport taller than the layout one is not a negative keyboard", () => {
  expect(keyboardHeight({ height: H + 40, scale: 1 }, H)).toBe(0);
});

// ── deckLift ─────────────────────────────────────────

test("no keyboard, no lift", () => {
  expect(deckLift({ keyboard: 0, below: BELOW })).toBe(0);
});

/** The contract, stated as geometry rather than as arithmetic: after the lift,
 *  where does the bottom edge of the note row actually land on screen?
 *
 *  This is the assertion that distinguishes the implementation from a plausible
 *  wrong one — a sign flip on the gap, a missing term, a clamp that fires early
 *  — all of which still return "a number that grows with the keyboard". It
 *  reconstructs the screen instead of restating the formula. */
function noteRowBottomOnScreen({
  visible = VISIBLE,
  below = BELOW,
  offsetTop = 0,
}: { visible?: number; below?: number; offsetTop?: number } = {}) {
  const keyboard = keyboardHeight({ height: visible, scale: 1 }, H);
  const lift = deckLift({ keyboard, offsetTop, below });
  // The deck is anchored to the bottom of the layout viewport; `lift` moves it
  // up, and iOS's own scroll (`offsetTop`) moves what is drawn up again.
  return H - below - lift - offsetTop;
}

test("the note row lands exactly one gap above the keyboard", () => {
  expect(noteRowBottomOnScreen()).toBe(VISIBLE - KEYBOARD_GAP_PX);
});

test("it still lands one gap above a keyboard of a different height", () => {
  expect(noteRowBottomOnScreen({ visible: H - 291 })).toBe(H - 291 - KEYBOARD_GAP_PX);
});

/** A hardware keyboard leaves only the accessory bar, ~45px, and the deck is
 *  taller than that — the note is already above it. This is also where a false
 *  positive from Safari's bottom toolbar is absorbed. */
test("a deck taller than the keyboard needs no lift at all", () => {
  expect(deckLift({ keyboard: 45, below: BELOW })).toBe(0);
});

/** Lifting a bottom-anchored surface exposes a band of page beneath it, and
 *  that band is invisible only while the keyboard stands in front of it. One
 *  pixel past the keyboard's own height and #120's dead band is back, upside
 *  down. Reached by a deck so short that the uncapped answer would exceed it. */
test("it never lifts more than the keyboard is covering", () => {
  expect(deckLift({ keyboard: KEYBOARD, below: 4 })).toBe(KEYBOARD);
});

/** iOS scrolls the visual viewport up on its own to reveal a focused field.
 *  Left in, the page is shifted twice and the viewfinder loses twice the height
 *  it should. */
test("it subtracts the scroll iOS has already done", () => {
  expect(deckLift({ keyboard: KEYBOARD, offsetTop: 60, below: BELOW })).toBe(
    deckLift({ keyboard: KEYBOARD, below: BELOW }) - 60,
  );
});

/** The same statement from the other side, and the one that says the two
 *  shifts compose into one screen: whatever iOS has done, the row lands in the
 *  same place. */
test("what is on screen does not move as iOS gives its scroll back", () => {
  expect(noteRowBottomOnScreen({ offsetTop: 60 })).toBe(noteRowBottomOnScreen());
});

test("iOS having scrolled further than needed does not push the deck back down", () => {
  expect(deckLift({ keyboard: KEYBOARD, offsetTop: 300, below: BELOW })).toBe(0);
});

test("iOS having scrolled the whole keyboard away leaves nothing to lift", () => {
  expect(deckLift({ keyboard: KEYBOARD, offsetTop: KEYBOARD, below: 4 })).toBe(0);
});

/** `below` comes from two `getBoundingClientRect()` calls, so it is fractional
 *  on any device with a non-integer scale. A fractional transform is a blurred
 *  viewfinder edge and a re-render on every sub-pixel of drift. */
test("the lift is a whole number of pixels", () => {
  expect(deckLift({ keyboard: KEYBOARD, below: 170.4 })).toBe(178);
});

test("a wider gap lifts the deck further by exactly that much", () => {
  expect(deckLift({ keyboard: KEYBOARD, below: BELOW, gap: KEYBOARD_GAP_PX + 20 })).toBe(
    deckLift({ keyboard: KEYBOARD, below: BELOW }) + 20,
  );
});

/** #121 — the sheet inset. */
test("keyboardInsetStyle sets --kb to the measured height", () => {
  expect(keyboardInsetStyle(336)).toEqual({ "--kb": "336px" });
});

/** Identity at rest is ABSENT, not `0px`, and it is the same contract
 *  `dragStyle` states for `transform`: the two render identically and are not
 *  the same thing. `calc(86dvh - var(--kb, 0px))` already falls back, so an
 *  explicit `0px` would add a property to every sheet at rest for no effect —
 *  and would mask a misspelled var, hiding the bug the fallback exists to make
 *  visible. */
test("keyboardInsetStyle sets nothing when no keyboard is up", () => {
  expect(keyboardInsetStyle(0)).toEqual({});
});

test("keyboardInsetStyle sets nothing for a negative measurement", () => {
  // `keyboardHeight` clamps at zero so this cannot arrive today. Asserted
  // anyway: a negative padding is invalid CSS, dropped silently, which is the
  // failure mode that teaches you nothing.
  expect(keyboardInsetStyle(-40)).toEqual({});
});

/** #121's device failure: the padding must not repeat iOS's own scroll. */
test("sheetInset is the keyboard when iOS has scrolled nothing", () => {
  expect(sheetInset(336, 0)).toBe(336);
});

test("sheetInset subtracts what iOS already did", () => {
  // The shipped bug: 336 + a platform scroll of 120 lifted the sheet 456px and
  // took its header off the top of the screen. The total shift is the
  // invariant, so the padding is only ever the remainder.
  expect(sheetInset(336, 120)).toBe(216);
});

test("sheetInset never goes negative", () => {
  // iOS scrolling further than the keyboard covers is not a reason to pull the
  // sheet DOWN behind it. Same clamp, same reason, as deckLift's.
  expect(sheetInset(336, 400)).toBe(0);
});

test("sheetInset is zero with no keyboard, whatever the scroll", () => {
  expect(sheetInset(0, 0)).toBe(0);
  expect(sheetInset(0, 80)).toBe(0);
});
