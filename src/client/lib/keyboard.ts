import { type CSSProperties, type RefObject, useEffect, useState } from "react";

/** The software keyboard, and what a screen owes the field under it (#120).
 *
 *  **Nothing in this project had ever seen a keyboard before this file.**
 *  Headless Chrome has none, so `shot-matrix` and `cdp.mjs` render every
 *  screen keyboard-down and `verify:viewport` measures horizontal overflow
 *  only — which is how #59's pre-capture note shipped with the viewfinder
 *  clipped to a strip that still read "FRAME THE PLATE" and a dead band
 *  between the shutter and the keyboard. Dave, on `529974c`, an installed app
 *  on a 13 mini: *"just found the add a note. nice touch. visually it needs
 *  fixing."*
 *
 *  **The rule lives here rather than in `CameraStage.tsx` because nothing in
 *  this repo executes `CameraStage.tsx`.** Three mutations in one day proved
 *  it — `stow`, the correction's `previous` context, the spent note — all
 *  green across the whole suite. A decision made inside that component has no
 *  oracle at all, so the arithmetic is pure and tested here and the component
 *  is left holding two refs and a `style` prop.
 *
 *  **`visualViewport` is the instrument, and a keyboard height is not a
 *  number this file may contain.** iOS keyboards differ by language, by
 *  whether the predictive bar is on, by a hardware keyboard being attached —
 *  Dave's own screenshot shows an `EN PL` space bar, so a second layout is
 *  already in play on the device this was reported from. A literal here would
 *  be wrong on the first Polish keyboard and wrong again on the first iPad.
 *  What is measured instead is the gap between the layout viewport (which iOS
 *  does *not* shrink for the keyboard) and the visual one (which it does).
 *
 *  **What the numbers mean, once, so nothing below has to restate it.** All
 *  in CSS px, all in the client coordinates `getBoundingClientRect` reports:
 *
 *    `keyboard`   how much of the layout viewport the keyboard covers
 *    `offsetTop`  how far iOS has already scrolled the visual viewport up on
 *                 its own, trying to reveal the focused field
 *    `below`      the distance from the anchored field's bottom edge to the
 *                 bottom of the surface being lifted — the part that is
 *                 allowed to go off-screen
 */

/** Breathing room between the field and the top edge of the keyboard.
 *
 *  A decision, not a derivation, and said so here because a literal that
 *  arrives without an argument reads afterwards as though it had one. Zero
 *  would put the field's 1px border against the keyboard's accessory bar,
 *  which reads as the field being *under* the keyboard rather than above it.
 *
 *  It deliberately restates nothing in the stylesheet. `.cam-note`'s own
 *  `margin-bottom` is the space between the note and the deck below it; this
 *  is the space between the note and a surface the layout has never had to
 *  think about. Two numbers that happen to be similar are still two rules,
 *  and pinning them to each other is #86's defect wearing a keyboard. */
export const KEYBOARD_GAP_PX = 12;

/** Pinch-zoom shrinks the visual viewport exactly the way a keyboard does.
 *  Above 1 the page is zoomed and the difference is magnification, not a
 *  keyboard — lifting a deck for it would move the screen out from under a
 *  finger that is only trying to look closer. `1.01` rather than `1` because
 *  the scale is a float and iOS reports 1.0000000000000002 at rest. */
const NO_ZOOM = 1.01;

/** How much of the layout viewport the software keyboard is covering, in px.
 *
 *  `0` whenever the answer is unknowable or meaningless: no `visualViewport`
 *  (every browser this app supports has it, but a missing API must degrade to
 *  "no keyboard" rather than to a lift computed from `undefined`), a zoomed
 *  page, or a visual viewport somehow taller than the layout one.
 *
 *  **Android needs no special case and gets none.** Chrome there resizes the
 *  *layout* viewport for the keyboard by default, so the two heights stay
 *  equal, this returns 0, and the deck is left alone — which is right, because
 *  a layout that shrank has already moved the field above the keyboard itself.
 *
 *  **iOS Safari in-browser makes this read slightly high**, by roughly the
 *  bottom toolbar, and that is deliberately not corrected here. A false
 *  keyboard of ~80px is absorbed by the clamp in `deckLift`: anything smaller
 *  than the deck it would have to move produces no lift at all. */
