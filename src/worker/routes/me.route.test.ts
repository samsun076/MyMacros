import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "../../shared/api";
import { ATHLETE_PROFILES, PROTEIN_G_PER_KG } from "../../shared/budget";
import { PROFILE_DEFAULTS } from "../../shared/profile";
import { kgToLb, lbToKg } from "../../shared/units";
import { MAX_WEIGHT_KG, MIN_WEIGHT_KG } from "../../shared/weight";
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

describe("PATCH /api/me/profile — the athlete profile (#79)", () => {
  it("stores runner and general, and refuses what the app can't serve", async () => {
    expect((await patch({ athlete_profile: "runner" })).status).toBe(200);
    expect((await patch({ athlete_profile: "general" })).status).toBe(200);

    // decided, defaulted, and deliberately not shippable until there is an
    // exercise input that isn't a run — so the wire refuses them too
    for (const value of ["lifter", "crossfit", "", null]) {
      const res = await patch({ athlete_profile: value });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_fields", fields: ["athlete_profile"] });
    }
  });

  /** THE DOUBLE-COUNT TRAP. `activity_level` describes life excluding
   *  purposeful exercise, because runs arrive as the earned bonus (#21).
   *  Nothing on the server may adjust it — or `deficit_kcal` — in response to
   *  a profile choice. The shape of ATHLETE_PROFILES stops the client doing
   *  it; this stops a helpful hook here doing it later. */
  it("leaves activity_level and deficit_kcal exactly where they were", async () => {
    await patch({ activity_level: "light", deficit_kcal: 400 });

    const after = await (await patch({ athlete_profile: "runner" })).json<Profile>();
    expect(after.activity_level).toBe("light");
    expect(after.deficit_kcal).toBe(400);
  });

  /** One answer to "what does someone who has chosen nothing get". The column
   *  default and the General preset are the same question asked twice, so
   *  this asks the real schema rather than restating the number. */
  it("creates a profile on the same carb:fat General would set", async () => {
    const fresh = await freshProfile();

    expect(fresh.athlete_profile).toBe("general");
    expect(fresh.carb_ratio_pct).toBe(ATHLETE_PROFILES.general.carb_ratio_pct);
    expect(fresh.eat_back_pct).toBe(ATHLETE_PROFILES.general.eat_back_pct);
  });
});

/** #23. Settings is the only writer of this column, and the only one of the
 *  three it edits that can be *removed* — Trends draws a goal line when it is
 *  set and a plain trend label when it isn't. `positive` refuses null, so
 *  before this the field could be filled and never emptied. */
describe("PATCH /api/me/profile — the goal weight is erasable (#23)", () => {
  it("stores a goal weight and takes it away again", async () => {
    expect((await (await patch({ goal_weight_kg: 77.5 })).json<Profile>()).goal_weight_kg).toBe(77.5);

    const cleared = await patch({ goal_weight_kg: null });
    expect(cleared.status).toBe(200);
    expect((await cleared.json<Profile>()).goal_weight_kg).toBeNull();
  });

  /** Nullable is not "anything goes" — a weight of zero or a string is still
   *  the client sending nonsense, and it must be refused rather than stored. */
  it("still refuses a non-positive or non-numeric goal weight", async () => {
    for (const bad of [0, -5, "77", {}]) {
      const res = await patch({ goal_weight_kg: bad });
      expect(res.status, `goal_weight_kg: ${JSON.stringify(bad)}`).toBe(400);
    }
  });

  /** The asymmetry is deliberate, so it gets pinned: start weight means the
   *  weight at onboarding and there is no such thing as erasing having had
   *  one. If this ever goes green, someone widened the wrong validator. */
  it("does not make start_weight_kg erasable too", async () => {
    expect((await patch({ start_weight_kg: null })).status).toBe(400);
  });
});

/** #86. Every column default is a second statement of a number the code also
 *  states, and the pair is only correct while someone keeps them in step by
 *  hand. The sweep found one that had already rotted — onboarding's carb:fat
 *  fallback still read 62 a day after migration 0008 rebuilt the default to 58
 *  — so the remaining pairs get pinned rather than trusted. */
describe("column defaults agree with the code that also states them", () => {
  it("starts a new profile on the protein anchor its own default goal implies", async () => {
    const fresh = await freshProfile();
    expect(fresh.protein_g_per_kg).toBe(PROTEIN_G_PER_KG[fresh.goal]);
  });

  /** The whole of `PROFILE_DEFAULTS`, against what SQLite actually wrote.
   *
   *  Table-driven rather than a test per field on purpose: a new column with a
   *  DEFAULT is added to that object and pinned here in the same motion, where
   *  a hand-written list is a place to forget one. This test replaced a version
   *  that asserted `deficit_kcal === 500` — a *third* statement of the number,
   *  in the file whose job was to stop the second one. */
  it.each(Object.entries(PROFILE_DEFAULTS))(
    "starts a new profile on the %s the client seeds from",
    async (column, expected) => {
      const fresh = await freshProfile();
      expect(fresh[column as keyof typeof fresh]).toBe(expected);
    },
  );

  /** The two DEFAULTs `PROFILE_DEFAULTS` deliberately omits, because a preset
   *  already owns them. Absent from that object, present here — so skipping
   *  the object costs no coverage. */
  it("starts a new profile on the carb:fat its own default training preset implies", async () => {
    const fresh = await freshProfile();
    expect(fresh.carb_ratio_pct).toBe(ATHLETE_PROFILES[fresh.athlete_profile].carb_ratio_pct);
  });
});

