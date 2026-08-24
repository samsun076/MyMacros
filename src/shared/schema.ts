/** What migration this build of the code expects the database to have (#129).
 *
 *  Deploying is one command and migrating is another. Get them in the wrong
 *  order — or skip the second — and the Worker boots, the SPA loads, D1 answers
 *  every query, `/api/health` says `db: true`, and then the first request
 *  touching a new column 500s with nothing anywhere saying the database is
 *  three migrations behind. That is this project's house failure shape: a
 *  plausible, coherent, wrong success, the same family as #106's stale
 *  `db:studio` and #127's silent overwrite. The commands that fail loudly are
 *  safe; the one that leaves a half-updated system succeeds quietly.
 *
 *  ---
 *
 *  **This is a hand-written constant, and CLAUDE.md's register says a literal
 *  restating something else is exactly how these rot.** It is written that way
 *  anyway, deliberately, and the reason is worth recording because the obvious
 *  alternative was tried first and does not work.
 *
 *  The first cut derived it at build time — `readdirSync("./migrations")` in a
 *  Vite `define`, so it *could not* drift. It failed under test: the Cloudflare
 *  vitest pool bundles the Worker through its own plugin and neither a root
 *  nor a per-project `define` reaches it, so `__EXPECTED_MIGRATION__` arrived
 *  as `undefined` in a route test — the value whose entire job is to be
 *  trustworthy, silently absent in the only place that checks it.
 *
 *  So the guarantee moves from a mechanism to an oracle. `schema.test.ts`
 *  reads `migrations/` off disk and fails if this string is not the newest file
 *  there. `npm test` gates `npm run build`, which gates the deploy — so the
 *  constant cannot reach production disagreeing with the directory. That is the
 *  same guarantee the `define` promised, delivered by something that runs
 *  everywhere the code does.
 *
 *  **When you add a migration, change this line.** The test will tell you if
 *  you forget, before the build finishes.
 */
export const EXPECTED_MIGRATION = "0010_run_source_neutral.sql";
