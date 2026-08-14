import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** #54's worker, asserted on the rules a future edit could quietly break —
 *  each of which fails *silently in production* rather than loudly in CI.
 *
 *  **Reads `src/client/sw.js`, the source, not `dist/client/sw.js`.** The
 *  first draft read the build, which looked stricter and was worse than
 *  useless: `npm run build` is `check && test && vite build`, so a test
 *  reading `dist/` validates the *previous* build every time. #87's fix went
 *  green against the broken output on its first run.
 *
 *  What the build actually produces — the precache list, the cache name, and
 *  whether the cached shell is a redirect — is asserted in
 *  `tools/verify-firstpaint.mjs`, against the live Cache Storage of a browser
 *  that has really installed the worker. That is a stronger check than reading
 *  the emitted text, and it can only run after a build, which is precisely why
 *  it lives there and not here. */
const SW = join(process.cwd(), "src/client/sw.js");
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
  /** #87. Cloudflare's asset router 307s `/index.html` to `/`, so caching that
   *  URL stores a redirected response — and a redirected response cannot
   *  answer a navigation. Safari refuses the page outright, which bricks the
   *  installed app rather than degrading it. The shell must be the URL that
   *  answers 200. */
  it("caches the shell at / rather than at the URL that redirects", () => {
    expect(code(source)).toContain('const SHELL = "/"');
  });

  /** The guard that turns a poisoned cache — written by some earlier worker,
   *  or by a host that redirects for its own reasons — into a slow launch
   *  instead of an app that cannot open. */
  it("refuses to answer a navigation with a redirected response", () => {
    expect(code(source)).toMatch(/hit && !hit\.redirected/);
  });

  /** 991 KB of WebAssembly the barcode path fetches only when a scan starts,
   *  and 1.4 MB of launch images iOS reads once at install, outside the
   *  worker. Precaching either spends a phone's storage on bytes almost no
   *  launch reads — and nothing about the app would look wrong afterwards,
   *  which is exactly why it needs a test rather than a comment. */
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
