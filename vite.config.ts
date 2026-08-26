import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { SHELL_FAMILIES } from "./tools/fetch-fonts.mjs";

const require = createRequire(import.meta.url);

/** The barcode decoder's WebAssembly (#15).
 *
 *  Left to itself, @sec-ant/barcode-detector fetches `zxing_reader.wasm` from
 *  jsdelivr at runtime — a third-party CDN on the critical path of every scan,
 *  which is the same objection #35 raises about the Google Fonts CDN, and
 *  which breaks under a strict CSP or offline.
 *
 *  @sec-ant/zxing-wasm doesn't list the binary in `exports`, so it can't be
 *  named by package specifier at all — not by import, and not by
 *  require.resolve either. What it does export is the reader entry point, and
 *  the binary is emitted beside it (that adjacency is how the package loads it
 *  by default), so resolve the entry and step across.
 *
 *  Resolving through node_modules rather than copying into public/ means an
 *  npm update carries the new binary automatically instead of drifting out of
 *  step with the JS that loads it. src/client/lib/barcode.ts imports this id
 *  with ?url and hands it to the decoder's locateFile hook.
 */
const ZXING_WASM = join(
  dirname(require.resolve("@sec-ant/zxing-wasm/reader")),
  "zxing_reader.wasm",
);

/** Fold the app's stylesheet into index.html instead of linking it (#53).
 *
 *  A `<link rel="stylesheet">` is **render-blocking**: the browser paints
 *  nothing, not even the page background, until it has been fetched and
 *  parsed. It also blocks our module bundle, because module scripts wait on
 *  pending stylesheets. #35 removed the third-party one; this removes the
 *  round trip for our own, so the boot skeleton in index.html can paint from
 *  the single document the browser already has in hand.
 *
 *  The stylesheet is ~6 KB gzipped and is refetched with every navigation
 *  rather than cached separately — a deliberate trade, and the reason this is
 *  worth re-measuring if it ever grows several times over. It also stops being
 *  a fingerprinted asset, so it can no longer go stale against the HTML that
 *  references it, which is one fewer moving part in the mixed-version window
 *  documented in CLAUDE.md.
 *
 *  Only stylesheets index.html actually links are inlined, and each is dropped
 *  from the bundle afterwards so the build doesn't ship the bytes twice.
 */
function inlineStylesheets() {
  return {
    name: "mymacros:inline-stylesheets",
    apply: "build" as const,
    enforce: "post" as const,
    transformIndexHtml: {
      order: "post" as const,
      handler(html: string, ctx: { bundle?: Record<string, { type: string; source?: unknown }> }) {
        const bundle = ctx.bundle;
        if (!bundle) return html;

        return html.replace(
          /<link[^>]*rel="stylesheet"[^>]*href="\/([^"]+\.css)"[^>]*>/g,
          (tag, fileName: string) => {
            const asset = bundle[fileName];
            if (!asset || asset.type !== "asset" || typeof asset.source !== "string") return tag;
            delete bundle[fileName];
            return `<style>${asset.source}</style>`;
          },
        );
      },
    },
  };
}

/** Emit /sw.js with this build's precache manifest baked in (#54).
 *
 *  The worker's logic lives in `src/client/sw.js` — plain, unbundled, readable.
 *  All this does is tell it *what* to cache, which only the build knows,
 *  because every asset name is content-hashed.
 *
 *  Hand-rolled rather than Workbox: the whole job is a file list and three
 *  event handlers, and the house rule is no new dependency without cause.
 *  What Workbox would buy — runtime caching strategies, expiration, background
 *  sync — is precisely the surface this deliberately does not have.
 *
 *  The cache name is a hash of the manifest itself, so a rebuild that changes
 *  no asset reuses the existing cache and re-downloads nothing, while any
 *  change at all produces a new generation that installs whole.
 */
