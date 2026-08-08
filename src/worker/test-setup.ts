import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { applyD1Migrations, env } from "cloudflare:test";

/** Route tests run against the real migrations, not a fixture schema.
 *
 *  A hand-written CREATE TABLE in a test file is a second source of truth for
 *  the schema, and its failure mode is the worst kind: the tests keep passing
 *  after a migration changes production, because they were never describing
 *  production. `migrations/` is append-only (CLAUDE.md), so reading it is
 *  cheap and always current — vitest.config.ts loads it at config time and
 *  hands it in as the TEST_MIGRATIONS binding.
 *
 *  Cast locally rather than declaring TEST_MIGRATIONS on `Cloudflare.Env`.
 *  That interface is global and merges, so adding it there would let a route
 *  handler type-check `c.env.TEST_MIGRATIONS` and then find nothing at
 *  runtime in production. A binding that exists only in tests should only be
 *  visible in tests. */
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(env.DB, TEST_MIGRATIONS);