export function keyboardHeight(
  view: { height: number; scale: number } | null | undefined,
  layoutHeight: number,
): number {
  if (!view) return 0;
  if (view.scale > NO_ZOOM) return 0;
  return Math.max(0, layoutHeight - view.height);
}

/** How far a bottom-anchored surface has to rise so the field at `below` px
 *  from its bottom edge sits `gap` px clear of the keyboard.
 *
 *  **The design call is Dave's and it is what the clamps encode** (#120): the
 *  whole camera deck slides up, the viewfinder keeps its real size and simply
 *  crops off the top, and the shutter and mode tabs go off the bottom edge and
 *  come back when the keyboard does. *"You are typing, not shooting, so losing
 *  the shutter costs nothing — but you still want a usable view of the plate
 *  you are about to photograph, and a clipped-but-real frame beats a squashed
 *  one."*
 *
 *  Three properties, each of which is a clamp rather than a comment:
 *
 *  **It never lifts more than the keyboard covers** (`room`). The surface is
 *  anchored to the bottom of the viewport, so lifting it exposes a band of
 *  page underneath — and that band is invisible only while the keyboard is
 *  standing in front of it. One pixel more and the dead band this issue is
 *  about comes back, upside down.
 *
 *  **It never returns a negative number.** A deck taller than the keyboard
 *  needs no lift: the field is already above it. That is the hardware-keyboard
 *  case (an accessory bar is ~45px against a deck of ~170) and it is also the
 *  false-positive case from `keyboardHeight`'s note above, absorbed here
 *  rather than guarded there.
 *
 *  **It subtracts what iOS has already done for us** (`offsetTop`). Left in,
 *  the page ends up shifted twice — once by the platform's own scroll-into-
 *  view and once by us — and the viewfinder loses twice the height it should.
 *  Subtracting it makes the *total* shift the invariant, which is also why
 *  this cannot oscillate: as iOS gives its scroll back, the lift grows by
 *  exactly as much, and what is on screen never moves.
 *
 *  `below` is measured from the two live rects rather than passed as a
 *  constant, and that is load-bearing for the same reason: the difference
 *  between two rects on the *same* transformed surface is invariant under the
 *  transform, so measuring it mid-lift — or mid-transition — gives the same
 *  answer as measuring it at rest. A version that measured the field's
 *  distance from the viewport bottom instead would feed its own output back
 *  into its next input. */
export function deckLift({
  keyboard,
  offsetTop = 0,
  below,
  gap = KEYBOARD_GAP_PX,
}: {
  keyboard: number;
  offsetTop?: number;
  below: number;
  gap?: number;
}): number {
  const room = keyboard - offsetTop;
  if (room <= 0) return 0;
  const needed = keyboard + gap - below - offsetTop;
  return Math.round(Math.min(Math.max(needed, 0), room));
}

/** Track the keyboard and report how far the surface at `stage` has to rise to
 *  keep the row at `anchor` above it. `0` whenever `active` is false.
 *
 *  Plumbing only — every decision it makes is one of the two functions above,
 *  which is the split the file's header argues for. It listens on the visual
 *  viewport's `resize` (the keyboard arriving and leaving) and `scroll` (iOS
 *  moving the page under it), and on the window's `resize` for the platforms
 *  that answer a keyboard by resizing the layout instead.
 *
 *  **`active` is one derived boolean rather than a list of conditions**
 *  (#112). The caller computes "the field is open" once and feeds it to both
 *  the render and this hook, so a condition added to one cannot fail to reach
 *  the other. */
export function useKeyboardLift(
  active: boolean,
  stage: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>,
): number {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    if (!active) {
      setLift(0);
      return;
    }
    const view = window.visualViewport;
    const measure = () => {
      const surface = stage.current;
      const row = anchor.current;
      if (!surface || !row) return;
      setLift(
        deckLift({
          keyboard: keyboardHeight(view, window.innerHeight),
          offsetTop: view?.offsetTop ?? 0,
          below: surface.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom,
        }),
      );
    };

    measure();
    view?.addEventListener("resize", measure);
    view?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      view?.removeEventListener("resize", measure);
      view?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [active, stage, anchor]);

  // Belt to the effect's own reset: a render between `active` going false and
  // the effect running must not draw a lifted deck with no field open.
  return active ? lift : 0;
}