function serviceWorker() {
  /** What the running app needs to boot and render: every emitted code chunk,
   *  and the type. One deliberate exception — `.wasm` is 991 KB the barcode
   *  path fetches only once a scan actually starts.
   *
   *  Note what is *absent* rather than filtered: everything under `public/`
   *  (the icons, the twelve launch images, the manifest) never enters the
   *  bundle at all, so it is not precached and needs no rule saying so. That
   *  is the right outcome and not an accident worth "fixing" — those files are
   *  read by the OS at install time, not by the app at runtime, so caching
   *  100 KB of icons and 1.4 MB of launch images would buy a running app
   *  nothing. An earlier draft of this filter excluded `launch-` explicitly
   *  and looked like it was doing something; it never once matched.
   *
   *  Since #30 the type is filtered too: only the SHELL's families, which are
   *  Night Athletic's. The two light packs bring nine more faces (~175 KB) and
   *  precaching them would put a theme's worth of type most users never pick
   *  into every first launch. `SHELL_FAMILIES` is imported rather than restated
   *  because the failure mode of a second copy is silent in both directions —
   *  a new family never precached, or precached forever. */
  const shellFontSlugs = SHELL_FAMILIES.map((f) => f.toLowerCase().replace(/\s+/g, "-"));
  const isShellFont = (name: string) => {
    const base = name.split("/").pop() ?? name;
    return shellFontSlugs.some((slug) => base.startsWith(`${slug}-`));
  };
  const wanted = (name: string) =>
    name.endsWith(".woff2") ? isShellFont(name) : name.endsWith(".js");

  return {
    name: "mymacros:service-worker",
    apply: "build" as const,
    enforce: "post" as const,
    /* `writeBundle`, not `generateBundle`, and the difference is the whole of
     * #88's fix. The stylesheet is folded into index.html by another plugin's
     * `transformIndexHtml`, which has not run by the time `generateBundle`
     * sees the bundle — so `bundle["index.html"].source` there is the shell
     * *before* the CSS is inlined, and hashing it caught nothing. Verified by
     * experiment: a CSS-only edit left the cache name identical.
     *
     * On disk, after everything is written, there is exactly one index.html
     * and it is the one users receive. Hash that. */
    async writeBundle(options: { dir?: string }, bundle: Record<string, unknown>) {
      const names = Object.keys(bundle);
      // The client build is the one with an index.html; the Worker build must
      // not get a service worker emitted into it.
      if (!names.includes("index.html")) return;

      // "/" and not "/index.html": the asset router 307s the latter, and a
      // redirected response cannot answer a navigation (#87).
      const precache = ["/", ...names.filter(wanted).map((n) => `/${n}`)].sort();

      const source = await readFile(join(import.meta.dirname, "src/client/sw.js"), "utf8");

      /* Three inputs, and each one is here because leaving it out shipped a bug.
       *
       *  - the file LIST, so a new asset hash makes a new generation;
       *  - the worker's own SOURCE, or a logic-only fix reuses the cache it
       *    was written to replace (#87 cached a redirected shell and changed
       *    no asset name);
       *  - the shell's CONTENT (#88). Since #53 the stylesheet is inlined into
       *    index.html, so a CSS-only change alters no filename and no JS hash.
       *    Without this, `sw.js` came out byte-identical, the browser saw no
       *    update, and the cached shell was served **forever** — measured on
       *    device as two deployed fixes that simply never arrived.
       *
       * The rule the third one generalises: a precache generation must be
       * keyed by everything it serves, not by the names of the things it
       * serves. `index.html` is the one entry whose bytes are not summarised
       * by its URL. */
      const dir = options.dir;
      if (!dir) throw new Error("service worker: no output dir (#88)");

      const shellSource = await readFile(join(dir, "index.html"), "utf8");
      // A shell with no inlined stylesheet means the inlining plugin stopped
      // running, and hashing it would silently go back to missing CSS-only
      // changes. Fail the build rather than ship a worker that cannot update.
      if (!shellSource.includes("<style>")) {
        throw new Error("service worker: index.html has no inlined <style> — the hash would miss CSS changes (#88)");
      }

      const cacheName = `mymacros-${createHash("sha256")
        .update(precache.join("\n"))
        .update(source)
        .update(shellSource)
        .digest("hex")
        .slice(0, 12)}`;

      await writeFile(
        join(dir, "sw.js"),
        source
          .replace("__CACHE_NAME__", cacheName)
          .replace("__PRECACHE__", JSON.stringify(precache, null, 2)),
      );
    },
  };
}

/** What build this is, baked in at build time (#137).
 *
 *  On a tag this is the tag (`v0.2.0`); on main it is the tag plus a distance
 *  and a short sha (`v0.2.0-12-gabc1234`); with no tags at all it is the sha.
 *  Everyone on the release channel therefore runs a version they can read back,
 *  which is what makes "the same exact app, run the same exact way" checkable
 *  rather than merely intended.
 *
 *  **Baked, never fetched.** An instance must not phone home to ask what is
 *  current — that leaks the existence and liveness of every deployment and makes
 *  one person's uptime a dependency of everybody else's app. Displaying what you
 *  ARE needs no network; asking what you SHOULD BE does.
 *
 *  Falls back to `package.json` where git is unavailable (a tarball, some CI
 *  checkouts) rather than failing the build over a label. */
function appVersion(): string {
  try {
    const described = execSync("git describe --tags --always --dirty", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (described) return described;
  } catch {
    /* no git, no tags, or a shallow clone — fall through */
  }
  return `v${JSON.parse(readFileSync("package.json", "utf8")).version}`;
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [react(), cloudflare(), inlineStylesheets(), serviceWorker()],
  resolve: {
    // regex rather than a plain string key: the import carries a `?url`
    // suffix, and only the pattern form rewrites the id while leaving the
    // query attached for Vite's asset handling to read
    alias: [{ find: /^virtual:zxing-reader\.wasm/, replacement: ZXING_WASM }],
  },
});
