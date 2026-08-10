import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "../../shared/api";
import { createDb } from "../db";
import type { AppEnv } from "../types";
import me from "./me";

/** What a user may write about themselves, against real D1.
 *
 *  The allowlist is the whole of the authorization story for this route — a
 *  field absent from it is simply not writable — so #77 moving the macro
 *  columns is a change to that surface, not just to arithmetic. These pin the
 *  new shape and, more importantly, that the old one is gone: a client still
 *  sending `protein_pct` must be refused loudly rather than have it silently
 *  ignored while the screen shows a target nobody set.
 *
 *  Mounted behind a stub that sets exactly what `requireAuth` sets; the
 *  mount-level session rule is index.route.test.ts's claim. */
const db = createDb(env as unknown as Env);
const USER = "me-test-user";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("user", { id: USER, name: "Test", email: `${USER}@example.com` } as never);
  await next();
});
app.route("/api/me", me);

const patch = (body: unknown) =>
  app.fetch(
    new Request("https://fuel.debrief.run/api/me/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  const now = "2026-08-10T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, now, now)
    .run();
  await db.insertInto("profiles").values({ user_id: USER }).execute();
});

describe("PATCH /api/me/profile — the macro anchor (#77)", () => {
  it("stores protein in g/kg and the carb:fat ratio", async () => {
    const res = await patch({ protein_g_per_kg: 2.0, carb_ratio_pct: 58 });
    expect(res.status).toBe(200);

    const profile = await res.json<Profile>();
    expect(profile.protein_g_per_kg).toBe(2);
    expect(profile.carb_ratio_pct).toBe(58);
  });

  it("rounds to the stored tenth rather than keeping slider noise", async () => {
    const res = await patch({ protein_g_per_kg: 1.8399999 });
    expect((await res.json<Profile>()).protein_g_per_kg).toBe(1.8);
  });

  it.each([[0], [1.1], [3], [-2], ["2.0"], [null]])(
    "refuses %p as a protein anchor",
    async (value) => {
      const res = await patch({ protein_g_per_kg: value });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_fields", fields: ["protein_g_per_kg"] });
    },
  );

  /** The percent-of-energy model is gone, not deprecated. An old client
   *  sending it gets a 400 naming the field — the failure this must not have
   *  is a silent 200 that changes nothing while the caller believes it did. */
  it("refuses the retired percent split instead of ignoring it", async () => {
    const res = await patch({ protein_pct: 35, carb_pct: 40, fat_pct: 25 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "nothing_to_update" });
  });

  /** There is no sum to police any more: fat is the remainder of the
   *  remainder, so both extremes of the ratio describe a real day. The old
   *  three-leg split had to total 100 and could be saved not doing so. */
  it.each([[0], [100]])("accepts %p as a carb share — the legs cannot disagree", async (value) => {
    const res = await patch({ carb_ratio_pct: value });
    expect(res.status).toBe(200);
    expect((await res.json<Profile>()).carb_ratio_pct).toBe(value);
  });
});
