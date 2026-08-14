import { describe, expect, it } from "vitest";
import {
  assertNoDuplicateFaces,
  fileNameFor,
  GOOGLE_FONTS_CSS,
  latinOnly,
  parseFaces,
  renderCss,
  SHELL_FAMILIES,
} from "./fetch-fonts.mjs";

/** #35's tool turns Google's stylesheet into ours. The properties worth
 *  testing are the ones whose failure is *silent* — a face that quietly loses
 *  an axis, a subset that quietly comes back, or a URL that quietly still
 *  points at the CDN we just spent the issue leaving.
 *
 *  The fixture is a trimmed copy of a real CSS2 response (Archivo variable +
 *  one Barlow weight), kept verbatim in shape so a change to Google's output
 *  format shows up here rather than as seven missing files. */
const CSS2_RESPONSE = `/* vietnamese */
@font-face {
  font-family: 'Archivo';
  font-style: normal;
  font-weight: 100 900;
  font-stretch: 62% 125%;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/archivo/v25/VIET.woff2) format('woff2');
  unicode-range: U+0102-0103, U+0110-0111, U+1EA0-1EF9, U+20AB;
}
/* latin-ext */
@font-face {
  font-family: 'Archivo';
  font-style: normal;
  font-weight: 100 900;
  font-stretch: 62% 125%;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/archivo/v25/LATINEXT.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1E00-1E9F, U+2C60-2C7F, U+A720-A7FF;
}
/* latin */
@font-face {
  font-family: 'Archivo';
  font-style: normal;
  font-weight: 100 900;
  font-stretch: 62% 125%;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/archivo/v25/LATIN.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F, U+20AC, U+2212, U+FFFD;
}
/* latin */
@font-face {
  font-family: 'Barlow Condensed';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/barlowcondensed/v13/BC700.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+2000-206F, U+20AC, U+2212, U+FFFD;
}
`;

const faces = () => latinOnly(parseFaces(CSS2_RESPONSE));

describe("parseFaces", () => {
  it("reads every face, not just the first", () => {
    expect(parseFaces(CSS2_RESPONSE)).toHaveLength(4);
  });

  it("keeps the declarations we re-emit", () => {
    expect(parseFaces(CSS2_RESPONSE)[0]).toMatchObject({
      family: "Archivo",
      style: "normal",
      weight: "100 900",
      stretch: "62% 125%",
    });
  });
});

