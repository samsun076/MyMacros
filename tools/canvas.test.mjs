import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The canvas rules, as tests rather than as prose (#89).
 *
 *  Both were written down in CLAUDE.md, correctly, and neither stopped the
 *  regression it describes. On 2026-08-14 iOS Safari's top chrome broke twice
 *  in one session — once to `--canvas` (measured #0e1118, 24 off target) and
 *  once to black (#000000, at both ends of the screen at the same moment).
 *  Both shipped. Both passed `verify:firstpaint`, `verify:viewport` and every
 *  unit test, and one passed a direct read of the computed style that
 *  correctly reported `rgb(26,34,48)` — the right number on the wrong
 *  property. A photograph of a phone caught them.
 *
 *  **These cannot check that Safari still tints correctly.** Nothing here can;
 *  that needs a device and always will. What they close is the gap between
 *  "the declaration says what I intended" and "the rule was followed", which
 *  is where both regressions actually lived.
 *
 *  Lives in `tools/` rather than beside the stylesheet because `src/client` is
 *  covered by `tsconfig.app`, which has no Node types by design — reading a
 *  file from disk does not belong in the browser project.
 */
const css = readFileSync(join(process.cwd(), "src/client/styles/app.css"), "utf8");

/** Comments explain these rules directly above the code that keeps them, so a
 *  plain substring search reads the explanation as the violation. That has now
 *  happened twice in this repo (`fetch-fonts.test.mjs`,
 *  `service-worker.test.mjs`); a third time would be a choice, not an
 *  accident. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule whose selector matches, within `source`. */
function ruleBody(selector, source = code) {
  const at = source.indexOf(selector);
  if (at === -1) return "";
  const open = source.indexOf("{", at);
  return source.slice(open + 1, source.indexOf("}", open));
}

/** The phone-width `body` — where the canvas colour is actually decided. */
function phoneBody() {
  const at = code.indexOf("@media (max-width: 499px)");
  expect(at, "the phone-width media block must exist").toBeGreaterThan(-1);
  return ruleBody("body", code.slice(at));
}

describe("the canvas (#38, #89)", () => {
  /** A background on <html> BECOMES the canvas and stops body's from
   *  propagating. #53 put `var(--canvas)` there as an early-paint belt and it
   *  moved Safari's tint by 24. That job belongs to <meta name="color-scheme">. */
  it("declares no background on <html>", () => {
    expect(ruleBody("html {")).not.toMatch(/(^|[;\s])background(-color|-image)?\s*:/);
  });

  /** `background: <image>` resets background-color to transparent. Safari
   *  propagates a COLOUR, not an image, so the shorthand leaves nothing to
   *  propagate and the UA's dark-scheme canvas — black — wins. */
  it("never uses the background shorthand at phone widths", () => {
    expect(phoneBody()).not.toMatch(/(^|[;\s])background\s*:/);
  });

  /** The same rule stated positively, so deleting one line trips it too: an
   *  image with no colour beside it is the black-screen shape however it got
   *  there. */
  it("pairs any phone-width background-image with a background-color", () => {
    const body = phoneBody();
    if (!/background-image\s*:/.test(body)) return;
    expect(body).toMatch(/background-color\s*:/);
  });

  /** A literal here would be invisible to every theme but the one it was
   *  written for (build rule 2), and #30 is where the packs diverge. */
  it("sets the phone-width canvas colour from --bg-top", () => {
    expect(phoneBody()).toMatch(/background-color\s*:\s*var\(--bg-top\)/);
  });
});

/** The status-bar scrim (#93) — same file, same reason.
 *
 *  It lives here rather than beside a screenshot test because **no screenshot
 *  can see it at all**: it is sized entirely in multiples of
 *  `env(safe-area-inset-top)`, and headless Chrome reports that as 0. Every
 *  PNG this repo can produce is of an element with zero height. So the device
 *  check is the only proof it *works*, and these are the only guard against
 *  the three ways it could be quietly broken afterwards — each of which is
 *  invisible to Chrome for exactly the same reason it is invisible here.
 */
const scrim = () => ruleBody(".frame::before");

/** Read from the stylesheet rather than pinned to 10/20/30, so moving any of
 *  the three keeps the relationship honest instead of just moving a literal. */
const zOf = (selector) => Number(ruleBody(selector).match(/z-index\s*:\s*(\d+)/)?.[1]);

/** One declaration out of the scrim's rule body. */
function scrimDecl(prop) {
  const m = scrim().match(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`));
  return m ? m[1].trim() : "";
}

describe("the status-bar scrim (#93)", () => {
  it("exists", () => {
    expect(scrim(), "app.css must define .frame::before").not.toBe("");
  });

  /** **The safety property.** The scrim is only ever wanted where iOS has run
   *  the page under its own status bar. Everywhere else the inset is 0 and the
   *  element must therefore be 0 tall. Written as `calc(env(…) + 12px)`
   *  instead of `calc(env(…) * 1.25)` it paints a --bg-top band across the top
   *  of every desktop browser instead — not a hypothetical: that edit was made
   *  and headless Chrome rendered 12px of it against a zero inset. #38's
   *  defect class with the sign flipped.
   *
   *  Checked by substituting a zero inset and looking for any length left
   *  standing, so it holds for whatever arithmetic a future edit uses. */
  it("collapses to nothing wherever the inset is zero", () => {
    const vertical = `${scrimDecl("height")} ${scrimDecl("background-image")}`;
    expect(vertical, "the scrim needs a height and a gradient").toMatch(/env\(\s*safe-area-inset-top/);
    const zeroed = vertical.replaceAll(/env\(\s*safe-area-inset-top[^)]*\)/g, "0");
    expect(zeroed, "a length that survives a zero inset is a band on every desktop").not.toMatch(
      /\d+(\.\d+)?(px|r?em|v[hwib]|pt|ch)\b/,
    );
  });

  /** A scrim that swallows taps is the worst outcome available here, and the
   *  one nothing else can catch: on device it is ~62px of dead zone across the
   *  top of every screen, and in Chrome the element has no height, so it could
   *  not intercept a tap even if this line were gone. Structural or nothing. */
  it("never intercepts a tap", () => {
    expect(scrimDecl("pointer-events")).toBe("none");
  });

  /** Build rule 2, and the reason the token exists: a light pack may have to
   *  make this a dark plate, because `black-translucent` paints the status-bar
   *  glyphs white and white on ivory is the same defect one theme over (#30). */
  it("takes its colour from --status-scrim", () => {
    expect(scrimDecl("background-image")).toMatch(/var\(--status-scrim\)/);
  });

  /** Split from the assertion above rather than sharing its body: a mutation
   *  that swaps the var for a literal fails the first `expect`, and a second
   *  one underneath it would never run — neither green nor red, reporting
   *  nothing, while the test name still claims both halves. That is the
   *  never-ran trap CLAUDE.md counts, and one assertion per test is the
   *  practice that took #82's never-ran count to 0. */
  it("never states a colour as a literal", () => {
    expect(scrimDecl("background-image")).not.toMatch(/#[0-9a-f]{3}|rgba?\(/i);
  });

  /** Above the page and the tab bar, below the confirm sheet. The sheet lays
   *  its own `--scrim` dim wash over the whole viewport, so a page-coloured
   *  plate on top of that is a brighter band, not a quieter one. Read from the
   *  stylesheet rather than pinned to 10/20/30, so moving any of the three
   *  keeps the relationship honest instead of just moving the literal. */
  it("stacks above the tab bar", () => {
    expect(zOf(".tabbar")).toBeLessThan(zOf(".frame::before"));
  });

  /** Same split, same reason as the colour pair above. A scrim shoved under
   *  the tab bar and a scrim shoved over the confirm sheet are two different
   *  regressions, and a shared body only ever reports the first. */
  it("stacks below the confirm sheet", () => {
    expect(zOf(".frame::before")).toBeLessThan(zOf(".sheet-wrap"));
  });
});
