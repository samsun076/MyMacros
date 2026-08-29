import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** A sheet gives the keyboard its room back (#121).
 *
 *  Every macro field on the confirm, portion, basket and edit sheets rendered
 *  BELOW the keyboard line — measured at 375x812 with a 336px inset, fields at
 *  y=519–751 against a line at y=476. `.sheet-wrap` is `position: fixed;
 *  inset: 0`, and `inset: 0` is the LAYOUT viewport, which iOS deliberately
 *  does not shrink for the keyboard. The document scroll that rescues Settings
 *  and Onboarding cannot reach a fixed element, and the two sheets that scroll
 *  internally lose their last rows anyway, because the scroller's own bottom
 *  edge is already behind the keyboard.
 *
 *  The fix is one custom property, `--kb`, set inline from `useKeyboardInset`
 *  and read in two places: the wrapper pads its bottom by it (moving the sheet
 *  up, since the wrapper is `flex-end`), and the sheet subtracts it from its
 *  `max-height` (so a tall sheet cannot grow off the top instead).
 *
 *  **Why this file exists rather than a behavioural test.** Nothing in this
 *  repo executes `Log.tsx` — #81's `stow` was broken and 988 tests stayed
 *  green, #59's note-spending twice with 1036, and #102's own `sheet-drag.ts`
 *  was corrupted under 817 passing tests. A structural oracle is the only kind
 *  this layer has. Same discipline as `sheet-drag.test.mjs`, including the
 *  comment stripping — the rules below are argued at length in the comments
 *  directly above them, and a plain substring search would read the
 *  explanation as the thing itself.
 *
 *  **What it cannot tell you** is whether the sheet ends up in the right place
 *  on a phone. `tools/cdp.mjs`'s fabricated keyboard has no accessory bar, no
 *  predictive row and — the term that matters — no `visualViewport.offsetTop`,
 *  which is how iOS scrolls the visual viewport for a focused field. That is a
 *  thumb's question and #121 carries a UAT list for it.
 */
const css = readFileSync(join(process.cwd(), "src/client/styles/app.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function ruleBody(selector) {
  const at = css.indexOf(selector);
  if (at === -1) return "";
  const open = css.indexOf("{", at);
  return css.slice(open + 1, css.indexOf("}", open));
}

/** The LAST matching declaration, because that is the one that cascades —
 *  `swipe-panel.test.mjs` learned this from a mutation that added a second
 *  property under the first and stayed green. */
function decl(selector, prop) {
  const body = ruleBody(selector);
  const all = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`, "g"))];
  return all.length ? all[all.length - 1][1].trim() : "";
}

const WRAP = ".sheet-wrap {";
const SHEET = ".sheet {";
const PICKS = ".sheet.picks-sheet {";

const src = (rel) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const LOG = src("src/client/routes/Log.tsx");
const EDIT = src("src/client/components/EditMealSheet.tsx");

describe("the sheet gives the keyboard its room back (#121)", () => {
  it("the stylesheet was read", () => {
    // Without this the whole file passes by measuring nothing — a renamed
    // stylesheet or a stripped comment block would make every `ruleBody`
    // return "" and every `toContain` below fail loudly, but an empty read
    // would make them fail for the wrong reason and read as a real defect.
    expect(css.length).toBeGreaterThan(20000);
    expect(ruleBody(WRAP).length).toBeGreaterThan(0);
    expect(ruleBody(SHEET).length).toBeGreaterThan(0);
  });

  it("the wrapper pads its bottom by the keyboard", () => {
    // This is what moves the sheet up: the wrapper is fixed, inset:0 and
    // flex-end, so bottom padding is the whole of the mechanism.
    expect(decl(WRAP, "padding-bottom")).toBe("var(--kb, 0px)");
  });

  it("the wrapper is still bottom-anchored and fixed", () => {
    // Padding only lifts the sheet because of these two. A change to either
    // makes the padding inert without making it wrong-looking.
    expect(decl(WRAP, "position")).toBe("fixed");
    expect(decl(WRAP, "justify-content")).toBe("flex-end");
    expect(decl(WRAP, "inset")).toBe("0");
  });

  it("both sheet ceilings subtract the same keyboard", () => {
    // The wrapper's padding shortens the space available; a max-height that
    // did not subtract it would let a tall sheet grow off the TOP instead.
    // Both ceilings, because `.sheet.picks-sheet` overrides the base one and a
    // fix applied to only one of them is the bug wearing a different sheet.
    expect(decl(SHEET, "max-height")).toBe("calc(86dvh - var(--kb, 0px))");
    expect(decl(PICKS, "max-height")).toBe("calc(80dvh - var(--kb, 0px))");
  });

  it("every declaration falls back to 0px", () => {
    // `var(--kb)` with no fallback yields an INVALID value when the property
    // is absent, which is every sheet at rest — `padding-bottom` would be
    // dropped and `calc()` would poison the whole max-height. The fallback is
    // what makes "absent at rest" safe, and it is why keyboardInsetStyle
    // returns {} rather than 0px.
    for (const [sel, prop] of [
      [WRAP, "padding-bottom"],
      [SHEET, "max-height"],
      [PICKS, "max-height"],
    ]) {
      expect(decl(sel, prop), `${sel} ${prop} needs a var() fallback`).toContain("--kb, 0px");
    }
  });

  it("no CSS length restates the keyboard height", () => {
    // 336 is `verify-viewport`'s tool-side number and iOS's is whatever iOS
    // says. A stylesheet that hardcodes either is a second answer to a
    // measured question — #86, and the same guard sheet-drag.test.mjs keeps
    // over DISMISS_PX.
    expect(css).not.toMatch(/(?:padding|margin|height|bottom)[^;{}]*:\s*336px/);
  });

  it("every sheet wrapper carries the inset", () => {
    // Three wrappers across two files: the picks panel, the confirm sheet
    // (which is also basket/portion/refused/dropped/correct), and the edit
    // sheet. A wrapper added later without this renders its fields under the
    // keyboard again, silently, and nothing else in the suite would notice.
    // `{...xDrag.backdrop}` is the wrapper's marker: exactly one per wrapper,
    // and unlike the className it survives the confirm sheet's ternary
    // (`still ? "sheet-wrap over-photo" : "sheet-wrap"`), which a naive
    // className regex counts as one and a naive substring count as two.
    for (const [name, file, expected] of [
      ["Log.tsx", LOG, 2],
      ["EditMealSheet.tsx", EDIT, 1],
    ]) {
      const wrappers = [...file.matchAll(/\{\.\.\.\w*[Dd]rag\.backdrop\}/g)].length;
      expect(wrappers, `${name} wrapper count`).toBe(expected);
      const insets = [...file.matchAll(/style=\{keyboardInsetStyle\(kbInset\)\}/g)].length;
      expect(insets, `${name}: every sheet wrapper needs keyboardInsetStyle(kbInset)`).toBe(
        wrappers,
      );
    }
  });

  it("the inset is measured once per screen, not per sheet", () => {
    // Two readings of one keyboard is #86 with a second name, and they could
    // disagree by a frame during the resize.
    for (const [name, file] of [
      ["Log.tsx", LOG],
      ["EditMealSheet.tsx", EDIT],
    ]) {
      expect([...file.matchAll(/useKeyboardInset\(\)/g)].length, `${name}`).toBe(1);
    }
  });

  it("the sheet's transform is left to the drag hook", () => {
    // #120 lifted the camera deck with a transform. Doing that here would
    // collide with `dragStyle`, whose contract is that identity at rest is
    // `undefined` rather than translate3d(0,0,0) — and would push the grab
    // band, the only exit that works mid-scroll, off the top of the screen.
    expect(decl(SHEET, "transform")).toBe("");
    expect(decl(WRAP, "transform")).toBe("");
  });
});
