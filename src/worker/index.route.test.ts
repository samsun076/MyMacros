import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import app from "./index";

/** The mount-level guarantees, exercised in real workerd against a real D1.
 *
 *  `app.fetch(...)` rather than `SELF.fetch(...)` on purpose: SELF goes in
 *  through the asset router, whose directory is supplied by the Vite plugin
 *  and does not exist here. Every route below is under /api, which the asset
 *  router is configured to hand straight to the Worker anyway
 *  (`run_worker_first`), so calling the Hono app directly tests the same path
 *  without needing a build. */
const call = (path: string, init?: RequestInit) =>
  app.fetch(new Request(`https://fuel.debrief.run${path}`, init), env);

describe("GET /api/health", () => {
  it("reports a reachable, migrated database", async () => {
    const res = await call("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json<{ ok: boolean; db: boolean; migration: string | null }>();
    expect(body.ok).toBe(true);
    // false here is the tell CLAUDE.md documents for an unmigrated D1 file —
    // if this fails, test-setup.ts didn't apply migrations/
    expect(body.db).toBe(true);
    expect(body.migration).not.toBeNull();
  });
});

/** PLAN.md's per-user isolation is a property of the *mount* — everything is
 *  hung off a sub-app that runs requireAuth first, so no handler can be
 *  reached without a session. That is a claim about routing, and this is the
 *  test that it stays true as routes are added: a new `secure.route(...)` gets
 *  covered here for free, while one accidentally mounted on `open` shows up as
 *  a failure. M4 adds several. */
describe("the authenticated mount", () => {
  const SECURE = [
    "/api/me",
    "/api/day/2026-08-07",
    "/api/food-logs/recent",
    "/api/favorites",
    "/api/barcode/737628064502",
    "/api/photos/someone/00000000-0000-4000-8000-000000000000.jpg",
    "/api/weights",
  ];

  it.each(SECURE)("refuses %s without a session", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("refuses a write without a session", async () => {
    const res = await call("/api/food-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ logged_on: "2026-08-07", meal_slot: "lunch", items: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("refuses a forged user id in the body — the session is the only source", async () => {
    const res = await call("/api/food-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: "someone-else", logged_on: "2026-08-07", items: [] }),
    });
    expect(res.status).toBe(401);
  });
});

describe("the public mount", () => {
  it("answers /api/auth-methods without a session", async () => {
    const res = await call("/api/auth-methods");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ passkey: true });
  });
});

/** A mistyped fetch must fail loudly rather than hand back the SPA shell for
 *  the client to parse as JSON. That is the guarantee the /api/* catch-all
 *  exists for, and it is the one worth pinning: **no path under /api ever
 *  answers with HTML**, whoever is asking.
 *
 *  The status is not 404 for an anonymous caller, though the comment on that
 *  catch-all reads as if it were. `secure` is mounted at /api with
 *  `use("*", requireAuth)`, so the session check runs before Hono ever
 *  discovers the route doesn't exist: anonymous gets 401, and only a caller
 *  with a live session falls through to the 404. That ordering is the better
 *  one — it declines to tell an unauthenticated stranger which routes are
 *  real — so this pins the behaviour rather than "fixing" it. */
describe("unmatched /api", () => {
  it("is JSON, never the SPA", async () => {
    const res = await call("/api/no-such-route");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).not.toContain("<!doctype html");
  });

  it("declines before it admits the route doesn't exist", async () => {
    const res = await call("/api/no-such-route");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
