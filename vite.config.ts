import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
   *  and looked like it was doing something; it never once matched. */
  const wanted = (name: string) =>
    !name.endsWith(".wasm") && (name.endsWith(".js") || name.endsWith(".woff2"));

  return {
    name: "mymacros:service-worker",
    apply: "build" as const,
    enforce: "post" as const,
    async generateBundle(
      this: { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void },
      _options: unknown,
      bundle: Record<string, unknown>,
    ) {
      const names = Object.keys(bundle);
      // The client build is the one with an index.html; the Worker build must
      // not get a service worker emitted into it.
      if (!names.includes("index.html")) return;

      // "/" and not "/index.html": the asset router 307s the latter, and a
      // redirected response cannot answer a navigation (#87).
      const precache = ["/", ...names.filter(wanted).map((n) => `/${n}`)].sort();

      const source = await readFile(join(import.meta.dirname, "src/client/sw.js"), "utf8");
      // Hashed over the worker's SOURCE as well as the file list. Hashing the
      // list alone means a logic-only fix reuses the existing cache — and the
      // case where that matters most is a worker shipped with a bug, whose
      // entries are exactly what must be thrown away (#87 cached a redirected
      // shell; the fix changed no asset name).
      const cacheName = `mymacros-${createHash("sha256")
        .update(precache.join("\n"))
        .update(source)
        .digest("hex")
        .slice(0, 12)}`;

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: source
          .replace("__CACHE_NAME__", cacheName)
          .replace("__PRECACHE__", JSON.stringify(precache, null, 2)),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), inlineStylesheets(), serviceWorker()],
  resolve: {
    // regex rather than a plain string key: the import carries a `?url`
    // suffix, and only the pattern form rewrites the id while leaving the
    // query attached for Vite's asset handling to read
    alias: [{ find: /^virtual:zxing-reader\.wasm/, replacement: ZXING_WASM }],
  },
});