describe("latinOnly", () => {
  it("drops the subsets we don't ship", () => {
    const kept = faces();
    expect(kept).toHaveLength(2);
    expect(kept.map((f) => f.src)).toEqual([
      "https://fonts.gstatic.com/s/archivo/v25/LATIN.woff2",
      "https://fonts.gstatic.com/s/barlowcondensed/v13/BC700.woff2",
    ]);
  });

  /** Three subsets of one family are byte-different files with identical
   *  family/style/weight, so a filter that misfires produces *name
   *  collisions*, not an error — the last write wins and the app silently
   *  ships vietnamese glyph coverage for its body font. */
  it("leaves one face per family and weight, so no two files collide", () => {
    const names = faces().map(fileNameFor);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("fileNameFor", () => {
  it.each([
    [{ family: "Archivo", weight: "100 900", style: "normal" }, "archivo-variable.woff2"],
    [
      { family: "Barlow Condensed", weight: "700", style: "normal" },
      "barlow-condensed-700.woff2",
    ],
    [{ family: "IBM Plex Mono", weight: "400", style: "italic" }, "ibm-plex-mono-400-italic.woff2"],
  ])("%o → %s", (face, name) => {
    expect(fileNameFor(face)).toBe(name);
  });
});

describe("renderCss", () => {
  /** The whole point of #35. If anything here ever emits a gstatic URL again,
   *  first paint silently goes back to waiting on a third party's DNS and TLS
   *  and the app stops being precacheable (#54) — with every screen still
   *  rendering perfectly on a warm connection, which is why a human would not
   *  notice. */
  it("points at no third-party host", () => {
    const css = renderCss(faces());
    expect(css).not.toMatch(/gstatic|googleapis|https?:/);
    expect(css).toContain('src: url("./fonts/archivo-variable.woff2") format("woff2")');
  });

  /** Archivo's width axis is load-bearing for the eyebrow/label style. Lose it
   *  on a refresh and every label on every screen reflows by a hair at once —
   *  visible nowhere in particular and wrong everywhere. */
  it("carries Archivo's variable weight and width axes through", () => {
    const css = renderCss(faces());
    expect(css).toContain("font-weight: 100 900;");
    expect(css).toContain("font-stretch: 62% 125%;");
  });

  it("omits font-stretch for faces that have none", () => {
    const barlow = renderCss([faces()[1]]);
    expect(barlow).not.toContain("font-stretch");
  });

  /** Documented as deliberate in the tool's header: with one subset per face
   *  the range decides nothing, so shipping it would be a rule that looks like
   *  it is doing something.
   *
   *  Asserted against the *declarations* rather than the whole file, because
   *  the generated header explains the omission in prose and a bare substring
   *  match reads that explanation as the thing it forbids. Caught by this test
   *  failing on its first run, which is the only evidence it can fail. */
  it("emits no unicode-range declaration", () => {
    const declarations = renderCss(faces()).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations).not.toContain("unicode-range");
  });

  it("keeps font-display: swap on every face", () => {
    const css = renderCss(faces());
    expect(css.match(/font-display: swap;/g)).toHaveLength(2);
  });
});

describe("GOOGLE_FONTS_CSS", () => {
  /** The type spec is stated once and this is the assertion that it still
   *  says what the frozen sketches need — the wdth axis especially, which is
   *  the one a "simplifying" edit would drop. */
  it("requests the three families with the axes the token pack uses", () => {
    expect(GOOGLE_FONTS_CSS).toContain("family=Archivo:wdth,wght@62..125,100..900");
    expect(GOOGLE_FONTS_CSS).toContain("family=Barlow+Condensed:wght@400;500;600;700");
    expect(GOOGLE_FONTS_CSS).toContain("family=IBM+Plex+Mono:wght@400;500");
  });

  /** #30's light packs. The shell list is what the service worker precaches,
   *  and every family in it must actually be requested or the precache filter
   *  silently matches nothing. */
  it("requests the light packs' families too, and every shell family is one of them", () => {
    expect(GOOGLE_FONTS_CSS).toContain("family=Alegreya+Sans:wght@400;500;700");
    expect(GOOGLE_FONTS_CSS).toContain("family=Courier+Prime:wght@400;700");
    expect(GOOGLE_FONTS_CSS).toContain("family=Fragment+Mono");
    for (const family of SHELL_FAMILIES) {
      expect(GOOGLE_FONTS_CSS, `${family} is precached but never fetched`).toContain(
        `family=${family.replace(/\s+/g, "+")}`,
      );
    }
  });

  /** Instrument Sans is variable. Asked for `400;500;600;700` it answers with
   *  four blocks pointing at the same file — see assertNoDuplicateFaces. */
  it("asks variable families for a range, not a weight list", () => {
    expect(GOOGLE_FONTS_CSS).toContain("family=Instrument+Sans:wght@400..700");
    expect(GOOGLE_FONTS_CSS).not.toContain("Instrument+Sans:wght@400;");
  });
});

describe("assertNoDuplicateFaces (#30)", () => {
  it("passes when every file is its own font", () => {
    const files = new Map([
      ["a-400.woff2", Buffer.from("alpha")],
      ["a-700.woff2", Buffer.from("beta")],
    ]);
    expect(() => assertNoDuplicateFaces(files)).not.toThrow();
  });

  /** The exact shape of the Instrument Sans mistake: four names, four blocks,
   *  four plausible sizes, one font. Everything looks right. */
  it("refuses four names for one variable file, and names them", () => {
    const same = Buffer.from("one variable file");
    const files = new Map(
      ["400", "500", "600", "700"].map((w) => [`instrument-sans-${w}.woff2`, same]),
    );
    expect(() => assertNoDuplicateFaces(files)).toThrow(/instrument-sans-400\.woff2 =/);
    expect(() => assertNoDuplicateFaces(files)).toThrow(/wght@400\.\.700/);
  });
});
