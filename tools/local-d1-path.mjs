import { createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { readWranglerConfig } from "./wrangler-config.mjs";

/** Where the local D1 database actually is (#106).
 *
 *  `npm run dev` and `npm run db:migrate` share one sqlite file under
 *  `.wrangler/state/v3/d1/`, and *which* file is keyed by `database_id` in
 *  `wrangler.jsonc` — CLAUDE.md's own gotcha. `db:studio` used to ignore that
 *  and open whatever `find … | head -1` returned, which on this machine was a
 *  database last written on 4 August whose schema stopped at 0005. It reported
 *  a coherent, plausible, wrong answer and exited 0.
 *
 *  **Sorting by mtime is not the fix**: `metadata.sqlite` lives in the same
 *  directory, and newest-first is still a guess that is right only while
 *  someone recently used the file you wanted. So this resolves the name the
 *  way miniflare does.
 *
 *  Miniflare stores each D1 database as a Durable Object whose id is derived
 *  from the namespace's unique key and the database id, workerd-style:
 *  `key = sha256(uniqueKey)`, then `hmac(key, name)[0..16] ‖ hmac(key, that)[0..16]`.
 *  Not read out of a miniflare export — none is public — but **measured against
 *  the live file**: `4cf59eaf-…` in `wrangler.jsonc` resolves to
 *  `edc49429…bd2.sqlite`, the file `db:migrate` has been writing since 0006,
 *  and `local-d1-path.test.mjs` pins that pair so a miniflare upgrade that
 *  changes the scheme fails a test instead of reopening this issue.
 */
export const D1_UNIQUE_KEY = "miniflare-D1DatabaseObject";

export function durableObjectIdFromName(uniqueKey, name) {
  const key = createHash("sha256").update(uniqueKey).digest();
  const nameHmac = createHmac("sha256", key).update(name).digest().subarray(0, 16);
  const check = createHmac("sha256", key).update(nameHmac).digest().subarray(0, 16);
  return Buffer.concat([nameHmac, check]).toString("hex");
}

export function localD1Path(databaseId, root = ".wrangler/state/v3/d1") {
  return `${root}/${D1_UNIQUE_KEY}/${durableObjectIdFromName(D1_UNIQUE_KEY, databaseId)}.sqlite`;
}

// CLI: print the path, or refuse loudly. A studio that opens nothing is a bad
// afternoon; one that opens the wrong thing silently is a wrong conclusion
// carried into a commit message.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { databaseId } = readWranglerConfig();
  if (!databaseId) {
    console.error("local-d1-path: no d1_databases[0].database_id in wrangler.jsonc");
    process.exit(1);
  }
  const path = localD1Path(databaseId);
  if (!existsSync(path)) {
    console.error(`local-d1-path: ${path} does not exist for database_id ${databaseId}.`);
    console.error("  Run `npm run dev` or `npm run db:migrate` once to create it.");
    process.exit(1);
  }
  console.log(path);
}
