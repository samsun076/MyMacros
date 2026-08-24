import { describe, expect, it } from "vitest";
import { readWranglerConfig, stripJsonComments } from "./wrangler-config.mjs";

/** The oracle that makes a hand-rolled JSONC strip acceptable (#127).
 *
 *  Every case here is one this parser would get wrong if written the obvious
 *  way, and the first is the one that actually appears in `wrangler.jsonc`. */
describe("stripJsonComments", () => {
  const parse = (s) => JSON.parse(stripJsonComments(s));

  it("leaves `//` alone inside a string — the case the real file contains", () => {
    // A naive stripper turns this into `{"url": "https:` and eats the rest of
    // the config. `APP_URL` and every comment mentioning a URL is this case.
    expect(parse('{"url": "https://fuel.debrief.run"}')).toEqual({
      url: "https://fuel.debrief.run",
    });
  });

  it("handles an escaped quote before a comment marker", () => {
    expect(parse('{"a": "say \\"hi\\"" /* c */, "b": 1}')).toEqual({ a: 'say "hi"', b: 1 });
  });

  it("strips line and block comments", () => {
    expect(parse('{\n // one\n "a": 1, /* two */ "b": 2\n}')).toEqual({ a: 1, b: 2 });
  });

  it("keeps a `/*` that is inside a string", () => {
    expect(parse('{"a": "/* not a comment */", "b": 2}')).toEqual({
      a: "/* not a comment */",
      b: 2,
    });
  });

  it("allows trailing commas, which wrangler accepts", () => {
    expect(parse('{"a": [1, 2,], "b": 2,}')).toEqual({ a: [1, 2], b: 2 });
  });

  it("preserves line count, so a JSON error points at the right line", () => {
    const src = '{\n// a\n// b\n"x": 1\n}';
    expect(stripJsonComments(src).split("\n").length).toBe(src.split("\n").length);
  });
});

describe("readWranglerConfig", () => {
  const config = readWranglerConfig("wrangler.jsonc");

  it("reads the real wrangler.jsonc", () => {
    // Pinned against the actual file rather than a fixture: a fixture would
    // prove the parser can read a file I wrote for it, which is not the claim.
    expect(config.name).toBe("mymacros");
    expect(config.databaseName).toBe("mymacros-db");
    expect(config.bucket).toBe("mymacros-photos");
    expect(config.appUrl).toBe("https://fuel.debrief.run");
  });

  it("reads a database id that looks like one", () => {
    expect(config.databaseId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("reads the routes, which is where the second instance's host lives", () => {
    expect(Array.isArray(config.routes)).toBe(true);
    expect(config.routes[0]?.pattern).toBe("fuel.debrief.run");
  });
});
