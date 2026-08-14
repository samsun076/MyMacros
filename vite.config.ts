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

export default defineConfig({
  plugins: [react(), cloudflare(), inlineStylesheets()],
  resolve: {
    // regex rather than a plain string key: the import carries a `?url`
    // suffix, and only the pattern form rewrites the id while leaving the
    // query attached for Vite's asset handling to read
    alias: [{ find: /^virtual:zxing-reader\.wasm/, replacement: ZXING_WASM }],
  },
});
