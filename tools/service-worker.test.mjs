import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** #54's worker is generated, so the things worth testing are the ones a
 *  future edit could quietly get wrong — and every one of them fails *silently*
 *  in production rather than loudly in CI.
 *
 *  Read from the built output rather than re-implementing the plugin: the
 *  question is what actually shipped, and a test that recomputes the manifest
 *  the same way the plugin does would agree with a broken plugin. Skips
 *  cleanly when there is no build, so `npm test` stays fast and standalone. */
const SW = join(process.cwd(), "dist/client/sw.js");
const source = (() => {
  try {
    return readFileSync(SW, "utf8");
  } catch {
    return null;
  }
})();

const precache = () => JSON.parse(source.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);

/** Assertions about *code* have to read code. The worker explains its own
 *  rules in prose right beside them — "No skipWaiting", "Never touch /api" —
 *  so a bare substring search finds the explanation and reports the rule
 *  broken while it is being kept. Caught by exactly that, twice now; the
 *  earlier one was in tools/fetch-fonts.test.mjs. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe.skipIf(!source)("generated service worker", () => {
  it("bakes in a real cache name, not the placeholder", () => {
    expect(source).not.toContain("__CACHE_NAME__");
    expect(source).not.toContain("__PRECACHE__");
    expect(source).toMatch(/const CACHE = "mymacros-[0-9a-f]{12}"/);
  });

  it("precaches the shell, the code and the fonts", () => {
    const list = precache();
    expect(list).toContain("/index.html");
    expect(list.filter((f) => f.endsWith(".js")).length).toBeGreaterThan(0);
    expect(list.filter((f) => f.endsWith(".woff2"))).toHaveLength(7);
  });

  /** 991 KB of WebAssembly the barcode path fetches only when a scan starts,
   *  and 1.4 MB of launch images iOS reads once at install, outside the
   *  worker. Precaching either spends a phone's storage on bytes almost no
   *  launch reads — and nothing about the app would look wrong afterwards,
   *  which is exactly why it needs a test rather than a comment. */
  it("precaches neither the wasm nor the launch images", () => {
    const list = precache();
    expect(list.filter((f) => f.endsWith(".wasm"))).toEqual([]);
    expect(list.filter((f) => f.includes("launch-"))).toEqual([]);
  });

  it("caches no API response", () => {
    expect(precache().filter((f) => f.startsWith("/api"))).toEqual([]);
  });

  /** The rule that is not about bytes. `/api/auth/callback/google?code=…` is a
   *  real server-side navigation, and answering it from the shell is the
   *  outage Session B2 spent most of a day on — better-auth never saw the
   *  code, so there was no session, no user, no error and no log line. The
   *  `return` has to come before the navigate branch or the bug comes back
   *  wearing a service worker. */
  it("bails out of /api before it can answer a navigation from the shell", () => {
    const body = code(source);
    const apiGuard = body.indexOf('url.pathname.startsWith("/api/")');
    const navigate = body.indexOf('request.mode === "navigate"');
    expect(apiGuard).toBeGreaterThan(-1);
    expect(navigate).toBeGreaterThan(-1);
    expect(apiGuard).toBeLessThan(navigate);
  });

  /** The update flow is "on next launch": a new worker installs and waits.
   *  skipWaiting in `install` would make every deploy able to reload the page
   *  under someone mid-meal — the one behaviour the decision ruled out. It is
   *  allowed only in the message handler, which Settings alone triggers. */
  it("never skips waiting except when Settings asks", () => {
    const body = code(source);
    const install = body.slice(
      body.indexOf('addEventListener("install"'),
      body.indexOf('addEventListener("activate"'),
    );
    expect(install).not.toContain("skipWaiting");
    expect(body).toMatch(/type === "SKIP_WAITING"[\s\S]*?skipWaiting/);
  });

  it("drops caches from older generations on activate", () => {
    const body = code(source);
    const activate = body.slice(
      body.indexOf('addEventListener("activate"'),
      body.indexOf('addEventListener("fetch"'),
    );
    expect(activate).toContain("caches.delete");
  });

  it("leaves non-GET requests alone", () => {
    expect(source).toContain('request.method !== "GET"');
  });
});
