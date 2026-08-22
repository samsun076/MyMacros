import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISMISS_PX } from "../src/client/lib/sheet-drag.ts";

/** Every sheet's drag handle, as tests rather than as prose (#102, #118).
 *
 *  Everything about this gesture that a CDP drive can reach is driven — what
 *  dismisses, what scrolls, what springs back. What it cannot reach is the
 *  *reason* three of these declarations are there, because each of them fails
 *  in a way that still renders and still passes a state-machine check:
 *
 *  - a band that shrinks back to `.grab`'s 4px is a target nobody can hit, and
 *    every drag test still passes, because a synthetic touch lands wherever it
 *    is told to;
 *  - a band that stops being `sticky` scrolls out of reach, and the only test
 *    that notices is one that scrolled the list first;
 *  - a band without `touch-action: none` hands the drag back to the scroller,
 *    which headless Chrome and a thumb disagree about.
 *
 *  Follows `swipe-panel.test.mjs` — same reasons for living in `tools/`
 *  (`src/client` is covered by tsconfig.app, which has no Node types by
 *  design) and the same comment-stripping discipline, because the rules below
 *  are described at length in the comments directly above them and a plain
 *  substring search would read the explanation as the thing itself.
 */
const code = readFileSync(join(process.cwd(), "src/client/styles/app.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of the first rule whose selector matches. */
function ruleBody(selector) {
  const at = code.indexOf(selector);
  if (at === -1) return "";
  const open = code.indexOf("{", at);
  return code.slice(open + 1, code.indexOf("}", open));
}

/** One declaration out of a rule body, trimmed — the LAST one, because that is
 *  the one that cascades (swipe-panel.test.mjs learned this from a mutation
 *  that added a second `right` under the first and stayed green). */
function decl(selector, prop) {
  const body = ruleBody(selector);
  const all = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`, "g"))];
  return all.length ? all[all.length - 1][1].trim() : "";
}

/** **These moved off `.picks-sheet` in #118 and the move is the assertion.**
 *  The band and the drag surface belong to `.sheet` now, because all three
 *  sheets drag; stated on the picks panel they would be a rule the next sheet
 *  has to remember to copy, which is the defect #118 was filed about wearing a
 *  stylesheet. `.sheet.picks-sheet` still exists and still owns the one thing
 *  that is genuinely the panel's — its lower ceiling — which the last block
 *  here goes on checking. */
const BAND = ".grab-band {";
const BAND_HEAD = ".grab-band.with-head {";
const SHEET = ".sheet {";
const PICKS = ".sheet.picks-sheet {";

describe("the drag handle's hit band (#102, #118)", () => {
  /** **A 4px-tall drag target is not a target.** `.grab` is 36 × 4 and stays
   *  that size; what changes is that it now sits inside a row you can actually
   *  put a thumb on. */
  it("is at least a 44pt target down", () => {
    expect(Number(decl(SHEET, "--grab-band-h").replace("px", ""))).toBeGreaterThanOrEqual(
      44,
    );
  });

  /** The metric above is only the truth if the rule reads it. `height: 4px`
   *  beside a correct `--grab-band-h` passes the measurement and renders the
   *  bar's own height — #91 found exactly that shape by mutating it. */
  it("takes its height from that property", () => {
    expect(decl(BAND, "height")).toBe("var(--grab-band-h)");
  });

  /** **Sticky is load-bearing, not tidy.** A body drag only dismisses while
   *  the list is at the top, so the handle is the exit that works mid-list —
   *  and `.sheet` is the scroller, so without this it scrolls out of reach at
   *  exactly the moment it is the only thing that would have worked. */
  it("stays on screen once the list is scrolled", () => {
    expect(decl(BAND, "position")).toBe("sticky");
  });

  /** Sticky to the sheet's own top edge; anything else parks the band inside
   *  the list it is supposed to sit above. */
  it("sticks to the top of the sheet", () => {
    expect(decl(BAND, "top")).toBe("0");
  });

  /** The other half of the handle's claim: without this the browser scrolls
   *  the list under a sheet the drag is already moving. The band is 44px that
   *  never scrolls, which is what makes taking the touch here safe. */
  it("keeps the touch out of the scroller", () => {
    expect(decl(BAND, "touch-action")).toBe("none");
  });

  /** Build rule 2. The band is opaque so scrolled rows pass under it rather
   *  than through it, and a literal here is invisible to every pack but the
   *  one it was written for. */
  it("draws its surface from a token", () => {
    expect(decl(BAND, "background")).toMatch(/^var\(--/);
  });
});

/** **#116 merged the picks panel's head into the band, so the band now has two
 *  heights and both of them are budgets.**
 *
 *  The bare bar is still 44px on the confirm and edit sheets, which have no
 *  head to merge. The merged bar carries `ONE TAP · LOGS AS LUNCH` — a claim
 *  about what an unconfirmed one-tap write does — and it is a *stated* height
 *  rather than `auto` for the reason the whole area keeps producing bugs: this
 *  panel lives under an 80dvh ceiling, and a bar that grows with its content is
 *  a bar nobody costed. */
describe("the merged bar (#116)", () => {
  /** Still a target, not a picture. The merge must not be paid for by shrinking
   *  the thing #102 built the band to be. */
  it("is at least a 44pt target down", () => {
    expect(Number(decl(SHEET, "--grab-band-head-h").replace("px", ""))).toBeGreaterThanOrEqual(
      44,
    );
  });

  /** Same trap as the bare band's: a correct property beside a rule that reads
   *  something else measures nothing. */
  it("takes its height from that property", () => {
    expect(decl(BAND_HEAD, "height")).toBe("var(--grab-band-head-h)");
  });

  /** **The half of #116's trap that is still live.** `.grab-band`'s
   *  `touch-action: none` covers this variant, and that is what makes a drag
   *  starting on the statement a dismissal rather than a scroll. Restating it
   *  here as `auto` — the plausible edit, on the theory that a text bar should
   *  not swallow touches — would give the panel a bar that looks like a handle
   *  and hands the touch back to the list. Restating it as `none` would be a
   *  second statement of a rule that already applies. Neither: say nothing. */
  it("does not restate the band's touch-action", () => {
    expect(ruleBody(BAND_HEAD)).not.toMatch(/touch-action/);
  });

  /** It stays one bar. Someone reintroducing `position: sticky` on a head below
   *  the band is the alternative #116 costed and rejected, and it would show up
   *  here as the merged rule losing the sticky it inherits from `.grab-band`. */
  it("does not re-position itself out of the sticky band", () => {
    expect(ruleBody(BAND_HEAD)).not.toMatch(/position\s*:/);
  });
});

describe("the sheet under it (#102, #118)", () => {
  /** iOS's own bounce would move the sheet at the same time the transform
   *  does — two things moving one surface, and the one this project's tooling
   *  can see is not the one that would be wrong. Nothing scrollable sits
   *  behind the panel, so there is no chain worth keeping either. */
  it("does not let the scroller bounce under the drag", () => {
    expect(decl(SHEET, "overscroll-behavior")).toBe("none");
  });

  /** A spring-back has to be visible as a return, or a rejected drag reads as
   *  a stutter. The hook drops this to `none` inline while a finger is down. */
  it("eases the sheet back when a drag is refused", () => {
    expect(decl(SHEET, "transition")).toMatch(/^transform /);
  });
});

describe("the panel's rule has to win (#82, #102)", () => {
  /** **A declaration that loses the cascade is not a decision, and it reads
   *  exactly like one.** `.sheet` is declared *below* this block with the same
   *  specificity, so `.picks-sheet { max-height: 80dvh }` never applied and the
   *  panel rendered at `.sheet`'s 86dvh — measured at 320×568, 488.47px of a
   *  568px viewport, from the day #82 shipped. Every declaration here that
   *  `.sheet` also makes was silently `.sheet`'s.
   *
   *  Nothing above would have caught it: the property is present, spelled
   *  correctly, in a rule that never wins. So the shape of the selector is
   *  itself the assertion, and the rendered ceiling is checked by the drive. */
  it("states the panel's rule at a specificity .sheet cannot beat", () => {
    expect(code).toMatch(/\.sheet\.picks-sheet\s*\{/);
  });

  /** And the same claim from the other side, because `.sheet.picks-sheet {`
   *  *contains* `.picks-sheet {` — every selector-based check in this file
   *  would go on passing if someone dropped the prefix. */
  it("never restates it as a bare .picks-sheet rule", () => {
    expect(code).not.toMatch(/(^|[^\w.-])\.picks-sheet\s*\{/m);
  });
});

describe("one quantity, one source (#86, #102)", () => {
  /** #91's rule, inherited: the commit distance is gesture feel and lives in
   *  `lib/sheet-drag.ts`. A CSS length that happened to equal it would be a
   *  second statement of it, correct only until somebody moved one.
   *
   *  Since #102's UAT the distance is a *share* of the panel's height and `DISMISS_PX`
   *  is only its floor — but the floor is still a number the stylesheet must
   *  not restate, and it is still the number a `padding` or a `translate` would
   *  most plausibly collide with. */
  it("never restates the dismiss distance as a CSS length", () => {
    const from = code.indexOf(PICKS);
    const rules = code.slice(from, code.indexOf(".sheet-head {", from));
    // The slice has to reach something, or this passes by measuring nothing —
    // which is what it would have done after #118 moved `.sheet` below
    // `.sheet-wrap`, the anchor this used to stop at.
    expect(rules.length).toBeGreaterThan(200);
    expect(rules).toMatch(/\.grab-band \{/);
    expect(rules).not.toMatch(new RegExp(`(^|[^\\d.])${DISMISS_PX}px`));
  });
});


/** **The wiring, asserted from the source, because nothing here executes it.**
 *
 *  CLAUDE.md is explicit and has three mutations to prove it: `Log.tsx` has no
 *  unit oracle at all — #81's `stow` was broken and 988 tests stayed green,
 *  #59's note-spending was broken twice and 1036 stayed green, and #102's own
 *  `sheet-drag.ts` was *corrupted* under 817 passing tests. #118 puts a
 *  gesture on two more surfaces in that same blind layer, so the checks below
 *  are structural for the same reason the CSS ones above are: they cannot see
 *  whether the drag feels right, but they can see whether it is still attached.
 *
 *  Comments are stripped first, for the file's usual reason — every name below
 *  is discussed at length in prose directly beside the code that uses it, and a
 *  plain substring search would read the explanation as the thing itself. */
const src = (rel) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const EDIT = src("src/client/components/EditMealSheet.tsx");
const LOG = src("src/client/routes/Log.tsx");
const HANDLE = src("src/client/components/SheetHandle.tsx");
/** #116 moved the picks panel's band out of `Log.tsx` and into the component
 *  that owns the rows, so this file is now part of the wiring the checks below
 *  read. Nothing executes it either. */
const PICKS_TSX = src("src/client/components/Picks.tsx");

describe("every sheet is actually wired to the gesture (#118)", () => {
  /** The whole finding, as a check: a bar that looks draggable and is not. The
   *  three sheets each spread the hook's handlers onto their own `.sheet`, and
   *  dropping any one of them puts that sheet back where #118 found it. */
  it("hands the edit sheet the handlers and the style", () => {
    expect(EDIT).toMatch(/\{\.\.\.drag\.handlers\}/);
    expect(EDIT).toMatch(/style=\{drag\.style\}/);
  });

  it("hands the confirm sheet the handlers and the style", () => {
    expect(LOG).toMatch(/\{\.\.\.confirmDrag\.handlers\}/);
    expect(LOG).toMatch(/style=\{confirmDrag\.style\}/);
  });

  it("leaves the picks panel wired as #102 left it", () => {
    expect(LOG).toMatch(/\{\.\.\.picksDrag\.handlers\}/);
    expect(LOG).toMatch(/style=\{picksDrag\.style\}/);
  });

  /** **`dismiss`, never `discard`, and this is the safety argument itself.**
   *  `dismiss` is the backdrop's function and carries #81's more-than-one-
   *  capture confirmation and #59's refusal mid-re-read; `discard` is the
   *  destruction those guards stand in front of, with exactly one legitimate
   *  caller. A one-word edit here turns the cheapest input in the app into the
   *  one action in it with no undo, and would look entirely reasonable in a
   *  diff. */
  it("routes the confirm sheet's drag through the guard, not around it", () => {
    expect(LOG).toMatch(/useDragToDismiss\(dismiss\)/);
    expect(LOG).not.toMatch(/useDragToDismiss\(discard\)/);
  });

  /** The backdrop tap comes out of the same call, which is what makes "the drag
   *  is exactly the backdrop tap" a property rather than a claim. A sheet that
   *  goes back to writing its own `e.target === e.currentTarget` has re-opened
   *  the gap even if both handlers happen to agree on the day it is written. */
  it("takes the backdrop tap from the same hook call", () => {
    for (const file of [EDIT, LOG]) {
      expect(file).toMatch(/\{\.\.\.\w*[Dd]rag\.backdrop\}/);
      expect(file).not.toMatch(/e\.target === e\.currentTarget/);
    }
  });
});

describe("one handle, drawn once (#118)", () => {
  /** The band's whole job is to carry `SHEET_HANDLE_ATTR` — the attribute
   *  `armsDrag` reads to tell the exit that works mid-list from a drag that
   *  started in the content. Three copies of that markup is three chances to
   *  render an identical-looking bar that arms nothing, and it would pass every
   *  screenshot in the project. */
  it("is the only component that renders the handle", () => {
    expect(HANDLE).toMatch(/SHEET_HANDLE_ATTR/);
    expect(EDIT).not.toMatch(/SHEET_HANDLE_ATTR/);
    expect(LOG).not.toMatch(/SHEET_HANDLE_ATTR/);
    expect(PICKS_TSX).not.toMatch(/SHEET_HANDLE_ATTR/);
  });

  /** And no sheet may go back to drawing the bare pill, which is exactly what
   *  #60 and M2 shipped and what this issue is about. The confirm and edit
   *  sheets take the handle with no head, which is what the slot being optional
   *  is for — #116 must not have quietly made a head mandatory. */
  it("leaves no sheet drawing a bare .grab", () => {
    for (const file of [EDIT, LOG, PICKS_TSX]) {
      expect(file).not.toMatch(/className="grab"/);
    }
    for (const file of [EDIT, LOG]) {
      expect(file).toMatch(/<SheetHandle \/>/);
    }
  });

  /** **The picks panel still wears a band, and since #116 it is `Picks` that
   *  draws it.** `Log.tsx` renders the panel's `.sheet` and no handle inside
   *  it, because the statement in that band is a claim about what tapping a row
   *  does and belongs with the rows. A `Picks` that stopped drawing one would
   *  leave the panel with no drag exit at all — #118's bug on the one sheet it
   *  was originally written for — and every screenshot would still pass. */
  it("gives the picks panel its band through the component that owns the rows", () => {
    expect(PICKS_TSX).toMatch(/<SheetHandle>/);
    expect(PICKS_TSX).toMatch(/<\/SheetHandle>/);
  });
});

/** **What the band may wrap, restated for #116 — and this block is the reason
 *  the old one-line rule is gone rather than broken.**
 *
 *  #118 asserted "the band wraps the pill and nothing else", on the strength of
 *  a real trap: `touch-action: none` on an ancestor disables panning for every
 *  touch that starts inside it, so anything in the band is unscrollable. #116
 *  puts a bar of text in there deliberately, which retires the letter of that
 *  rule and keeps all of its force:
 *
 *  **the band may wrap chrome, and may never wrap the sheet's scrolling
 *  content.** A statement that was always going to be a drag surface costs
 *  nothing; the row list costs the panel its scroll. The two assertions below
 *  are that sentence, and the drive measures the same claim from the other side
 *  — a drag on the first row still scrolls, a drag on the band still does not.
 *  Neither alone is enough: the structural one cannot see the cascade (#82's
 *  ceiling was correct, spelled right, and never applied) and the rendered one
 *  cannot see a change that has not shipped yet. */
describe("the band wraps chrome, never the list (#116, #118)", () => {
  /** The pill comes first and is never inside the head slot — otherwise the
   *  36×4 bar ends up laid out by the statement's row rather than by the band,
   *  and the handle stops reading as a handle. One optional slot, after it. */
  it("draws the pill first and the head slot after it", () => {
    const band = HANDLE.slice(HANDLE.indexOf("grab-band"));
    expect(band).toMatch(/<div className="grab" aria-hidden="true" \/>/);
    expect(band.indexOf('className="grab"')).toBeLessThan(band.indexOf('className="grab-head"'));
    expect(band).toMatch(/className="grab-head">\{children\}<\/div>/);
  });

  /** **The half of #118's trap that is still live**, and the edit it guards
   *  against is a plausible one: someone wanting the whole panel to drag from
   *  anywhere moves the list inside the band, every screenshot still passes,
   *  and the panel silently stops scrolling. The row loop stays a sibling. */
  it("never hands the row list to the band", () => {
    const open = PICKS_TSX.indexOf("<SheetHandle>");
    const shut = PICKS_TSX.indexOf("</SheetHandle>");
    expect(open).toBeGreaterThan(-1);
    expect(shut).toBeGreaterThan(open);
    const slot = PICKS_TSX.slice(open, shut);
    expect(slot).not.toMatch(/\.map\(/);
    expect(slot).not.toMatch(/className="pick"/);
    // And the rows really are outside it, rather than merely not inside a slot
    // that has been emptied of everything.
    expect(PICKS_TSX.indexOf('className="pick"')).toBeGreaterThan(shut);
  });

  /** **A sheet that passes no head gets exactly what #118 gave it.** The
   *  confirm and edit sheets have nothing to merge, and the two ways this could
   *  quietly cost them head space are both here: an unconditional `with-head`
   *  class (44px becomes 56, column layout, a rule under the pill on two sheets
   *  that wanted none) and an empty `.grab-head` box rendered anyway. Neither
   *  breaks a test that only looks at the picks panel, and neither is visible
   *  in a diff of this file that stops at "the band got a slot". */
  it("adds nothing to a sheet that passes no head", () => {
    expect(HANDLE).toMatch(/children\?: ReactNode/);
    expect(HANDLE).toMatch(/className=\{children \? "grab-band with-head" : "grab-band"\}/);
    expect(HANDLE).toMatch(/\{children \? <div className="grab-head">/);
  });

  /** **`aria-hidden` sits on the pill, not on the band** (#116). #118 hid the
   *  whole band because a bar advertising itself would offer a third exit that
   *  does not exist for a keyboard — true of the pill and only of the pill.
   *  Left on the band it would take the statement out of the accessibility tree
   *  in the same change that made it permanently visible on screen, which is
   *  the sighted user gaining a guarantee and the screen-reader user losing
   *  one. No screenshot in this project can see that.
   *
   *  **The first version of this check was decorative and a mutation said so.**
   *  It sliced from the first `grab-band` — which is *inside* the className
   *  expression — so putting `aria-hidden="true"` back on the band's opening
   *  tag *before* `className` landed outside the window and the whole suite
   *  stayed green on the exact edit this exists to catch. CLAUDE.md's #59 rule
   *  arriving in a new file: when a mutation comes back green, the first
   *  question is whether the oracle distinguishes the two implementations at
   *  all. Counting the attribute is what does; the slice is kept beneath it
   *  because the count alone would pass if someone moved the one occurrence. */
  it("keeps the head slot in the accessibility tree", () => {
    expect([...HANDLE.matchAll(/aria-hidden/g)]).toHaveLength(1);
    expect(HANDLE).toMatch(/<div className="grab" aria-hidden="true" \/>/);
    const bandTag = HANDLE.slice(HANDLE.indexOf("<div"), HANDLE.indexOf('className="grab"'));
    expect(bandTag).not.toMatch(/aria-hidden/);
  });

  /** **Which `Picks` is the panel's, asserted from the caller.** The band only
   *  exists on the in-sheet placement, so dropping `inSheet` from the panel's
   *  call site takes the whole merged bar away *and* the grab handle with it —
   *  #116 and #118 undone in one deleted word, with the statement falling back
   *  into the scrolling list where this issue found it. Everything else in this
   *  file reads `Picks.tsx`, which would be untouched and still correct. */
  it("gives the panel's list the in-sheet placement and the inline one not", () => {
    const panelAt = LOG.indexOf('className="sheet picks-sheet"');
    expect(panelAt).toBeGreaterThan(-1);
    expect([...LOG.matchAll(/inSheet/g)]).toHaveLength(1);
    // Asserted as a *set* boolean, not merely as a word that appears:
    // `inSheet={false}` reads as the prop being handled and is the placement
    // being switched off. The negative lookahead is what separates them.
    expect(LOG.slice(panelAt)).toMatch(/inSheet(?!\s*=)/);
    // the inline list under TEXT renders earlier in the file and stays plain
    expect(LOG.indexOf("<Picks")).toBeLessThan(panelAt);
  });
});

/** **A statement that cannot scroll away has to stay true** (#116).
 *
 *  This is the half of the merge that the geometry hides. `mealSlotFor()` reads
 *  the clock at render, so before #116 the picks head was correct when the
 *  panel opened and never again — 11:59 to 12:01 with the panel up left it
 *  saying BREAKFAST while a tap wrote lunch. That was survivable while the
 *  statement scrolled off; it is not survivable now that it is pinned to the
 *  top of the panel for every row, because a permanently-visible wrong answer
 *  is strictly worse than an accurate one you had to scroll back for.
 *
 *  The arithmetic has a real oracle in `lib/meal-slot.test.ts`. What only a
 *  source read can state is that the component actually subscribes — a `Picks`
 *  that went back to the one-shot call would render identically, pass every
 *  screenshot, and be wrong for three minutes a day. */
describe("the statement in the band stays true (#116)", () => {
  it("subscribes to the slot rather than reading it once", () => {
    expect(PICKS_TSX).toMatch(/useMealSlot\(\)/);
    expect(PICKS_TSX).not.toMatch(/mealSlotFor\(/);
  });

  /** One statement, two frames. The text is written once and wrapped by
   *  whichever placement is drawing it, so the inline list under TEXT and the
   *  panel's band cannot drift into saying different things — the defect the
   *  component's own comment has warned about since #82. */
  it("writes the claim once for both placements", () => {
    expect([...PICKS_TSX.matchAll(/LOGS AS /g)]).toHaveLength(1);
    expect(PICKS_TSX).toMatch(/<SheetHandle>\{statement\}<\/SheetHandle>/);
    expect(PICKS_TSX).toMatch(/className="sec-head">\{statement\}<\/div>/);
  });

  /** And the write is still stamped from the clock, not from what is on
   *  screen. They are the same function and must stay two calls: the row's slot
   *  is a fact about the moment of the tap, and reading it off a rendered bar
   *  would make a stale frame *become* the truth rather than merely display a
   *  stale one. */
  it("leaves the row's own slot read at the moment of the tap", () => {
    expect(LOG).toMatch(/meal_slot: mealSlotFor\(\)/);
  });
});
