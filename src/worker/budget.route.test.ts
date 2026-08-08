import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { refreshTarget, trendWeightFor } from "./budget";
import { createDb } from "./db";

/** The stored half of the engine, against real D1. The arithmetic is covered
 *  in src/shared/budget.test.ts; what can only be checked here is that the
 *  right inputs are read, the result is persisted, and — the part with teeth —
 *  that an incomplete profile leaves the stored target alone instead of
 *  overwriting it with something worse. */
const db = createDb(env as unknown as Env);
const USER = "budget-test-user";
/** An explicit UTC instant, not a local Date: profiles default to
 *  America/New_York, so this is noon on 2026-08-07 for the user under test
 *  whatever timezone the suite runs in. */
const NOW = new Date("2026-08-07T16:00:00Z");
const TODAY = "2026-08-07";

/** better-auth owns `users`, but a profile's FK points at it, so a row has to
 *  exist. Inserted directly rather than through the library — this is a
 *  fixture for a foreign key, not a test of authentication. */
async function seed(profile: Record<string, unknown> = {}) {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, NOW.toISOString(), NOW.toISOString())
    .run();

  await db
    .insertInto("profiles")
    .values({
      user_id: USER,
      sex: "male",
      birth_date: "1986-03-15",
      height_cm: 180,
      activity_level: "moderate",
      goal: "cut",
      deficit_kcal: 500,
      ...profile,
    })
    .execute();
}

async function weigh(measured_on: string, weight_kg: number) {
  await db
    .insertInto("weights")
    .values({
      id: `w-${measured_on}`,
      user_id: USER,
      measured_on,
      weight_kg,
      source: "manual",
    })
    .execute();
}

const storedTarget = async () =>
  (
    await db
      .selectFrom("profiles")
      .select("target_kcal")
      .where("user_id", "=", USER)
      .executeTakeFirstOrThrow()
  ).target_kcal;

// users cascades to profiles and weights, so one delete resets everything
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
});

describe("trendWeightFor", () => {
  it("is null when nobody has ever weighed in", async () => {
    await seed();
    expect(await trendWeightFor(db, USER, TODAY)).toBeNull();
  });

  it("smooths the window rather than taking the last number on the scale", async () => {
    await seed();
    await weigh("2026-08-05", 82);
    await weigh("2026-08-06", 80);
    await weigh("2026-08-07", 81);
    expect(await trendWeightFor(db, USER, TODAY)).toBe(81);
  });

  it("can be asked as of a past day, ignoring later weigh-ins", async () => {
    await seed();
    await weigh("2026-08-01", 82);
    await weigh("2026-08-06", 70);
    expect(await trendWeightFor(db, USER, "2026-08-03")).toBe(82);
  });

  it("is scoped to the user", async () => {
    await seed();
    await weigh("2026-08-06", 80);
    expect(await trendWeightFor(db, "somebody-else", TODAY)).toBeNull();
  });
});

describe("refreshTarget", () => {
  it("computes from the profile and the latest weigh-in, and stores it", async () => {
    await seed();
    await weigh("2026-08-06", 80);

    const budget = await refreshTarget(db, USER, NOW);
    expect(budget).toMatchObject({ bmr: 1730, tdee: 2682, target_kcal: 2182 });
    expect(await storedTarget()).toBe(2182);
  });

  it("follows the weight down", async () => {
    await seed();
    await weigh("2026-08-01", 80);
    await refreshTarget(db, USER, NOW);
    const before = await storedTarget();

    await weigh("2026-08-07", 78);
    await refreshTarget(db, USER, NOW);
    expect(await storedTarget()).toBeLessThan(before);
  });

  it("declines, and changes nothing, when onboarding is incomplete", async () => {
    // no height: Mifflin-St Jeor has no answer, and neither should we
    await seed({ height_cm: null });
    await weigh("2026-08-06", 80);

    const before = await storedTarget();
    expect(await refreshTarget(db, USER, NOW)).toBeNull();
    expect(await storedTarget()).toBe(before);
  });

  it("declines when the profile is complete but nobody has weighed in", async () => {
    await seed();
    const before = await storedTarget();
    expect(await refreshTarget(db, USER, NOW)).toBeNull();
    expect(await storedTarget()).toBe(before);
  });

  /** The sharp edge #47 was filed over: this runs with no client present, so
   *  "today" has to come from the profile's timezone rather than the Worker's
   *  UTC clock. Read as UTC, the instant below is the 7th and a weigh-in
   *  dated the 8th looks like the future — so it would be filtered out and
   *  the user would be budgeted against a stale weight, with nothing broken
   *  on screen to say so. */
  it("resolves today in the user's timezone, not the Worker's", async () => {
    await seed({ timezone: "Australia/Sydney" });
    // 20:00Z on the 7th is already 06:00 on the 8th in Sydney
    const now = new Date("2026-08-07T20:00:00Z");
    await weigh("2026-08-08", 78);

    expect(await refreshTarget(db, USER, now)).not.toBeNull();
    expect(await trendWeightFor(db, USER, "2026-08-08")).toBe(78);
  });

  /** Regression, found by driving the real API during M4's verification: a
   *  fresh profile stayed on the M2 default of 1,810 while /api/day happily
   *  reported `onboarded: true`.
   *
   *  The engine derives its day from `profiles.timezone`, the client owns its
   *  own day (#44), and the two sit on opposite sides of midnight for several
   *  hours every evening — so a weigh-in stamped with the client's "today"
   *  can be dated *after* the server's. Clamped to the server's day it looked
   *  like the future, was filtered out, and the engine declined for want of a
   *  weight it actually had. Nothing errored; the target just never moved. */
  it("uses a weigh-in dated ahead of the server's day", async () => {
    await seed({ timezone: "America/New_York" });
    // 01:30Z is still the 7th in New York, but the client is on the 8th
    const now = new Date("2026-08-08T01:30:00Z");
    await weigh("2026-08-08", 80);

    const budget = await refreshTarget(db, USER, now);
    expect(budget).not.toBeNull();
    expect(await storedTarget()).toBe(budget?.target_kcal);
    expect(await storedTarget()).not.toBe(1800);
  });

  it("never writes another user's row", async () => {
    await seed();
    await weigh("2026-08-06", 80);
    await refreshTarget(db, USER, NOW);

    const others = await db
      .selectFrom("profiles")
      .select("user_id")
      .where("user_id", "!=", USER)
      .where("target_kcal", "=", 2182)
      .execute();
    expect(others).toEqual([]);
  });
});
