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
