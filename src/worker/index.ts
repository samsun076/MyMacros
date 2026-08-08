import { Hono } from "hono";
import type { AuthMethods, Health } from "../shared/api";
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
import weights from "./routes/weights";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

// ── public ───────────────────────────────────────────────────
const open = new Hono<AppEnv>();

/** Liveness + binding check. `migration` is null until `npm run db:migrate`,
 *  which is also how a deploy proves it's talking to a migrated database. */
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
  return c.json<Health>({ ok: true, db, migration, time: new Date().toISOString() });
});

/** What the sign-in screen is allowed to offer here. */
open.get("/auth-methods", (c) =>
  c.json<AuthMethods>({
    google: Boolean(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET),
    passkey: true,
    devEmail: import.meta.env.DEV,
  }),
);

// better-auth owns everything under /api/auth: OAuth callbacks, session
// endpoints, and the passkey register/authenticate ceremony.
open.on(["GET", "POST"], "/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

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
