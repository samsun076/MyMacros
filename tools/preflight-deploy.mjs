#!/usr/bin/env node
// Refuse a deploy that would replace somebody else's instance (#127).
//
// Runs as part of `npm run deploy`. Skip it with `--force` when you genuinely
// mean to repoint a Worker at a different database.
//
// ## The failure
//
// A self-hoster who already runs one instance wants a second — a spouse, a kid,
// a test box. They clone again and deploy:
//
//   wrangler d1 create mymacros-db          → fails, name taken. Natural friction.
//   wrangler r2 bucket create mymacros-photos → fails. Natural friction.
//   …they rename those two, FORGET the Worker name, and
//   wrangler deploy                          → replaces instance 1. Exit 0. Silent.
//
// Instance 1's owner then opens the app and is served instance 2's database.
// Their data is not deleted — it is orphaned behind a Worker that no longer
// points at it, which is worse, because the app looks alive and belongs to
// someone else.
//
// **Note the shape.** The two commands that would have caught it fail safely;
// the one that destroys the arrangement succeeds quietly. Same family as #106
// and #129: the loud commands are the safe ones.
//
// This is M6 rather than tidiness because the settled model is one Cloudflare
// account per instance — so the author's account will never hold two, and this
// is a failure he structurally cannot encounter. Documentation cannot be the
// only thing standing there.

import { execFileSync } from "node:child_process";
import { readWranglerConfig } from "./wrangler-config.mjs";

const force = process.argv.includes("--force");
const config = readWranglerConfig();

const say = (s = "") => console.log(s);

function wrangler(args) {
  try {
    return {
      ok: true,
      out: execFileSync("npx", ["wrangler", ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

say(`preflight: ${config.name} → D1 ${config.databaseId ?? "(none)"}`);

if (!config.databaseId) {
  say("  no d1_databases[0].database_id in wrangler.jsonc — nothing to compare, continuing");
  process.exit(0);
}

const versions = wrangler(["versions", "list", "--json"]);

// A Worker that does not exist yet is the ordinary first deploy, and the only
// signal for it is this error code. Treated as "proceed" rather than "fail",
// because refusing a first deploy would make the guard the thing that stops a
// stranger getting started.
if (!versions.ok) {
  if (/does not exist on your account|10007/.test(versions.out)) {
    say(`  no Worker named "${config.name}" on this account yet — first deploy, continuing`);
    process.exit(0);
  }
  // Anything else — not logged in, network, an account with no access — is not
  // something to guess about. Say what happened and let the deploy proceed;
  // wrangler is about to make the same call and will fail more precisely.
  say("  could not list versions; wrangler will report the real error:");
  say(`    ${versions.out.trim().split("\n").slice(-2).join(" ").slice(0, 200)}`);
  process.exit(0);
}

let latest;
try {
  const list = JSON.parse(versions.out);
  latest = list.at(-1)?.id;
} catch {
  say("  could not parse the version list — continuing");
  process.exit(0);
}
if (!latest) {
  say("  Worker exists but has no versions — continuing");
  process.exit(0);
}

const view = wrangler(["versions", "view", latest, "--json"]);
if (!view.ok) {
  say("  could not read the live version's bindings — continuing");
  process.exit(0);
}

let liveDb = null;
let liveUrl = null;
try {
  const bindings = JSON.parse(view.out)?.resources?.bindings ?? [];
  liveDb = bindings.find((b) => b.type === "d1")?.database_id ?? null;
  liveUrl = bindings.find((b) => b.name === "APP_URL")?.text ?? null;
} catch {
  say("  could not parse the live bindings — continuing");
  process.exit(0);
}

if (!liveDb) {
  say("  the live Worker has no D1 binding — continuing");
  process.exit(0);
}

if (liveDb === config.databaseId) {
  say(`  live Worker is bound to the same database — this is an update, continuing`);
  process.exit(0);
}

// The refusal. Everything above this line proceeds; only an actual mismatch
// stops a deploy, so the guard cannot become the reason someone gives up.
say();
say("╭─ REFUSING TO DEPLOY ─────────────────────────────────────────");
say(`│ A Worker named "${config.name}" already exists on this Cloudflare`);
say("│ account, and it is bound to a DIFFERENT database.");
say("│");
say(`│   live   ${liveDb}${liveUrl ? `   (${liveUrl})` : ""}`);
say(`│   yours  ${config.databaseId}${config.appUrl ? `   (${config.appUrl})` : ""}`);
say("│");
say("│ Deploying would replace that instance with this one. Its data is");
say("│ not deleted, but nothing would point at it any more, and its owner");
say("│ would open the app and be served your database.");
say("│");
say("│ If you are standing up a SECOND instance, change `name` in");
say("│ wrangler.jsonc — renaming the D1 and R2 resources is not enough,");
say("│ and forgetting the Worker name is the whole of this failure.");
say("│");
say("│ If you really mean to repoint this Worker:");
say("│   npm run deploy -- --force");
say("╰──────────────────────────────────────────────────────────────");
say();

if (force) {
  say("--force given — continuing anyway.");
  process.exit(0);
}
process.exit(1);
