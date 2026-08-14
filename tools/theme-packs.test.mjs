import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_PACKS } from "../src/client/lib/theme.ts";

/** `THEME_PACKS[t].ready` against what `design/tokens.css` actually defines
 *  (#29, #30).
 *
 *  The flag decides whether Settings lets you pick a theme, and a flag is only
 *  as good as the thing it claims about. Both directions are failures, and
 *  each is a different mistake:
 *
 *    ready: true  with no token block  →  a control that switches you to a
 *      theme with no values of its own. Before #29 made Night Athletic the
 *      base pack that meant an *unstyled* app; now it means an option that
 *      silently does nothing, which is the more embarrassing of the two
 *      because it looks like it worked.
 *    ready: false with a token block   →  #30's work is done and unreachable.
 *      Nobody would notice from the app, because the control is disabled.
 *
 *  So the pack and the flag land in one commit or the build goes red.
 *
 *  Lives in `tools/` for the reason canvas.test.mjs does: `src/client` is
 *  covered by tsconfig.app, which has no Node types by design, and reading a
 *  file off disk does not belong in the browser project.
 */
const css = readFileSync(join(process.cwd(), "design/tokens.css"), "utf8");

/** Comments name every pack that hasn't landed yet — the placeholder block at
 *  the bottom of tokens.css describes both light packs in prose. Searching the
 *  raw file would read that description as the definition. Twice-learned
 *  lesson in this repo (fetch-fonts, service-worker, canvas). */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every custom property a selector's block declares. */
function tokensIn(selector) {
  const at = code.indexOf(selector);
  if (at === -1) return null;
  const open = code.indexOf("{", at);
  const body = code.slice(open + 1, code.indexOf("}", open));
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

/** Night Athletic, the base pack (#29) — bare `:root`, no attribute. */
const base = tokensIn(":root {");

describe("theme packs (#29, #30)", () => {
  it("has a base pack on bare :root", () => {
    expect(base, "design/tokens.css must define `:root {`").not.toBeNull();
    expect(base.size).toBeGreaterThan(30);
  });

  /** Night Athletic IS the base, so it has no block of its own to find. */
  it("treats night-athletic as ready and as the base", () => {
    expect(THEME_PACKS["night-athletic"].ready).toBe(true);
    expect(tokensIn(':root[data-theme="night-athletic"] {')).toBeNull();
  });

  for (const [theme, pack] of Object.entries(THEME_PACKS)) {
    if (theme === "night-athletic") continue;

    it(`${theme}: ready=${pack.ready} matches whether tokens.css defines it`, () => {
      const declared = tokensIn(`:root[data-theme="${theme}"] {`);
      expect(
        declared !== null,
        pack.ready
          ? `${theme} is offered in Settings but design/tokens.css has no :root[data-theme="${theme}"] block — picking it would do nothing`
          : `${theme} has a token block but THEME_PACKS still says ready:false — the pack is built and unreachable`,
      ).toBe(pack.ready);
    });

    /** The failure mode #29 chose deliberately: a base pack means a missing
     *  token inherits a DARK value rather than nothing at all. Visible, but
     *  only if someone looks — so it's checked instead. */
    it.skipIf(!pack.ready)(`${theme}: restates every token the base pack sets`, () => {
      const declared = tokensIn(`:root[data-theme="${theme}"] {`) ?? new Set();
      const missing = [...base].filter((t) => !declared.has(t));
      expect(missing, `${theme} would inherit these from Night Athletic`).toEqual([]);
    });
  }
});