/** How much room a bottom-anchored SHEET has to give back to the keyboard
 *  (#121).
 *
 *  ## Why this is not `useKeyboardLift`
 *
 *  #120's answer to the camera deck was to raise the whole surface with a
 *  `transform`. Three things stop that working here, and the third is the one
 *  that decides it:
 *
 *    1. **`transform` on `.sheet` is taken.** `sheet-drag.ts`'s `dragStyle`
 *       writes it, and its contract is that identity at rest is `undefined`
 *       rather than `translate3d(0,0,0)` — composing a second transform onto
 *       the same property would either break the spring-back easing or the
 *       cancelled-gesture snap.
 *    2. **A sheet has a head.** Lifting it whole pushes the grab band and the
 *       title off the top of the screen, and the band is the exit that works
 *       mid-scroll.
 *    3. **`deckLift`'s `below` is feedback-free only because the deck does not
 *       scroll.** It is the gap between two rects on one transformed surface,
 *       which is invariant under that transform. `.sheet` *is* the scroller, so
 *       an anchor's rect moves with `scrollTop`, and the measurement would feed
 *       its own output back in.
 *
 *  ## What it does instead
 *
 *  It returns the keyboard's height so the wrapper can pad itself by it. The
 *  wrapper is `position: fixed; inset: 0` with `justify-content: flex-end`, so
 *  padding its bottom edge moves the sheet up by exactly that much — no
 *  transform, no anchor, no measurement of the sheet's own contents, and
 *  nothing for a scroll position to perturb. The sheet's `max-height` subtracts
 *  the same value so it cannot grow off the top instead.
 *
 *  **It reuses `keyboardHeight` rather than restating the measurement** — the
 *  layout viewport less the visual one, with the pinch-zoom guard — because two
 *  answers to "how tall is the keyboard" is #86's defect with a second name.
 *
 *  ## Always on, unlike the deck's `active`
 *
 *  `useKeyboardLift` takes a derived boolean because the camera deck must only
 *  move while the note is open. A sheet has many fields and no single condition
 *  that means "one of them is focused", and inventing one would be exactly the
 *  list-of-conditions #112 is about. `keyboardHeight` already returns 0 when no
 *  keyboard is up, so the sheet is padded by zero at rest and the hook needs no
 *  opinion about focus at all. */
export function sheetInset(keyboard: number, offsetTop: number): number {
  // **iOS has usually already done part of this** and the padding must not
  // repeat it. `offsetTop` is how far the platform scrolled the visual viewport
  // up on its own to reveal the focused field; adding the full keyboard height
  // on top of that shifts the sheet twice, and its head — the title, and the
  // grab band, which is the only exit that works mid-scroll — leaves the top of
  // the screen.
  //
  // `deckLift` subtracts the same term for the same reason and says so. This
  // function was written without it and shipped, because the fabricated
  // keyboard in `cdp.mjs` reports `offsetTop: 0` unconditionally — the one term
  // nothing in this repo can exercise, named in that file's own docstring as
  // exactly that. Every automated check passed. It took a thumb, and every
  // sheet's header was off the top of the phone.
  //
  // Subtracting makes the TOTAL shift the invariant, which is also why it
  // cannot oscillate: as iOS gives its scroll back, the padding grows by the
  // same amount and nothing on screen moves.
  return Math.max(0, keyboard - offsetTop);
}

export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const view = window.visualViewport;
    const measure = () =>
      setInset(sheetInset(keyboardHeight(view, window.innerHeight), view?.offsetTop ?? 0));
    measure();
    view?.addEventListener("resize", measure);
    view?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => {
      view?.removeEventListener("resize", measure);
      view?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return inset;
}

/** The wrapper's inline style, so the CSS half is one custom property and the
 *  two consumers cannot spell it differently. `undefined` at zero rather than
 *  `"0px"`, matching `dragStyle`'s reasoning: an absent property and one set to
 *  its identity render the same and are not the same thing. */
export function keyboardInsetStyle(inset: number): CSSProperties {
  // The cast is React's typing, not a loophole: `CSSProperties` enumerates
  // known properties and has no index signature for custom ones, so a `--var`
  // is unrepresentable without it. The value is still a template of a measured
  // number, so nothing arbitrary reaches the DOM.
  return inset > 0 ? ({ "--kb": `${inset}px` } as CSSProperties) : {};
}
