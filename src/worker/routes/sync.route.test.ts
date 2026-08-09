import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../index";
import { createDb } from "../db";
import { issueSyncToken } from "../sync-token";

/** /api/sync is the only route a machine calls, and the only one that
 *  authenticates without a session — so it is the one place where "every
 *  route is scoped to its caller" could quietly stop being true. Most of what
 *  follows is that claim, tested.
 */
const db = createDb(env as unknown as Env);
const ALICE = "sync-alice";
const BOB = "sync-bob";

async function seedUser(id: string) {
  const now = "2026-08-08T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(id, id, `${id}@example.com`, now, now)
    .run();
  await db
    .insertInto("profiles")
    .values({
      user_id: id,
      sex: "male",
      birth_date: "1986-03-15",
      height_cm: 180,
      activity_level: "moderate",
      goal: "cut",
      deficit_kcal: 500,
    })
    .execute();
  return (await issueSyncToken(db, id, "Test Mac")).token;
}

const post = (token: string | null, body: unknown) =>
  app.fetch(
    new Request("https://fuel.debrief.run/api/sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
  );

const RUN = {
  ran_on: "2026-08-05",
  external_id: "6a732d1c62e0517768d7fb5d",
  distance_m: 8865,
  duration_s: 3287,
  kcal: 494,
  tss: 38,
  started_at: "2026-08-05T11:35:42.000Z",
};

beforeEach(async () => {
  for (const id of [ALICE, BOB]) {
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  }
});

describe("authentication", () => {
  it("refuses with no token, and says what it wanted", async () => {
    const res = await post(null, { runs: [RUN] });
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("refuses a token that was never issued", async () => {
    await seedUser(ALICE);
    expect((await post("mms_notarealtokenatall", { runs: [RUN] })).status).toBe(401);
  });

  it("refuses a revoked token", async () => {
    const token = await seedUser(ALICE);
    await db.deleteFrom("sync_tokens").where("user_id", "=", ALICE).execute();
    expect((await post(token, { runs: [RUN] })).status).toBe(401);
  });

  it("refuses a session cookie — this route takes tokens, not sessions", async () => {
    await seedUser(ALICE);
    const res = await app.fetch(
      new Request("https://fuel.debrief.run/api/sync", {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: "better-auth.session_token=x" },
        body: JSON.stringify({ runs: [RUN] }),
      }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("writes nothing at all when the token is bad", async () => {
    await seedUser(ALICE);
    await post("mms_wrong", { runs: [RUN] });
    expect(await db.selectFrom("runs").selectAll().execute()).toEqual([]);
  });
});

describe("writes are scoped to the token's owner", () => {
  /** The rule this route exists to not break. Alice's token, Bob's id in the
   *  body: the body must be ignored entirely. */
  it("ignores a user_id in the body", async () => {
    const aliceToken = await seedUser(ALICE);
    await seedUser(BOB);

    const res = await post(aliceToken, {
      runs: [{ ...RUN, user_id: BOB }],
      weights: [{ measured_on: "2026-08-08", weight_kg: 80, user_id: BOB }],
    });
    expect(res.status).toBe(200);

    const bobRuns = await db.selectFrom("runs").selectAll().where("user_id", "=", BOB).execute();
    const bobWeights = await db
      .selectFrom("weights")
      .selectAll()
      .where("user_id", "=", BOB)
      .execute();
    expect(bobRuns).toEqual([]);
    expect(bobWeights).toEqual([]);

    const aliceRuns = await db.selectFrom("runs").selectAll().where("user_id", "=", ALICE).execute();
    expect(aliceRuns).toHaveLength(1);
  });

  it("lets two users hold the same external_id without colliding", async () => {
    const a = await seedUser(ALICE);
    const b = await seedUser(BOB);
    await post(a, { runs: [RUN] });
    await post(b, { runs: [RUN] });

    expect(await db.selectFrom("runs").selectAll().execute()).toHaveLength(2);
  });
});

describe("idempotency", () => {
  /** The launchd job re-sends a rolling window forever, so this is the normal
   *  case rather than an edge one. */
  it("re-sending the same workout updates rather than duplicates", async () => {
    const token = await seedUser(ALICE);
    await post(token, { runs: [RUN] });
    await post(token, { runs: [RUN] });
    await post(token, { runs: [RUN] });

    const rows = await db.selectFrom("runs").selectAll().execute();
    expect(rows).toHaveLength(1);
  });

  it("takes a revised TSS on a re-send — debrief recalculates it", async () => {
    const token = await seedUser(ALICE);
    await post(token, { runs: [RUN] });
    await post(token, { runs: [{ ...RUN, tss: 45.3 }] });

    const row = await db.selectFrom("runs").selectAll().executeTakeFirstOrThrow();
    expect(row.tss).toBe(45.3);
  });

  /** Found in production: a manual weigh-in was reverted by the scale four
   *  minutes later, and the target moved with it. The sync runs every 30
   *  minutes forever, so without this the scale always wins eventually and a
   *  typed correction can never survive. */
  it("never overwrites a weigh-in the user typed", async () => {
    const token = await seedUser(ALICE);
    await db
      .insertInto("weights")
      .values({
        id: "manual-1",
        user_id: ALICE,
        measured_on: "2026-08-09",
        weight_kg: 74.8,
        source: "manual",
      })
      .execute();

    await post(token, { weights: [{ measured_on: "2026-08-09", weight_kg: 76.6 }] });

    const row = await db
      .selectFrom("weights")
      .selectAll()
      .where("measured_on", "=", "2026-08-09")
      .executeTakeFirstOrThrow();
    expect(row.weight_kg).toBe(74.8);
    expect(row.source).toBe("manual");
  });

  /** The protection above is right, but the count didn't know about it (#68):
   *  `weightsWritten++` ran whether or not the upsert's WHERE let the write
   *  through, so a day the user had corrected was reported as synced. Same
   *  failure as a silently-dropped payload, one field over — and in the one
   *  line the launchd log relies on for evidence. */
  it("doesn't count a weigh-in it was refused permission to overwrite", async () => {
    const token = await seedUser(ALICE);
    await db
      .insertInto("weights")
      .values({
        id: "manual-2",
        user_id: ALICE,
        measured_on: "2026-08-09",
        weight_kg: 74.8,
        source: "manual",
      })
      .execute();

    const res = await post(token, {
      weights: [
        { measured_on: "2026-08-09", weight_kg: 76.6 },
        { measured_on: "2026-08-10", weight_kg: 76.4 },
      ],
    });

    // one written, one deferred to the typed value — and it is neither
    // "written" nor "rejected", because nothing was wrong with it
    expect(await res.json()).toMatchObject({
      weights: 1,
      suppressed: ["weights[0]"],
      rejected: [],
    });
  });

  it("still updates a reading the scale itself wrote", async () => {
    const token = await seedUser(ALICE);
    await post(token, { weights: [{ measured_on: "2026-08-09", weight_kg: 76.6 }] });
    await post(token, { weights: [{ measured_on: "2026-08-09", weight_kg: 76.9 }] });

    const row = await db
      .selectFrom("weights")
      .selectAll()
      .where("measured_on", "=", "2026-08-09")
      .executeTakeFirstOrThrow();
    expect(row.weight_kg).toBe(76.9);
  });

  it("re-sending a weigh-in corrects the day rather than adding a second", async () => {
    const token = await seedUser(ALICE);
    await post(token, { weights: [{ measured_on: "2026-08-08", weight_kg: 80 }] });
    await post(token, { weights: [{ measured_on: "2026-08-08", weight_kg: 79.5 }] });

    const rows = await db.selectFrom("weights").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weight_kg).toBe(79.5);
  });
});

describe("payload handling", () => {
  it("counts what it wrote", async () => {
    const token = await seedUser(ALICE);
    const res = await post(token, {
      runs: [RUN, { ...RUN, external_id: "second" }],
      weights: [{ measured_on: "2026-08-08", weight_kg: 80 }],
    });
    expect(await res.json()).toMatchObject({ runs: 2, weights: 1, rejected: [] });
  });

  /** A script that silently drops half its payload should be visible in the
   *  launchd log, not look like a clean run. */
  it("names what it rejected instead of failing the whole batch", async () => {
    const token = await seedUser(ALICE);
    const res = await post(token, {
      runs: [RUN, { ...RUN, external_id: "bad", ran_on: "not-a-date" }],
    });
    const body = await res.json<{ runs: number; rejected: string[] }>();
    expect(body.runs).toBe(1);
    expect(body.rejected).toEqual(["runs[1]"]);
  });

  it("refuses a run with no external_id — it could never be idempotent", async () => {
    const token = await seedUser(ALICE);
    const { external_id: _drop, ...noId } = RUN;
    const res = await post(token, { runs: [noId] });
    expect(await res.json()).toMatchObject({ runs: 0, rejected: ["runs[0]"] });
  });

  it("marks a synced weigh-in as coming from the scale, whatever the body says", async () => {
    const token = await seedUser(ALICE);
    await post(token, { weights: [{ measured_on: "2026-08-08", weight_kg: 80, source: "manual" }] });

    const row = await db.selectFrom("weights").selectAll().executeTakeFirstOrThrow();
    expect(row.source).toBe("garmin");
  });

  it("caps a runaway payload", async () => {
    const token = await seedUser(ALICE);
    const runs = Array.from({ length: 501 }, (_, i) => ({ ...RUN, external_id: `r${i}` }));
    expect((await post(token, { runs })).status).toBe(413);
  });

  it("accepts an empty sync — nothing new is not an error", async () => {
    const token = await seedUser(ALICE);
    const res = await post(token, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runs: 0, weights: 0 });
  });
});

describe("side effects", () => {
  it("recomputes the target when a weigh-in arrives", async () => {
    const token = await seedUser(ALICE);
    const res = await post(token, { weights: [{ measured_on: "2026-08-08", weight_kg: 80 }] });
    expect(await res.json<{ target_kcal: number | null }>()).toMatchObject({ target_kcal: 2182 });
  });

  /** Runs never touch the base target — their calories are the earned bonus
   *  (#21), added per-day at read time. Folding them in here would be the
   *  double-count build rule 7 exists to prevent. */
  it("leaves the target alone when only runs arrive", async () => {
    const token = await seedUser(ALICE);
    await post(token, { weights: [{ measured_on: "2026-08-01", weight_kg: 80 }] });
    const before = await db
      .selectFrom("profiles")
      .select("target_kcal")
      .where("user_id", "=", ALICE)
      .executeTakeFirstOrThrow();

    const res = await post(token, { runs: [RUN] });
    expect(await res.json<{ target_kcal: number | null }>()).toMatchObject({ target_kcal: null });

    const after = await db
      .selectFrom("profiles")
      .select("target_kcal")
      .where("user_id", "=", ALICE)
      .executeTakeFirstOrThrow();
    expect(after.target_kcal).toBe(before.target_kcal);
  });

  it("stamps last_used_at so a dead launchd job is visible", async () => {
    const token = await seedUser(ALICE);
    await post(token, {});

    const row = await db
      .selectFrom("sync_tokens")
      .select("last_used_at")
      .where("user_id", "=", ALICE)
      .executeTakeFirstOrThrow();
    expect(row.last_used_at).not.toBeNull();
  });
});
