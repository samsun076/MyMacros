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

export default defineConfig({
  plugins: [react(), cloudflare()],
  resolve: {
    // regex rather than a plain string key: the import carries a `?url`
    // suffix, and only the pattern form rewrites the id while leaving the
    // query attached for Vite's asset handling to read
    alias: [{ find: /^virtual:zxing-reader\.wasm/, replacement: ZXING_WASM }],
  },
});
