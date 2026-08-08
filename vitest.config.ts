import { defineConfig } from "vitest/config";

/** Deliberately its own config rather than test options bolted onto
 *  `vite.config.ts`.
 *
 *  That file loads `@cloudflare/vite-plugin`, which boots a workerd dev
 *  environment. These are tests of pure arithmetic and string handling — they
 *  need Node and nothing else, and paying workerd's startup on every run is
 *  how a fast test suite stops being run. Defining this file overrides
 *  `vite.config.ts` outright, so none of that plugin chain loads.
 *
 *  The cost of the split: aliases declared over there don't exist here (today
 *  that is `virtual:zxing-reader.wasm`, #15). Nothing under test imports it —
 *  if something ever does, that is the signal it wants a browser-ish
 *  environment, not that this file should grow the alias.
 *
 *  Route-level tests against a real D1 binding are a different tool
 *  (`@cloudflare/vitest-pool-workers`) and a different config — see #47.
 */
export default defineConfig({
  test: {
    // colocated `foo.test.ts` beside `foo.ts`: the existing tsconfigs already
    // include src/client and src/worker, so `npm run check` type-checks the
    // tests too without a fourth project
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
