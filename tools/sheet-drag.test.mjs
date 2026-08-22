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
  });

  /** And no sheet may go back to drawing the bare pill, which is exactly what
   *  #60 and M2 shipped and what this issue is about. */
  it("leaves no sheet drawing a bare .grab", () => {
    for (const file of [EDIT, LOG]) {
      expect(file).not.toMatch(/className="grab"/);
      expect(file).toMatch(/<SheetHandle \/>/);
    }
  });

  /** #116's trap, as a check. `touch-action: none` applies down through
   *  whatever is inside the band, so content placed in there becomes
   *  undraggable *and* unscrollable — which is precisely the sticky slot header
   *  #116 is about to want. The element is self-closing over one child and
   *  stays that way. */
  it("wraps the pill and nothing else", () => {
    const band = HANDLE.slice(HANDLE.indexOf("grab-band"));
    expect(band).toMatch(/<div className="grab" \/>\s*<\/div>/);
  });
});
