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

/** Every custom property a selector's block declares, name → value. */
function tokensIn(selector) {
  const at = code.indexOf(selector);
  if (at === -1) return null;
  const open = code.indexOf("{", at);
  const body = code.slice(open + 1, code.indexOf("}", open));
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** Night Athletic, the base pack (#29) — bare `:root`, no attribute. */
const base = tokensIn(":root {");

/** Night Athletic's accent picker palette. A light pack has no accent choice —
 *  its accent is its material, not a setting — so these three are the one
 *  thing it is right to inherit and never use. */
const ACCENT_PALETTE = ["--accent-coral", "--accent-gold", "--accent-mint"];

/** What a ready pack MUST restate: anything carrying a colour or a typeface.
 *
 *  Not the metrics. `--tabbar-height: 62px` is the same 62px in every theme,
 *  and forcing three copies of it is the register's own defect wearing a
 *  design-system hat; a pack that wants a different bar says so and inherits
 *  otherwise. Colour is different — a pack that forgets one gets Night
 *  Athletic's blue-black on ivory paper, which is the failure the base-pack
 *  decision (#29) traded *for*, on the argument that it is visible. This makes
 *  it caught instead of merely visible.
 *
 *  Shadows, `--scrim` and the two gradient surfaces are all colour-bearing and
 *  land here on their values rather than by name — `--shadow-lift`'s whole
 *  point is that a deep blue-black drop means nothing on paper. */
function mustRestate(name, value) {
  if (ACCENT_PALETTE.includes(name)) return false;
  return /#[0-9a-f]|rgba?\(/i.test(value) || name.endsWith("-font");
}

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
    it.skipIf(!pack.ready)(`${theme}: restates every colour and typeface`, () => {
      const declared = tokensIn(`:root[data-theme="${theme}"] {`) ?? new Map();
      const missing = [...base]
        .filter(([name, value]) => mustRestate(name, value) && !declared.has(name))
        .map(([name]) => name);
      expect(missing, `${theme} would inherit these from Night Athletic`).toEqual([]);
    });

    /** A light pack declaring `color-scheme: dark` is the #53 white-flash bug
     *  in reverse — the UA canvas and every form control would go dark under
     *  ivory paper. The boot script in index.html rewrites the meta from this. */
    it.skipIf(!pack.ready)(`${theme}: declares its colour scheme`, () => {
      const at = code.indexOf(`:root[data-theme="${theme}"] {`);
      const body = code.slice(code.indexOf("{", at) + 1, code.indexOf("}", at));
      expect(body).toMatch(/color-scheme:\s*light/);
    });
  }
});

/** Chrome-backed surfaces must take their ink from `--on-chrome` (#123).
 *
 *  **The rule already existed in prose and nothing executed it.** `.tab`'s
 *  comment states it exactly — *"a pack is free to make `--chrome` a surface
 *  the page's ink cannot be read on — Field Notes' is the notebook's pine cover
 *  under ivory paper, where page ink is invisible"* — and `.cam-x svg` used
 *  `--ink-secondary` anyway, from the moment the light packs landed until build
 *  rule 4's render check found it:
 *
 *      field-notes    #6e6a5c on #24513f   1.67:1
 *      instrument     #5e574a on #1b1712   2.49:1
 *      night-athletic #9fadc0 on #111720   7.89:1   <- and this is why
 *
 *  **Night Athletic is the reason it survived.** Build rule 1 puts all polish
 *  there, and there `--ink-secondary` and `--on-chrome` happen to agree, so the
 *  pairing was wrong on two packs and right on the only one anyone renders.
 *
 *  This walks the stylesheet rather than the tokens, because the defect is a
 *  *pairing* — both values were correct on their own and neither file was
 *  wrong in isolation. That is the same shape as `.picks-sheet`'s `80dvh`
 *  losing the cascade (#82) and the note field's focus ring painting under the
 *  viewfinder (#122): a rule that reads right in the file and is wrong in the
 *  layout two elements make together. */
describe("chrome-backed surfaces take chrome ink (#123)", () => {
  const css = readFileSync(join(import.meta.dirname, "../src/client/styles/app.css"), "utf8");

  /** Selectors whose own background is `--chrome`, however they reach it —
   *  a bare `var(--chrome)` or a `color-mix` of it, which is how `.cam-x`
   *  spelt it and is exactly the spelling a naive substring check would have
   *  missed. */
  const chromeBacked = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, , body]) => /background[^;]*var\(--chrome\)/.test(body))
    .map(([, sel]) => sel.trim().split("\n").pop().trim());

  it("finds the chrome-backed rules at all, so the rest of this block is not vacuous", () => {
    expect(chromeBacked.length).toBeGreaterThan(0);
  });

  /* The glyph rules are separate selectors from the surface ones (`.cam-x` sets
     the background, `.cam-x svg` sets the stroke), so the check is: for every
     chrome-backed selector, no rule scoped under it may take a page-ink token.
     `--ink`, `--ink-secondary`, `--ink-muted`, `--ink-dim` are all page ink. */
  for (const base of ["\\.cam-x", "\\.tab"]) {
    it(`nothing under ${base.replace(/\\/g, "")} uses page ink`, () => {
      const scoped = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) =>
        new RegExp(`(^|[\\s,])${base}([\\s.:\\[]|$)`).test(sel),
      );
      const offenders = scoped
        .filter(([, , body]) => /(color|stroke|fill)[^;]*var\(--ink(-[a-z]+)?\)/.test(body))
        .map(([, sel]) => sel.trim().split("\n").pop().trim());
      expect(offenders).toEqual([]);
    });
  }
});
