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

/** Reading the REAL `wrangler.jsonc`, and asserting its SHAPE rather than its
 *  identity (#144).
 *
 *  Still the real file, not a fixture — that reasoning was right and is
 *  unchanged: a fixture proves the parser can read a file written for it, which
 *  is not the claim. What changed is what is asserted about it.
 *
 *  **These used to pin `"mymacros"` and `"fuel.debrief.run"` as literals**, and
 *  every one of those values is something `install.md` §2.2 explicitly instructs
 *  a self-hoster to change. So editing the four documented fields turned
 *  `npm test` red — and since `npm run deploy` is `preflight && build && deploy`
 *  and `build` runs `npm test`, **the documented install procedure could not
 *  complete for anybody but this deployment.** The failure named a hostname, so
 *  nothing in the output suggested the tests and the install guide disagreed.
 *
 *  It survived because the repo has zero forks: the procedure had been read and
 *  reviewed and never once executed by a stranger. CLAUDE.md's own rule — a
 *  bound that has never been reached has never been tested.
 *
 *  The correct form was already sitting one test down: `databaseId` asserts a
 *  UUID *pattern*, never this deployment's id.
 *
 *  **The trap in the other direction:** a shape assertion loose enough to accept
 *  anything is worse than a pinned one, because it passes on a config the parser
 *  mangled. Every assertion below is one that a broken strip actually breaks —
 *  verified by breaking `stripJsonComments` and watching this block go red, not
 *  by assuming it. */
describe("readWranglerConfig", () => {
  // Read INSIDE each test, not at describe time. A parse failure at collection
  // aborts the whole block and vitest reports "no tests" — the file goes red,
  // but every assertion is neither green nor red, which is the shape CLAUDE.md
  // warns about: a run that looks executed and told you about nothing. Called
  // per-test, a broken parser produces named failures instead.
  const read = () => readWranglerConfig("wrangler.jsonc");

  it("reads the real wrangler.jsonc into the right shape", () => {
    const config = read();
    // Non-empty strings, not specific ones. A parser that eats the rest of the
    // file at the first `//` inside a URL returns undefined here.
    for (const key of ["name", "databaseName", "bucket", "appUrl"]) {
      expect(typeof config[key], `${key} should be a string`).toBe("string");
      expect(config[key].length, `${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("reads an app URL that is a real https URL", () => {
    const config = read();
    // The `//` in `https://` is the exact case the naive stripper destroys, so
    // this is the assertion that catches it — without caring whose host it is.
    const url = new URL(config.appUrl);
    expect(url.protocol).toBe("https:");
    expect(url.hostname.length).toBeGreaterThan(0);
  });

  it("reads a database id that looks like one", () => {
    const config = read();
    expect(config.databaseId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("reads the routes, or accepts their absence on the workers.dev path", () => {
    const config = read();
    // `install.md` documents deleting `routes` entirely and setting
    // `workers_dev: true` — the path a self-hoster with no domain takes, and the
    // likeliest one for a first instance. Asserting `routes[0].pattern` equals
    // anything at all fails for them before their first deploy.
    if (config.routes === undefined) return;
    expect(Array.isArray(config.routes)).toBe(true);
    for (const route of config.routes) {
      expect(typeof route.pattern).toBe("string");
      expect(route.pattern.length).toBeGreaterThan(0);
    }
  });
});