/** #99. Before this, `goal_weight_kg` and `start_weight_kg` were `positive`
 *  alone, so the only ceiling on either was the number field in Settings — a
 *  goal weight never passes through `/api/weights`, where the 20–400 kg window
 *  has always lived. Measured by removing that field's max: 45,358 kg reached
 *  the column through this route.
 *
 *  The bound is asserted here against the shared constants rather than against
 *  20 and 400, because a test that restates a literal agrees with itself. What
 *  it pins is that this route reads the *same* window as the weigh-in route and
 *  the sync route, which is the claim #86 cares about. */
describe("weights on the profile route are bounded (#99)", () => {
  it("takes a weight inside the shared window", async () => {
    await freshProfile();
    const res = await patch({ goal_weight_kg: MAX_WEIGHT_KG, start_weight_kg: MIN_WEIGHT_KG });
    expect(res.status).toBe(200);
    const row = await db.selectFrom("profiles").selectAll().where("user_id", "=", USER).executeTakeFirstOrThrow();
    expect(row.goal_weight_kg).toBe(MAX_WEIGHT_KG);
    expect(row.start_weight_kg).toBe(MIN_WEIGHT_KG);
  });

  it("refuses a step past either end, and stores nothing", async () => {
    const before = await freshProfile();
    for (const body of [
      { goal_weight_kg: MAX_WEIGHT_KG + 1 },
      { goal_weight_kg: MIN_WEIGHT_KG - 1 },
      { start_weight_kg: MAX_WEIGHT_KG + 1 },
      { start_weight_kg: MIN_WEIGHT_KG - 1 },
    ]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const row = await db.selectFrom("profiles").selectAll().where("user_id", "=", USER).executeTakeFirstOrThrow();
      expect(row.goal_weight_kg, JSON.stringify(body)).toBe(before.goal_weight_kg);
      expect(row.start_weight_kg, JSON.stringify(body)).toBe(before.start_weight_kg);
    }
  });

  it("refuses the figure that actually reached the column", async () => {
    await freshProfile();
    expect((await patch({ goal_weight_kg: 45358.78 })).status).toBe(400);
  });


  /** The bug the boundary tests could not see, because they only ever walked
   *  the ends. Typing an ordinary 160 lb read back as 160.1: the route rounded
   *  the stored kilograms to 1 dp, and 0.1 kg is a coarser grid than 0.1 lb, so
   *  an exact pound figure landed between two of them. Endpoints were right and
   *  the middle was wrong — the same shape as #100.
   *
   *  A round trip, not an equality: type it, store it, and read back what the
   *  field would draw. */
  it("gives back the pounds you typed, not a kilogram's idea of them", async () => {
    for (const lb of [100, 145, 160, 172.5, 200, 250.4]) {
      await freshProfile();
      const res = await patch({ goal_weight_kg: lbToKg(lb) });
      expect(res.status, `${lb} lb`).toBe(200);
      const row = await db
        .selectFrom("profiles")
        .selectAll()
        .where("user_id", "=", USER)
        .executeTakeFirstOrThrow();
      const shown = Math.round(kgToLb(row.goal_weight_kg!) * 10) / 10;
      expect(shown, `${lb} lb round-tripped`).toBe(lb);
    }
  });

  /** And metric must not have paid for it: a kg typed in kg comes back whole. */
  it("gives back the kilograms you typed too", async () => {
    for (const kg of [60, 72.6, 80, 95.5]) {
      await freshProfile();
      expect((await patch({ goal_weight_kg: kg })).status, `${kg} kg`).toBe(200);
      const row = await db
        .selectFrom("profiles")
        .selectAll()
        .where("user_id", "=", USER)
        .executeTakeFirstOrThrow();
      expect(Math.round(row.goal_weight_kg! * 10) / 10, `${kg} kg`).toBe(kg);
    }
  });

  /** #23's erasable goal line. The bound must not have taken this away. */
  it("still lets the goal line be cleared", async () => {
    await freshProfile();
    expect((await patch({ goal_weight_kg: 80 })).status).toBe(200);
    expect((await patch({ goal_weight_kg: null })).status).toBe(200);
    const row = await db.selectFrom("profiles").selectAll().where("user_id", "=", USER).executeTakeFirstOrThrow();
    expect(row.goal_weight_kg).toBeNull();
  });
});

async function freshProfile() {
  await env.DB.prepare("DELETE FROM profiles WHERE user_id = ?").bind(USER).run();
  return db.insertInto("profiles").values({ user_id: USER }).returningAll().executeTakeFirstOrThrow();
}
