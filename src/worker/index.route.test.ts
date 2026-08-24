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

describe("the migration guard (#129)", () => {
  it("reports what the code needs, derived from migrations/ rather than declared", async () => {
    const health = await (await call("/api/health")).json<{
      expected_migration: string;
      migration: string | null;
      migration_behind: boolean;
      ok: boolean;
      db: boolean;
    }>();

    // The test pool applies every file in migrations/, so a freshly set-up
    // database is by definition current. If this ever fails, the baked value
    // and the directory have come apart — which is the whole thing the check
    // is supposed to be incapable of.
    expect(health.expected_migration).toMatch(/^\d{4}_.+\.sql$/);
    expect(health.migration).toBe(health.expected_migration);
    expect(health.migration_behind).toBe(false);
    expect(health.ok).toBe(true);
  });

  it("says so, and stops claiming ok, when the database is older than the code", async () => {
    // The failure this exists for: the Worker boots, the SPA loads, D1 answers
    // every query — and the first request touching a new column 500s. Faked by
    // removing the newest row from d1_migrations, which is exactly the state a
    // deploy-without-migrate leaves behind.
    const newest = await env.DB.prepare(
      "select id, name from d1_migrations order by id desc limit 1",
    ).first<{ id: number; name: string }>();
    expect(newest).toBeTruthy();

    await env.DB.prepare("delete from d1_migrations where id = ?").bind(newest!.id).run();
    try {
      const behind = await (await call("/api/health")).json<{
        ok: boolean;
        db: boolean;
        migration: string | null;
        expected_migration: string;
        migration_behind: boolean;
      }>();

      expect(behind.migration_behind).toBe(true);
      expect(behind.ok).toBe(false);
      // Still reachable, still answering — which is precisely why `db` alone
      // could never have caught this.
      expect(behind.db).toBe(true);
      expect(behind.migration).not.toBe(behind.expected_migration);
      expect(behind.expected_migration).toBe(newest!.name);
    } finally {
      await env.DB.prepare("insert into d1_migrations (id, name, applied_at) values (?, ?, ?)")
        .bind(newest!.id, newest!.name, new Date().toISOString())
        .run();
    }

    const restored = await (await call("/api/health")).json<{ ok: boolean }>();
    expect(restored.ok).toBe(true);
  });

  it("stays ok when the database is AHEAD of the code, and says so", async () => {
    // The window the documented procedure creates on purpose: migrate remote,
    // then deploy. The database has a column the code does not use yet, which
    // costs nothing. The first cut of this check compared for inequality and
    // failed here — found by running the procedure against production three
    // minutes after shipping it, not by a test.
    await env.DB.prepare(
      "insert into d1_migrations (id, name, applied_at) values (9999, '9999_from_the_future.sql', ?)",
    )
      .bind(new Date().toISOString())
      .run();
    try {
      const ahead = await (await call("/api/health")).json<{
        ok: boolean;
        migration_behind: boolean;
        migration_ahead: boolean;
      }>();
      expect(ahead.migration_ahead).toBe(true);
      expect(ahead.migration_behind).toBe(false);
      expect(ahead.ok).toBe(true);
    } finally {
      await env.DB.prepare("delete from d1_migrations where id = 9999").run();
    }
  });

  it("counts a database that has never been migrated as behind", async () => {
    // `migration: null` is not "no opinion" — it is the oldest possible
    // database, and an inequality test would have called it behind by
    // accident rather than on purpose.
    const rows = await env.DB.prepare("select id, name, applied_at from d1_migrations").all<{
      id: number;
      name: string;
      applied_at: string;
    }>();
    await env.DB.prepare("delete from d1_migrations").run();
    try {
      const none = await (await call("/api/health")).json<{
        ok: boolean;
        migration: string | null;
        migration_behind: boolean;
        migration_ahead: boolean;
      }>();
      expect(none.migration).toBeNull();
      expect(none.migration_behind).toBe(true);
      expect(none.migration_ahead).toBe(false);
      expect(none.ok).toBe(false);
    } finally {
      for (const r of rows.results) {
        await env.DB.prepare("insert into d1_migrations (id, name, applied_at) values (?, ?, ?)")
          .bind(r.id, r.name, r.applied_at)
          .run();
      }
    }
  });
});

describe("the public mount", () => {
  it("answers /api/auth-methods without a session", async () => {
    const res = await call("/api/auth-methods");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ passkey: true });
  });

  it("reports an empty deployment as unclaimed, and a populated one as claimed", async () => {
    // The sign-in screen decides which button is the big one from this (#126).
    // Getting it backwards on a fresh instance sends the only person who can
    // do anything to the only button that cannot work.
    const fresh = await (await call("/api/auth-methods")).json<{ claimed: boolean }>();
    expect(fresh.claimed).toBe(false);

    await env.DB.prepare(
      `insert into users (id, name, email, emailVerified, createdAt, updatedAt)
       values ('claim-test', 'x', 'x@example.com', 0, '2026-01-01', '2026-01-01')`,
    ).run();

    const after = await (await call("/api/auth-methods")).json<{ claimed: boolean }>();
    expect(after.claimed).toBe(true);

    await env.DB.prepare("delete from users where id = 'claim-test'").run();
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
