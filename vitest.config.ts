import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/** Two projects, one `npm test`.
 *
 *  **unit** — pure functions in plain Node. Deliberately not run through
 *  `vite.config.ts`: that file loads `@cloudflare/vite-plugin`, which boots
 *  workerd, and paying that startup to test arithmetic is how a fast suite
 *  stops being run. 60-odd tests in ~150ms.
 *
 *  **worker** — route tests inside real workerd, against a real D1 with the
 *  real migrations applied. This is the half that can answer "does this route
 *  refuse the wrong caller?", which no amount of pure-function testing
 *  reaches. It costs seconds rather than milliseconds to start, which is
 *  exactly why it is a separate project and not the default for everything.
 *
 *  The split is by filename: `foo.test.ts` is a unit test, `foo.route.test.ts`
 *  runs in the Worker. Both are colocated with their source, and the existing
 *  tsconfigs already cover src/, so `npm run check` type-checks both.
 *
 *  The cost of not extending `vite.config.ts`: aliases declared there don't
 *  exist here (today that is `virtual:zxing-reader.wasm`, #15). Nothing under
 *  test imports it.
 */

// Read at config time and handed to the Worker as a binding — the setup file
// applies them, so every route test starts against the same schema production
// has rather than a hand-maintained fixture that drifts from migrations/.
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.route.test.ts"],
          environment: "node",
        },
      },
      {
        // v4 of the pool is a Vite plugin rather than the old
        // `defineWorkersProject` wrapper — the `/config` subpath it used to
        // live on no longer exists in the package
        plugins: [
          cloudflareTest({
            // bindings come from the real wrangler config, so a route test
            // sees the same DB/PHOTOS/vars shape production does
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
          }),
        ],
        test: {
          name: "worker",
          include: ["src/**/*.route.test.ts"],
          setupFiles: ["./src/worker/test-setup.ts"],
        },
      },
    ],
  },
});
