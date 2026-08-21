import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVEAL_PX } from "../src/client/lib/swipe.ts";

/** The delete control's shape, as tests rather than as prose (#91).
 *
 *  #91 was three complaints about one surface, and two of them are geometry
 *  that no unit test could see and no screenshot would report as an error: the
 *  panel stretched to the row's height (110px on an unclamped barcode name),
 *  and it sat flush against the kcal figure because nothing had chosen a gap.
 *  Both were *correct CSS*. What made them defects is a relationship — control
 *  to row, control to content — and a relationship is exactly what a
 *  declaration test can hold and a rendering cannot assert on its own.
 *
 *  **The one that matters most is the fixed height.** Delete `height` from
 *  `.swipe-panel` and it stretches to the row again, which is the whole issue;
 *  the test below goes red on that line alone.
 *
 *  Follows `canvas.test.mjs` — same reasons for living in `tools/`
 *  (`src/client` is covered by tsconfig.app, which has no Node types by
 *  design) and the same comment-stripping discipline, because this file's
 *  subject is described at length in the comments right above the rules it
 *  checks and a plain substring search would read the explanation as the
 *  thing itself.
 */
const css = readFileSync(join(process.cwd(), "src/client/styles/app.css"), "utf8");
const tsx = readFileSync(
  join(process.cwd(), "src/client/components/SwipeToDelete.tsx"),
  "utf8",
).replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule whose selector matches. */
function ruleBody(selector, source = code) {
  const at = source.indexOf(selector);
  if (at === -1) return "";
  const open = source.indexOf("{", at);
  return source.slice(open + 1, source.indexOf("}", open));
}

/** One declaration out of a rule body, trimmed — the LAST one, because that is
 *  the one that cascades. Reading the first instead let a mutation that added
 *  `right: 8px` under an existing `right: 0` slide the hit area 8px off the
 *  capsule with every assertion in this file still green. */
