import { Hono } from "hono";
import type { AuthMethods, Health } from "../shared/api";
import { EXPECTED_MIGRATION } from "../shared/schema";
import { createAuth } from "./auth";
import { requireAuth } from "./middleware/auth";
import analyze from "./routes/analyze";
import barcode from "./routes/barcode";
import day from "./routes/day";
import favorites from "./routes/favorites";
import foodLogs from "./routes/food-logs";
import me from "./routes/me";
import photos from "./routes/photos";
import sync from "./routes/sync";
import syncTokens from "./routes/sync-tokens";
import trends from "./routes/trends";
import weights from "./routes/weights";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// ── public ───────────────────────────────────────────────────
const open = new Hono<AppEnv>();

/** Liveness, binding check, and whether the schema is as new as the code (#129).
 *
 *  **`ok` used to be the literal `true`.** It said the Worker was running,
 *  which is never in doubt by the time anyone can read the answer. Deploying is
 *  one command and migrating is another, so the interesting question is whether
 *  the second was run — and a database three migrations behind is *perfectly
 *  healthy*, answers every query, and reports `db: true`. It then 500s on the
 *  first request touching a new column, with nothing anywhere saying why. That
 *  is this project's house failure shape: a plausible, coherent, wrong success,
 *  the same family as #106 and #127.
 *
 *  `EXPECTED_MIGRATION` is a constant in `src/shared/schema.ts` held true by a
 *  test that reads `migrations/` off disk; that file records why it is an
 *  oracle rather than a build-time read, which was tried first and does not
 *  survive the Cloudflare test pool.
 *
 *  It **reports** rather than refuses. A Worker that returned 503 until someone
 *  migrated would turn a partial outage into a total one, and the screens that
 *  do not touch the new column work fine. This is what a deploy script, an
 *  install directive, or a person with curl can look at. */
open.get("/health", async (c) => {
  let db = false;
  let migration: string | null = null;
  try {
    const row = await c.env.DB.prepare(
      "select name from d1_migrations order by id desc limit 1",
    ).first<{ name: string }>();
    db = true;
    migration = row?.name ?? null;
  } catch {
    db = false;
  }
  // Only claimable when the database answered. An unreachable D1 tells us
  // nothing about how old it is, and guessing "behind" there would send someone
  // to run migrations against a database that is not the problem.
  const migration_behind = db && migration !== EXPECTED_MIGRATION;
  return c.json<Health>({
    ok: db && !migration_behind,
    db,
    migration,
    expected_migration: EXPECTED_MIGRATION,
    migration_behind,
    time: new Date().toISOString(),
  });
});

/** What the sign-in screen is allowed to offer here, and which way round.
 *
 *  `claimed` decides whether an unauthenticated visitor is led to sign in or to
 *  sign up (#126). A failed read counts as claimed: showing "create an
 *  account" first on a database hiccup would invite a stranger to try claiming
 *  an instance that already has an owner, and the refusal they'd get is
 *  correct but bewildering. Guess towards the boring answer. */
open.get("/auth-methods", async (c) => {
  let claimed = true;
  try {
    const row = await c.env.DB.prepare("select 1 as found from users limit 1").first<{
      found: number;
    }>();
    claimed = Boolean(row);
  } catch {
    claimed = true;
  }
  return c.json<AuthMethods>({
    google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    passkey: true,
    devEmail: import.meta.env.DEV,
    claimed,
  });
});

// better-auth owns everything under /api/auth: OAuth callbacks, session
// endpoints, and the passkey register/authenticate ceremony.
//
// `c.req.raw.cf` rides along so a brand-new profile can be stamped with the
// timezone and unit system the edge reports rather than this deployment's
// author's (#37). Only the sign-up paths use it; everything else ignores it.
open.on(["GET", "POST"], "/auth/*", (c) =>
  createAuth(c.env, c.req.raw.cf).handler(c.req.raw),
);

// Machine caller (#19). "Open" only in the sense that requireAuth's session
// check can't apply to a launchd job — the route authenticates a bearer token
// to a real user_id before it touches anything, and scopes every write to it.
// It is mounted here rather than under `secure` precisely so that the session
// rule for every other route stays absolute.
open.route("/sync", sync);

// ── authenticated ────────────────────────────────────────────
// Everything mounted here runs requireAuth first, so no handler below can be
// reached without a session — per-user isolation is a property of the mount,
// not of remembering to check in each route.
const secure = new Hono<AppEnv>();
secure.use("*", requireAuth);
secure.route("/me", me);
secure.route("/day", day);
secure.route("/analyze", analyze);
secure.route("/barcode", barcode);
secure.route("/food-logs", foodLogs);
secure.route("/favorites", favorites);
secure.route("/photos", photos);
secure.route("/weights", weights);
secure.route("/trends", trends);
// issuing/revoking is a person's job in Settings, so it stays session-only —
// a leaked sync token must not be able to mint more of them (#19)
secure.route("/sync-tokens", syncTokens);

app.route("/api", open);
app.route("/api", secure);

// Unmatched /api/* answers in JSON — never the SPA shell, so a typo'd fetch
// fails loudly instead of parsing index.html as JSON.
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json({ error: "internal_error" }, 500);
});

// Everything else is the front end. The asset router applies
// not_found_handling: single-page-application, so client routes resolve.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
