import { Hono } from "hono";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

/** Liveness + binding check. `db` is false until migrations run (#5). */
app.get("/api/health", async (c) => {
  let db = false;
  try {
    await c.env.DB.prepare("select 1").first();
    db = true;
  } catch {
    db = false;
  }
  return c.json({ ok: true, db, time: new Date().toISOString() });
});

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