function decl(selector, prop) {
  const all = [...ruleBody(selector).matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`, "g"))];
  return all.length ? all[all.length - 1][1].trim() : "";
}

/** A `--foo: 32px` off `.swipe`, as a number. */
const metric = (name) => Number(decl(".swipe {", name).replace("px", ""));

describe("the delete control's size (#91)", () => {
  /** **The issue itself.** `.swipe-panel` used to be a flex child of the row's
   *  track, so its height was the row's: 57.55px on a one-line meal and
   *  110.19px on an unclamped barcode name, measured at 375. Absolute
   *  positioning alone does not fix that — with `top: 0; bottom: 0` and no
   *  height it stretches exactly as before. The height declaration is the
   *  fix, and it is one line to lose. */
  it("gives the panel a height of its own rather than the row's", () => {
    expect(decl(".swipe-panel", "height")).toBe("var(--swipe-panel-h)");
  });

  /** The other half of the same shape: a panel back in the flow would share a
   *  track with the row's content, which is what pushed the meal's name out
   *  under the clip edge and what put a solid block against the kcal figure. */
  it("takes the panel out of the row's flow", () => {
    expect(decl(".swipe-panel", "position")).toBe("absolute");
  });

  /** 32px against a 28.5px kcal column and a 13px row gap. Larger than 41.5
   *  and the control starts covering the meal's name — the one thing the
   *  revealed state must not hide, which is the finding #52's UAT filed here. */
  it("keeps the control inside the kcal column plus its gap", () => {
    expect(metric("--swipe-panel-w")).toBeLessThanOrEqual(28.5 + 13);
  });

  /** The metric above is only the truth if the rule reads it. `width: 88px`
   *  beside a correct `--swipe-panel-w` passes every measurement test in this
   *  file while rendering the old slab's width — found by mutating exactly
   *  that and watching two size assertions stay green. */
  it("sizes the capsule from that property", () => {
    expect(decl(".swipe-panel", "width")).toBe("var(--swipe-panel-w)");
  });

  /** A gutter has to actually remain. Equal to the budget and the control is
   *  flush against the name; this is complaint 2 in the issue stated as a
   *  number rather than as "deliberate space". */
  it("hands part of that budget back to the row as a gutter", () => {
    expect(metric("--swipe-panel-w")).toBeLessThan(28.5 + 13);
  });
});

describe("the delete control's hit area (#91)", () => {
  /** The visible capsule is 32px, well under 44pt. The hit area is therefore
   *  deliberately larger than the thing it deletes — and if it ever shrinks to
   *  the capsule, the control becomes a target nobody can reliably hit. */
  it("is at least a 44pt target across", () => {
    expect(metric("--swipe-hit-w")).toBeGreaterThanOrEqual(44);
  });

  /** Same claim vertically, and the reason the capsule is 56 rather than 44 —
   *  the height is doing double duty as the target's. */
  it("is at least a 44pt target down", () => {
    expect(metric("--swipe-panel-h")).toBeGreaterThanOrEqual(44);
  });

  /** A hit area narrower than the capsule would leave visible red that does
   *  nothing when tapped. */
  it("is never narrower than the capsule it covers", () => {
    expect(metric("--swipe-hit-w")).toBeGreaterThanOrEqual(metric("--swipe-panel-w"));
  });

  /** The alignment, stated once. Both are pinned to the same edge, so neither
   *  can slide off the other — which is precisely what the old arrangement
   *  allowed, with the hit area reading a JavaScript constant and the panel a
   *  CSS literal that happened to equal it. */
  it("shares the capsule's right edge", () => {
    expect(decl(".swipe-hit", "right")).toBe(decl(".swipe-panel", "right"));
  });

  /** And its height, from the same property rather than a second copy of the
   *  number. A target that overhung a 110px row above and below its only
   *  visible control is the mis-tap the fixed height was for. */
  it("takes its height from the capsule's", () => {
    expect(decl(".swipe-hit", "height")).toBe(decl(".swipe-panel", "height"));
  });
});

describe("one quantity, one source (#86, #91)", () => {
  /** **`REVEAL_PX` was three numbers wearing one name** — the finger's travel,
   *  the panel's width, and the hit area's width — and two of them were stated
   *  twice, once in `lib/swipe.ts` and once as an `88px` literal in this
   *  stylesheet. Only the travel is gesture feel; the other two are the shape
   *  of a control and belong here. So no length in the swipe rules may equal
   *  the travel again, whatever the travel becomes. */
  it("never restates the gesture's travel as a CSS length", () => {
    const swipeRules = code.slice(code.indexOf(".swipe {"), code.indexOf(".vh-button"));
    expect(swipeRules).not.toMatch(new RegExp(`(^|[^\\d.])${REVEAL_PX}px`));
  });

  /** The other direction: the component must not learn the capsule's width in
   *  order to animate it. It slides by a percentage of its own box, so the
   *  only number crossing the boundary is how far in the gesture is. */
  it("never states a pixel width in the component", () => {
    expect(tsx).not.toMatch(/width:\s*\d/);
  });
});

describe("the revealed surface (#91, build rules 2 and 9)", () => {
  /** Rule 9. `--accent` is rule 8's, it switches live on Night Athletic, and a
   *  delete affordance that turns gold when you pick gold is not an alert. */
  it("draws the control on --danger", () => {
    expect(decl(".swipe-panel", "background")).toBe("var(--danger)");
  });

  /** Split from the assertion above so a swap to the accent reports as itself
   *  rather than as "the background changed". */
  it("never draws the control on --accent", () => {
    expect(ruleBody(".swipe-panel")).not.toMatch(/var\(--accent/);
  });

  /** Build rule 2: a literal here is invisible to every pack but the one it
   *  was written for, and the three packs' radii differ by 9px. */
  it("takes its radius from a token", () => {
    expect(decl(".swipe-panel", "border-radius")).toMatch(/^var\(--radius-/);
  });

  /** **The affordance is never a bare swatch.** `design/TOKENS.md` records the
   *  measurement: under deuteranopia `--danger` separates from none of the
   *  three accents at any lightness clearing 5.2:1, so the colour cannot carry
   *  a destructive control on its own and the trash glyph is doing real work.
   *  Cheap to delete by accident while restyling; not cheap to notice. */
  it("puts a glyph inside the control", () => {
    const panel = tsx.slice(tsx.indexOf('className="swipe-panel"'), tsx.indexOf("swipe-hit"));
    expect(panel).toMatch(/<svg/);
  });
});

describe("what the control covers (#91)", () => {
  /** **The kcal figure steps aside instead of being covered.** The control is
   *  sized against a three-digit figure (28.5px); a four-digit one is 41.98px
   *  measured at 375, so a 32px capsule flush to the right edge leaves the
   *  leading digit standing beside it. Sizing the control to the widest figure
   *  it might ever cover is how the slab comes back. */
  it("takes the kcal figure out of sight while the row is open", () => {
    expect(decl(".swipe[data-open] .kcal", "opacity")).toBe("0");
  });

  /** Opacity rather than `display` or `visibility`: the figure keeps its box,
   *  so nothing reflows under the panel, and it stays in the accessibility
   *  tree. A layout change here would move the row's content at the exact
   *  moment #91's own UAT finding says it must not move. */
  it("leaves the figure's box in place while it does so", () => {
    expect(ruleBody(".swipe[data-open] .kcal")).not.toMatch(/display\s*:|visibility\s*:/);
  });
});
