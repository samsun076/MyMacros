import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { latestWeightKg, refreshTarget } from "./budget";
import { createDb } from "./db";

/** The stored half of the engine, against real D1. The arithmetic is covered
 *  in src/shared/budget.test.ts; what can only be checked here is that the
 *  right inputs are read, the result is persisted, and — the part with teeth —
 *  that an incomplete profile leaves the stored target alone instead of
 *  overwriting it with something worse. */
const db = createDb(env as unknown as Env);
const USER = "budget-test-user";
const TODAY = new Date(2026, 7, 7);

/** better-auth owns `users`, but a profile's FK points at it, so a row has to
 *  exist. Inserted directly rather than through the library — this is a
 *  fixture for a foreign key, not a test of authentication. */
async function seed(profile: Record<string, unknown> = {}) {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, TODAY.toISOString(), TODAY.toISOString())
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

describe("latestWeightKg", () => {
  it("is null when nobody has ever weighed in", async () => {
    await seed();
    expect(await latestWeightKg(db, USER)).toBeNull();
  });

  it("takes the most recent weigh-in, not the first", async () => {
    await seed();
    await weigh("2026-08-01", 82);
    await weigh("2026-08-06", 80);
    await weigh("2026-08-03", 81);
    expect(await latestWeightKg(db, USER)).toBe(80);
  });

  it("can be asked as of a past day", async () => {
    await seed();
    await weigh("2026-08-01", 82);
    await weigh("2026-08-06", 80);
    expect(await latestWeightKg(db, USER, "2026-08-03")).toBe(82);
  });

  it("is scoped to the user", async () => {
    await seed();
    await weigh("2026-08-06", 80);
    expect(await latestWeightKg(db, "somebody-else")).toBeNull();
  });
});

describe("refreshTarget", () => {
  it("computes from the profile and the latest weigh-in, and stores it", async () => {
    await seed();
    await weigh("2026-08-06", 80);

    const budget = await refreshTarget(db, USER, TODAY);
    expect(budget).toMatchObject({ bmr: 1730, tdee: 2682, target_kcal: 2182 });
    expect(await storedTarget()).toBe(2182);
  });

  it("follows the weight down", async () => {
    await seed();
    await weigh("2026-08-01", 80);
    await refreshTarget(db, USER, TODAY);
    const before = await storedTarget();

    await weigh("2026-08-07", 78);
    await refreshTarget(db, USER, TODAY);
    expect(await storedTarget()).toBeLessThan(before);
  });

  it("declines, and changes nothing, when onboarding is incomplete", async () => {
    // no height: Mifflin-St Jeor has no answer, and neither should we
    await seed({ height_cm: null });
    await weigh("2026-08-06", 80);

    const before = await storedTarget();
    expect(await refreshTarget(db, USER, TODAY)).toBeNull();
    expect(await storedTarget()).toBe(before);
  });

  it("declines when the profile is complete but nobody has weighed in", async () => {
    await seed();
    const before = await storedTarget();
    expect(await refreshTarget(db, USER, TODAY)).toBeNull();
    expect(await storedTarget()).toBe(before);
  });

  it("never writes another user's row", async () => {
    await seed();
    await weigh("2026-08-06", 80);
    await refreshTarget(db, USER, TODAY);

    const others = await db
      .selectFrom("profiles")
      .select("user_id")
      .where("user_id", "!=", USER)
      .where("target_kcal", "=", 2182)
      .execute();
    expect(others).toEqual([]);
  });
});
