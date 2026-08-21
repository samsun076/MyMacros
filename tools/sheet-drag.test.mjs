import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISMISS_PX } from "../src/client/lib/sheet-drag.ts";

/** The picks panel's drag handle, as tests rather than as prose (#102).
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

const BAND = ".picks-sheet .grab-band {";
const SHEET = ".sheet.picks-sheet {";

describe("the drag handle's hit band (#102)", () => {
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

describe("the sheet under it (#102)", () => {
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
   *  second statement of it, correct only until somebody moved one. */
  it("never restates the dismiss distance as a CSS length", () => {
    const rules = code.slice(code.indexOf(SHEET), code.indexOf(".sheet-wrap {"));
    expect(rules).not.toMatch(new RegExp(`(^|[^\\d.])${DISMISS_PX}px`));
  });
});
