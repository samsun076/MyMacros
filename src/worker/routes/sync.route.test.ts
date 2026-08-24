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

describe("a synced run is labelled by mechanism, not by this deployment's upstream", () => {
  /** 0010 renamed `runs.source` from 'debrief' — the maintainer's own pipeline,
   *  welded into a CHECK every self-hosted instance inherited — to 'sync',
   *  which is what the value actually means (#37).
   *
   *  Pinned because nothing else can see it: no route selects `runs.source`, no
   *  API response carries it, and no screen renders it. The type system caught
   *  the rename being incomplete in `db.ts`, but a type cannot say what reaches
   *  the column, and the CHECK only fails on a value the code never sends. */
  it("stores 'sync', and the CHECK would refuse the old name", async () => {
    const token = await seedUser(ALICE);
    expect((await post(token, { runs: [RUN] })).status).toBe(200);

    const row = await db.selectFrom("runs").selectAll().executeTakeFirstOrThrow();
    expect(row.source).toBe("sync");

    await expect(
      env.DB.prepare(
        `insert into runs (id, user_id, ran_on, distance_m, kcal, source)
         values ('x', ?, '2026-08-08', 1000, 100, 'debrief')`,
      )
        .bind(ALICE)
        .run(),
    ).rejects.toThrow();
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

/** The scale used to undo a delete within 30 minutes (#71): the rolling window
 *  re-sent the day, found no row, and the upsert took its INSERT branch. */
describe("readings the user has rejected", () => {
  const tombstone = (day: string, kg: number) =>
    db
      .insertInto("weight_tombstones")
      .values({ user_id: ALICE, measured_on: day, weight_kg: kg })
      .execute();

  const rows = () =>
    db.selectFrom("weights").selectAll().where("user_id", "=", ALICE).execute();

  it("never re-adds a reading that was deleted", async () => {
    const token = await seedUser(ALICE);
    await tombstone("2026-08-05", 82.4);

    const res = await post(token, {
      weights: [{ measured_on: "2026-08-05", weight_kg: 82.4 }],
    });

    expect(await res.json()).toMatchObject({ weights: 0, suppressed: ["weights[0]"] });
    expect(await rows()).toHaveLength(0);
  });

  it("still refuses it on the hundredth sync, not just the next one", async () => {
    const token = await seedUser(ALICE);
    await tombstone("2026-08-05", 82.4);

    for (let i = 0; i < 3; i++) {
      await post(token, { weights: [{ measured_on: "2026-08-05", weight_kg: 82.4 }] });
    }
    expect(await rows()).toHaveLength(0);
  });

  /** The case that makes a permanent tombstone safe rather than a trap: the
   *  scale read you holding a dumbbell, you deleted it, you weighed again. The
   *  corrected number is a different value, so it is not what you rejected. */
  it("lets a corrected re-weigh of the same day through", async () => {
    const token = await seedUser(ALICE);
    await tombstone("2026-08-05", 82.4);

    await post(token, { weights: [{ measured_on: "2026-08-05", weight_kg: 76.6 }] });

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.weight_kg).toBe(76.6);
  });

  it("leaves other days alone", async () => {
    const token = await seedUser(ALICE);
    await tombstone("2026-08-05", 82.4);

    await post(token, { weights: [{ measured_on: "2026-08-06", weight_kg: 82.4 }] });

    expect(await rows()).toHaveLength(1);
  });

  it("is one user's decision, not everyone's", async () => {
    await seedUser(ALICE);
    const bob = await seedUser(BOB);
    await tombstone("2026-08-05", 82.4);

    await post(bob, { weights: [{ measured_on: "2026-08-05", weight_kg: 82.4 }] });

    const bobs = await db.selectFrom("weights").selectAll().where("user_id", "=", BOB).execute();
    expect(bobs).toHaveLength(1);
  });
});

/** Garmin reports a deletion by never mentioning the day again — no tombstone,
 *  no flag, measured against the live API. For one day that is identical to
 *  "didn't weigh in"; over a window the caller vouches for, it isn't (#66). */
describe("window reconciliation", () => {
  const WINDOW = { from: "2026-08-01", to: "2026-08-10" };

  async function seedScaleDays(days: [string, number][]) {
    for (const [day, kg] of days) {
      await db
        .insertInto("weights")
        .values({
          id: `w-${day}`,
          user_id: ALICE,
          measured_on: day,
          weight_kg: kg,
          source: "garmin",
        })
        .execute();
    }
  }

  const daysLeft = async () =>
    (
      await db
        .selectFrom("weights")
        .select("measured_on")
        .where("user_id", "=", ALICE)
        .orderBy("measured_on")
        .execute()
    ).map((r) => r.measured_on);

  it("removes a day the scale no longer reports", async () => {
    const token = await seedUser(ALICE);
    await seedScaleDays([
      ["2026-08-05", 76.1],
      ["2026-08-06", 76.2],
    ]);

    const res = await post(token, {
      weights: [{ measured_on: "2026-08-06", weight_kg: 76.2 }],
      weights_window: WINDOW,
    });

    expect(await res.json()).toMatchObject({ removed: ["2026-08-05"], removals_refused: [] });
    expect(await daysLeft()).toEqual(["2026-08-06"]);
  });

  /** No window, no deletion, ever. */
  it("deletes nothing when no window is declared", async () => {
    const token = await seedUser(ALICE);
    await seedScaleDays([["2026-08-05", 76.1]]);

    await post(token, { weights: [{ measured_on: "2026-08-06", weight_kg: 76.2 }] });

    expect(await daysLeft()).toEqual(["2026-08-05", "2026-08-06"]);
  });

  /** An empty list is the shape an API hiccup takes, and it would otherwise
   *  mean "delete everything in here". */
  it("refuses to reconcile an empty payload", async () => {
    const token = await seedUser(ALICE);
    await seedScaleDays([
      ["2026-08-05", 76.1],
      ["2026-08-06", 76.2],
    ]);

    const res = await post(token, { weights: [], weights_window: WINDOW });

    expect(await res.json()).toMatchObject({ removed: [] });
    expect(await daysLeft()).toEqual(["2026-08-05", "2026-08-06"]);
  });

  /** A person deletes one bad reading, not a fortnight. Past the cap this is
   *  evidence about the response, not about the user. */
  it("refuses a mass removal and names the days instead", async () => {
    const token = await seedUser(ALICE);
    await seedScaleDays([
      ["2026-08-03", 76.0],
      ["2026-08-04", 76.1],
      ["2026-08-05", 76.2],
      ["2026-08-06", 76.3],
    ]);

    const res = await post(token, {
      weights: [{ measured_on: "2026-08-06", weight_kg: 76.3 }],
      weights_window: WINDOW,
    });

    expect(await res.json()).toMatchObject({
      removed: [],
      removals_refused: ["2026-08-03", "2026-08-04", "2026-08-05"],
    });
    expect(await daysLeft()).toHaveLength(4);
  });

  it("lets the caller raise the cap deliberately", async () => {
    const token = await seedUser(ALICE);
    await seedScaleDays([
      ["2026-08-03", 76.0],
      ["2026-08-04", 76.1],
      ["2026-08-05", 76.2],
      ["2026-08-06", 76.3],
    ]);

    const res = await post(token, {
      weights: [{ measured_on: "2026-08-06", weight_kg: 76.3 }],
      weights_window: { ...WINDOW, max_removals: 5 },
    });

    expect(await res.json()).toMatchObject({ removed: ["2026-08-03", "2026-08-04", "2026-08-05"] });
    expect(await daysLeft()).toEqual(["2026-08-06"]);
  });

  /** #20's rule is untouched: the scale cannot remove a number the user typed
   *  any more than it can overwrite one. */
  it("never removes a weigh-in the user typed", async () => {
    const token = await seedUser(ALICE);
    await db
      .insertInto("weights")
      .values({
        id: "manual-x",
        user_id: ALICE,
        measured_on: "2026-08-05",
        weight_kg: 74.8,
        source: "manual",
      })
      .execute();

    const res = await post(token, {
      weights: [{ measured_on: "2026-08-06", weight_kg: 76.2 }],
      weights_window: WINDOW,
    });

    expect(await res.json()).toMatchObject({ removed: [] });
    expect(await daysLeft()).toEqual(["2026-08-05", "2026-08-06"]);
  });

  it("leaves rows outside the declared window alone", async () => {
    const token = await seedUser(ALICE);
    await seedScaleDays([
      ["2026-07-01", 77.0],
      ["2026-08-05", 76.1],
    ]);

    await post(token, {
      weights: [{ measured_on: "2026-08-05", weight_kg: 76.1 }],
      weights_window: WINDOW,
    });

    expect(await daysLeft()).toEqual(["2026-07-01", "2026-08-05"]);
  });

  /** Clamping a malformed window into a valid one would authorize deletions
   *  over days the caller never claimed to know about. */
  it("ignores a window whose dates are backwards or junk", async () => {
    const token = await seedUser(ALICE);
    await seedScaleDays([["2026-08-05", 76.1]]);

    for (const bad of [
      { from: "2026-08-10", to: "2026-08-01" },
      { from: "nope", to: "2026-08-10" },
      { from: "2026-08-01" },
    ]) {
      await post(token, {
        weights: [{ measured_on: "2026-08-06", weight_kg: 76.2 }],
        weights_window: bad,
      });
    }

    expect(await daysLeft()).toContain("2026-08-05");
  });

  it("keeps one user's window out of another's rows", async () => {
    const alice = await seedUser(ALICE);
    await seedUser(BOB);
    await db
      .insertInto("weights")
      .values({
        id: "bob-1",
        user_id: BOB,
        measured_on: "2026-08-05",
        weight_kg: 90,
        source: "garmin",
      })
      .execute();

    await post(alice, {
      weights: [{ measured_on: "2026-08-06", weight_kg: 76.2 }],
      weights_window: WINDOW,
    });

    const bobs = await db.selectFrom("weights").select("id").where("user_id", "=", BOB).execute();
    expect(bobs).toHaveLength(1);
  });

  /** The removed row is usually the bad one that was dragging the trend, so
   *  the target has to be recomputed without it — otherwise the budget stays
   *  derived from a reading that no longer exists. */
  it("recomputes the target after a removal", async () => {
    const token = await seedUser(ALICE);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // a bad heavy reading beside a good one, both inside the 7-day trend
    await seedScaleDays([
      [yesterday, 96.0],
      [today, 76.0],
    ]);

    // no window: nothing is removed, so the trend still averages in the 96
    const before = (await (
      await post(token, { weights: [{ measured_on: today, weight_kg: 76.0 }] })
    ).json()) as { target_kcal: number | null };

    // same payload, now vouching for the window: the 96 disappears
    const after = (await (
      await post(token, {
        weights: [{ measured_on: today, weight_kg: 76.0 }],
        weights_window: { from: yesterday, to: today },
      })
    ).json()) as { target_kcal: number | null; removed: string[] };

    expect(after.removed).toEqual([yesterday]);
    expect(before.target_kcal).not.toBeNull();
    expect(after.target_kcal).not.toBeNull();
    // 20 kg lighter on a cut is a materially smaller budget, not a rounding wobble
    expect(after.target_kcal as number).toBeLessThan(before.target_kcal as number);
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

  /** The heartbeat (#69). `run: null` on the Today screen means both "rest
   *  day" and "sync died three days ago", and only this can tell them apart. */
  describe("per-source heartbeat", () => {
    const sources = () =>
      db.selectFrom("sync_sources").selectAll().where("user_id", "=", ALICE).execute();

    it("records a check-in for a feed that reported nothing", async () => {
      const token = await seedUser(ALICE);
      await post(token, { runs: [] });

      const rows = await sources();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source).toBe("runs");
      expect(rows[0]?.last_item_count).toBe(0);
      expect(rows[0]?.last_success_at).toBeTruthy();
    });

    /** The distinction the whole feature rests on: an empty array is a
     *  collector saying "there are none", an absent key is a caller that
     *  doesn't speak for that feed at all. Collapsing them would mark the
     *  Garmin feed alive every time the runs sync ran. */
    it("says nothing about a feed that didn't check in", async () => {
      const token = await seedUser(ALICE);
      await post(token, { runs: [] });

      expect((await sources()).map((s) => s.source)).toEqual(["runs"]);
    });

    it("records both when both report", async () => {
      const token = await seedUser(ALICE);
      await post(token, { runs: [RUN], weights: [{ measured_on: "2026-08-08", weight_kg: 80 }] });

      const rows = await sources();
      expect(rows.map((s) => s.source).sort()).toEqual(["runs", "weights"]);
      expect(rows.every((s) => s.last_item_count === 1)).toBe(true);
    });

    it("moves forward on the next check-in rather than adding a row", async () => {
      const token = await seedUser(ALICE);
      await post(token, { runs: [RUN] });
      const first = (await sources())[0]?.last_success_at;

      await post(token, { runs: [] });
      const rows = await sources();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.last_item_count).toBe(0);
      expect(Date.parse(rows[0]?.last_success_at ?? "")).toBeGreaterThanOrEqual(
        Date.parse(first ?? ""),
      );
    });

    /** A payload that arrived and was wholly invalid still proves the
     *  collector is running and can reach us, which is all this timestamp
     *  claims. */
    it("counts a rejected payload as a check-in", async () => {
      const token = await seedUser(ALICE);
      await post(token, { runs: [{ ran_on: "nope" }] });

      const rows = await sources();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.last_item_count).toBe(0);
    });

    it("keeps one user's feed health out of another's", async () => {
      const alice = await seedUser(ALICE);
      await seedUser(BOB);
      await post(alice, { runs: [] });

      const bobs = await db
        .selectFrom("sync_sources")
        .selectAll()
        .where("user_id", "=", BOB)
        .execute();
      expect(bobs).toHaveLength(0);
    });
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
