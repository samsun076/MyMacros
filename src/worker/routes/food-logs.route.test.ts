import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DayResponse,
  FoodLogItemInput,
  FoodLogsCreated,
  RecentMeal,
  RecentsResponse,
} from "../../shared/api";
import { createDb } from "../db";
import type { AppEnv } from "../types";
import day from "./day";
import favorites from "./favorites";
import foodLogs from "./food-logs";

/** The save route's record of what the reader said (#76), against real D1.
 *
 *  These four columns can never be backfilled — the reader's numbers exist
 *  only in the confirm sheet's memory between the analyze response and the
 *  save — so the write either happens at save time or the row is lost. That
 *  is what these tests pin.
 *
 *  Mounted behind a stub that sets exactly what `requireAuth` sets, rather
 *  than forging a signed better-auth cookie. The mount-level claim (nothing
 *  under /api/food-logs is reachable without a session) is not this file's —
 *  index.route.test.ts owns it, and covers this route by name. */
const db = createDb(env as unknown as Env);
const USER = "food-logs-test-user";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("user", { id: USER, name: "Test", email: `${USER}@example.com` } as never);
  await next();
});
app.route("/api/food-logs", foodLogs);
// The day read is mounted here on purpose (#104): "NULL survives the read as
// *not recorded*" is a claim about the reader, and asserting it against the
// save route's own 201 body would only prove the row it just built.
app.route("/api/day", day);
// And the favourites route for the same reason (#117): what /recent hides is
// "a meal this user has starred", which is a claim about two routes agreeing
// on what a stored favourite looks like. Forging rows into `favorites` with
// raw SQL would let these pass against a name the star can never produce —
// `favoriteName` trims and truncates on the way in, and that is exactly the
// kind of gap where one side matches and the other doesn't.
app.route("/api/favorites", favorites);

const save = (body: unknown) =>
  app.fetch(
    new Request("https://fuel.debrief.run/api/food-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

/** The reader's numbers for a plate: the M3 device check's actual failure —
 *  confidently wrong about *what* (tofu read as fish sticks), roughly right
 *  about *how much*. `edited` records that a correction happened; only these
 *  columns record that the kcal were 30 out and the protein 5 under. */
const READ = { kcal: 240, protein_g: 15, carbs_g: 22, fat_g: 11 };

function item(over: Partial<FoodLogItemInput> = {}): FoodLogItemInput {
  return {
    name: "Buffalo cauliflower",
    ...READ,
    confidence: 0.45,
    edited: false,
    ai_kcal: READ.kcal,
    ai_protein_g: READ.protein_g,
    ai_carbs_g: READ.carbs_g,
    ai_fat_g: READ.fat_g,
    ...over,
  };
}

const meal = (over: Record<string, unknown> = {}) => ({
  logged_on: "2026-08-10",
  meal_slot: "dinner",
  source: "photo",
  items: [item()],
  ...over,
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  const now = "2026-08-10T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, now, now)
    .run();
});

describe("POST /api/food-logs — the reader's original numbers (#76)", () => {
  it("keeps both numbers when the user corrects the read", async () => {
    const res = await save(
      meal({
        items: [item({ kcal: 210, protein_g: 20, carbs_g: 18, fat_g: 9, edited: true })],
      }),
    );
    expect(res.status).toBe(201);

    const [log] = (await res.json<FoodLogsCreated>()).logs;
    // what the user saved
    expect(log).toMatchObject({ kcal: 210, protein_g: 20, carbs_g: 18, fat_g: 9, edited: 1 });
    // and what the reader had said, which is the half that used to be lost
    expect(log).toMatchObject({
      ai_kcal: 240,
      ai_protein_g: 15,
      ai_carbs_g: 22,
      ai_fat_g: 11,
    });
  });

  it("writes them equal on an unedited save, not null", async () => {
    const res = await save(meal());
    expect(res.status).toBe(201);

    const [log] = (await res.json<FoodLogsCreated>()).logs;
    // "the reader was right" and "we didn't record it" must not look the same
    expect(log?.ai_kcal).toBe(log?.kcal);
    expect(log?.ai_protein_g).toBe(log?.protein_g);
    expect(log?.ai_carbs_g).toBe(log?.carbs_g);
    expect(log?.ai_fat_g).toBe(log?.fat_g);
    expect(log?.ai_kcal).not.toBeNull();
    expect(log?.edited).toBe(0);
  });

  it("writes nulls for a favorite re-log — nothing read it", async () => {
    const res = await save(
      meal({
        source: "favorite",
        items: [
          {
            name: "Black coffee",
            kcal: 2,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
            confidence: null,
            edited: false,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);

    const [log] = (await res.json<FoodLogsCreated>()).logs;
    expect(log).toMatchObject({
      ai_kcal: null,
      ai_protein_g: null,
      ai_carbs_g: null,
      ai_fat_g: null,
    });
  });

  /** #16's blank recovery row takes the same path: the read failed, so the
   *  client sends no estimate at all rather than the zeroed placeholder the
   *  sheet opened on. Zeros here would claim the reader guessed 0 kcal. */
  it("writes nulls when the read failed and the row was typed from scratch", async () => {
    const res = await save(
      meal({
        items: [
          {
            name: "Leftover chili",
            kcal: 430,
            protein_g: 28,
            carbs_g: 40,
            fat_g: 16,
            confidence: null,
            edited: false,
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect((await res.json<FoodLogsCreated>()).logs[0]?.ai_kcal).toBeNull();
  });

  it("refuses a partial set rather than storing a row with holes", async () => {
    const res = await save(meal({ items: [item({ ai_carbs_g: undefined })] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_ai_estimate" });
    expect(await rowCount()).toBe(0);
  });

  it("refuses an out-of-range estimate", async () => {
    const res = await save(meal({ items: [item({ ai_kcal: 99_000 })] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_ai_estimate" });
    expect(await rowCount()).toBe(0);
  });

  /** One save is one meal (#10), and a partial one must not half-land: the
   *  rejection happens while rows are still being built, before the insert. */
  it("refuses the whole meal when one item's estimate is malformed", async () => {
    const res = await save({
      ...meal(),
      items: [item(), item({ name: "Rice", ai_fat_g: null })],
    });
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });
});

/** #52. Delete is the one route where getting the scope wrong destroys data
 *  rather than leaking it, and undo is the one place a *correct* delete can
 *  still end up telling a lie — see the `logged_at` tests. */
describe("DELETE /api/food-logs — the swipe (#52)", () => {
  const del = (body: unknown) =>
    app.fetch(
      new Request("https://fuel.debrief.run/api/food-logs", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env,
    );

  it("deletes every row of the meal, because an entry is a save and not a row", async () => {
    const saved = await (await save({ ...meal(), items: [item(), item({ name: "Rice" })] })).json<FoodLogsCreated>();
    expect(saved.logs).toHaveLength(2);

    const res = await del({ ids: saved.logs.map((l) => l.id) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });
    expect(await rowCount()).toBe(0);
  });

  /** The scope lives on the DELETE itself. Another user's id matches nothing
   *  rather than being caught by a check that could drift from the statement
   *  it guards. */
  it("cannot reach a row belonging to someone else", async () => {
    const saved = await (await save(meal())).json<FoodLogsCreated>();
    // A real second user: `food_logs.user_id` is a foreign key, so the row
    // cannot be re-homed to an id nobody owns — which is itself the schema
    // saying every row belongs to somebody.
    const OTHER = "food-logs-other-user";
    await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(OTHER).run();
    await env.DB.prepare(
      "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
    )
      .bind(OTHER, "Other", `${OTHER}@example.com`, "2026-08-10T00:00:00.000Z", "2026-08-10T00:00:00.000Z")
      .run();
    await env.DB.prepare("UPDATE food_logs SET user_id = ? WHERE id = ?")
      .bind(OTHER, saved.logs[0]!.id)
      .run();

    const res = await del({ ids: [saved.logs[0]!.id] });
    expect(res.status).toBe(404);

    const survivor = await env.DB.prepare("SELECT user_id FROM food_logs WHERE id = ?")
      .bind(saved.logs[0]!.id)
      .first<{ user_id: string }>();
    expect(survivor?.user_id).toBe("food-logs-other-user");
  });

  /** The undo toast is shown on the strength of this response, so "deleted
   *  nothing" must not read as "deleted it" — the ordinary way here is a
   *  double-tap through a slow network. */
  it("answers 404 rather than 200 when nothing matched", async () => {
    expect((await del({ ids: ["no-such-id"] })).status).toBe(404);
  });

  it("refuses a malformed or unbounded id list", async () => {
    for (const bad of [{}, { ids: [] }, { ids: "abc" }, { ids: [1, 2] }, { ids: Array(51).fill("x") }]) {
      expect((await del(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});

/** #52's undo, and the reason it needs a route change at all. */
describe("POST /api/food-logs — restoring an entry's own instant (#52)", () => {
  it("stamps the supplied instant on every row instead of now", async () => {
    const at = "2026-08-10T11:10:00.000Z";
    const saved = await (
      await save({ ...meal(), logged_at: at, items: [item(), item({ name: "Rice" })] })
    ).json<FoodLogsCreated>();

    expect(saved.logs.map((l) => l.logged_at)).toEqual([at, at]);
  });

  /** `foldMeals` groups by string equality on this column, so an instant that
   *  is valid but differently spelled would split one restored meal into two
   *  timeline entries. */
  it("normalises the instant it stores", async () => {
    const saved = await (
      await save({ ...meal(), logged_at: "2026-08-10T11:10:00+00:00" })
    ).json<FoodLogsCreated>();
    expect(saved.logs[0]!.logged_at).toBe("2026-08-10T11:10:00.000Z");
  });

  it("stamps now when undo isn't the caller", async () => {
    const before = Date.now();
    const saved = await (await save(meal())).json<FoodLogsCreated>();
    expect(Date.parse(saved.logs[0]!.logged_at)).toBeGreaterThanOrEqual(before);
  });

  /** A bad instant must fail loudly, not write "Invalid Date" into the column
   *  the timeline sorts on. */
  it("refuses an instant it cannot parse", async () => {
    for (const bad of ["2026", "yesterday", "2026-08-10", 1_760_000_000, "2026-13-45T00:00:00Z"]) {
      const res = await save({ ...meal(), logged_at: bad });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await rowCount()).toBe(0);
  });
});

/* ── #104: the portion, which after #58 exists for four seconds ───────────── */

/** A pizza read as two slices. `READ`'s macros are reused so the two families
 *  of columns can't be confused for each other in an assertion. */
const SLICES = { portion_qty: 2, portion_unit: "slices", ai_portion_qty: 2 };

/** What the sheet sends after the user scales 2 slices to 4: the saved qty
 *  moves, the reader's does not. `edited` stays FALSE — #58's rule, and the
 *  reason `ai_portion_qty` had to exist at all. */
const SCALED = { portion_qty: 4, portion_unit: "slices", ai_portion_qty: 2 };

const dayRead = (date: string) =>
  app.fetch(new Request(`https://fuel.debrief.run/api/day/${date}`), env);

async function storedPortion(id: string) {
  return await env.DB.prepare(
    "SELECT portion_qty, portion_unit, ai_portion_qty FROM food_logs WHERE id = ?",
  )
    .bind(id)
    .first<{ portion_qty: number | null; portion_unit: string | null; ai_portion_qty: number | null }>();
}

describe("POST /api/food-logs — the portion (#104)", () => {
  it("round-trips the saved count through D1", async () => {
    const saved = await (await save(meal({ items: [item(SLICES)] }))).json<FoodLogsCreated>();
    expect((await storedPortion(saved.logs[0]!.id))?.portion_qty).toBe(2);
  });

  it("round-trips the unit as the label the reader chose", async () => {
    const saved = await (await save(meal({ items: [item(SLICES)] }))).json<FoodLogsCreated>();
    expect((await storedPortion(saved.logs[0]!.id))?.portion_unit).toBe("slices");
  });

  /** 0006's rule, applied to the column #58 made necessary: an unscaled save
   *  writes them EQUAL, so "the reader counted right" cannot be mistaken for
   *  "nothing recorded what it counted". */
  it("writes ai_portion_qty EQUAL to portion_qty on an unscaled save", async () => {
    const saved = await (await save(meal({ items: [item(SLICES)] }))).json<FoodLogsCreated>();
    const row = await storedPortion(saved.logs[0]!.id);
    expect(row?.ai_portion_qty).toBe(row?.portion_qty);
  });

  it("does not write NULL merely because the reader was right", async () => {
    const saved = await (await save(meal({ items: [item(SLICES)] }))).json<FoodLogsCreated>();
    expect((await storedPortion(saved.logs[0]!.id))?.ai_portion_qty).not.toBeNull();
  });

  /* The three below are the assertions this whole column exists for. */

  it("stores the USER's count when the portion was scaled", async () => {
    const saved = await (await save(meal({ items: [item(SCALED)] }))).json<FoodLogsCreated>();
    expect((await storedPortion(saved.logs[0]!.id))?.portion_qty).toBe(4);
  });

  it("stores the AS-READ count beside it", async () => {
    const saved = await (await save(meal({ items: [item(SCALED)] }))).json<FoodLogsCreated>();
    expect((await storedPortion(saved.logs[0]!.id))?.ai_portion_qty).toBe(2);
  });

  /** The pair, asserted as a pair. Either value alone can be right while the
   *  row still fails to answer "was this rescaled?" — which is the question. */
  it("keeps the two counts DIFFERENT, which is the whole point of the column", async () => {
    const saved = await (await save(meal({ items: [item(SCALED)] }))).json<FoodLogsCreated>();
    const row = await storedPortion(saved.logs[0]!.id);
    expect(row?.ai_portion_qty).not.toBe(row?.portion_qty);
  });

  /** #58 moves `orig` with a rescale so `edited` stays false. That is exactly
   *  why the scaled save above is invisible to `edited` and needs its own
   *  column — pinned here so nobody "fixes" one by breaking the other. */
  it("records a scaled row as unedited, so `edited` cannot stand in for this", async () => {
    const saved = await (await save(meal({ items: [item(SCALED)] }))).json<FoodLogsCreated>();
    expect(saved.logs[0]!.edited).toBe(0);
  });

  it("carries the portion out on the day read, not just the save response", async () => {
    await save(meal({ items: [item(SCALED)] }));
    const body = await (await dayRead("2026-08-10")).json<DayResponse>();
    expect(body.logs[0]).toMatchObject({ portion_qty: 4, portion_unit: "slices", ai_portion_qty: 2 });
  });
});

describe("POST /api/food-logs — no portion is NOT a portion of one (#104)", () => {
  it("writes NULL to all three when the read proposed no portion", async () => {
    const saved = await (await save(meal())).json<FoodLogsCreated>();
    expect(await storedPortion(saved.logs[0]!.id)).toEqual({
      portion_qty: null,
      portion_unit: null,
      ai_portion_qty: null,
    });
  });

  /** The read is where "not recorded" could quietly become 0 or 1 — JSON has
   *  no NULL for a number that a `?? 1` wouldn't swallow. */
  it("reads NULL back as null, never 0 and never 1", async () => {
    await save(meal());
    const body = await (await dayRead("2026-08-10")).json<DayResponse>();
    expect(body.logs[0]).toMatchObject({
      portion_qty: null,
      portion_unit: null,
      ai_portion_qty: null,
    });
  });

  /** A favorite is a FOLDED meal — one row, one joined name — so there is no
   *  per-item portion to send and none is invented from the sum. */
  it("writes nothing for a favorite re-log", async () => {
    const res = await save(
      meal({
        source: "favorite",
        items: [
          { name: "Black coffee", kcal: 2, protein_g: 0, carbs_g: 0, fat_g: 0, confidence: null, edited: false },
        ],
      }),
    );
    const saved = await res.json<FoodLogsCreated>();
    expect(await storedPortion(saved.logs[0]!.id)).toEqual({
      portion_qty: null,
      portion_unit: null,
      ai_portion_qty: null,
    });
  });

  /** #16's blank recovery row: the read failed, so it proposed no portion.
   *  A "1" here would claim the reader had counted one of something. */
  it("writes nothing for #16's blank recovery row", async () => {
    const res = await save(
      meal({
        items: [
          { name: "Leftover chili", kcal: 430, protein_g: 28, carbs_g: 40, fat_g: 16, confidence: null, edited: false },
        ],
      }),
    );
    const saved = await res.json<FoodLogsCreated>();
    expect(await storedPortion(saved.logs[0]!.id)).toEqual({
      portion_qty: null,
      portion_unit: null,
      ai_portion_qty: null,
    });
  });

  /** What #52's undo re-posts for a portionless row: the row's own stored
   *  nulls, explicitly. Absent and explicitly-null must mean the same thing
   *  here, or every undo of a vague meal 400s. */
  it("treats three explicit nulls as absent, the way undo sends them", async () => {
    const res = await save(
      meal({ items: [item({ portion_qty: null, portion_unit: null, ai_portion_qty: null })] }),
    );
    expect(res.status).toBe(201);
  });
});

describe("POST /api/food-logs — a partial portion is refused (#104)", () => {
  /** A count with nothing to count is "1 of something unnamed" — the invented
   *  portion #58 forbids. */
  it("refuses a qty with no unit", async () => {
    expect((await save(meal({ items: [item({ portion_qty: 2, ai_portion_qty: 2 })] }))).status).toBe(400);
  });

  it("names the refusal so it isn't confused with the ai_* set", async () => {
    const res = await save(meal({ items: [item({ portion_qty: 2, ai_portion_qty: 2 })] }));
    expect(await res.json()).toEqual({ error: "invalid_portion" });
  });

  /** The one that matters most: a saved qty with no reader's qty beside it
   *  recreates 0006's forbidden ambiguity on a field that cannot be
   *  backfilled. */
  it("refuses a saved qty with no reader's qty beside it", async () => {
    expect((await save(meal({ items: [item({ portion_qty: 2, portion_unit: "slices" })] }))).status).toBe(400);
  });

  it("refuses a reader's qty describing a portion that isn't on the row", async () => {
    expect((await save(meal({ items: [item({ ai_portion_qty: 2 })] }))).status).toBe(400);
  });

  it("stores nothing at all when a portion is refused", async () => {
    await save(meal({ items: [item({ portion_qty: 2, ai_portion_qty: 2 })] }));
    expect(await rowCount()).toBe(0);
  });

  /** One save is one meal (#10): a bad portion on item two must not leave
   *  item one on the timeline. */
  it("refuses the whole meal when one item's portion is malformed", async () => {
    await save({ ...meal(), items: [item(SLICES), item({ name: "Rice", portion_qty: 1 })] });
    expect(await rowCount()).toBe(0);
  });
});

describe("POST /api/food-logs — the portion's bounds (#104)", () => {
  /* The route refuses out-of-range NUMBERS (as it does for kcal and grams)
     and truncates over-long LABELS (as it does for `name`). The ceilings and
     the 24-char unit are carried from `normalize()` in analyze.ts.

     Every case below is counted in SLICES, so 100 is the ceiling in play
     (#109 made it unit-aware — a weight gets 2,000). The unit-aware half, and
     the agreement of all three copies of the rule, live in
     `portion-limits.route.test.ts`; what stays here is this route's own
     refuse-don't-clamp behaviour, which #109 did not change. */
  it("refuses a qty past the ceiling normalize() enforces", async () => {
    expect((await save(meal({ items: [item({ ...SLICES, portion_qty: 101 })] }))).status).toBe(400);
  });

  it("refuses a reader's qty past the same ceiling", async () => {
    expect((await save(meal({ items: [item({ ...SLICES, ai_portion_qty: 4321 })] }))).status).toBe(400);
  });

  it("accepts the ceiling itself", async () => {
    expect((await save(meal({ items: [item({ ...SLICES, portion_qty: 100 })] }))).status).toBe(201);
  });

  /** A committed zero is a divide-by-zero for anything that rescales from it,
   *  and `0.04` is a positive number that becomes zero at 1dp — so the guard
   *  sits on the rounded value, not on the one that arrived. */
  it("refuses a qty that rounds away to zero at one decimal place", async () => {
    expect((await save(meal({ items: [item({ ...SLICES, portion_qty: 0.04 })] }))).status).toBe(400);
  });

  it("refuses a negative qty", async () => {
    expect((await save(meal({ items: [item({ ...SLICES, portion_qty: -2 })] }))).status).toBe(400);
  });

  it("refuses a qty that isn't a number at all", async () => {
    expect((await save(meal({ items: [item({ ...SLICES, portion_qty: "four" as never })] }))).status).toBe(400);
  });

  it("stores a fractional qty at one decimal place", async () => {
    const saved = await (
      await save(meal({ items: [item({ ...SLICES, portion_qty: 1.55, portion_unit: "cups" })] }))
    ).json<FoodLogsCreated>();
    expect((await storedPortion(saved.logs[0]!.id))?.portion_qty).toBe(1.6);
  });

  it("truncates an over-long unit to 24 characters rather than losing the meal", async () => {
    const saved = await (
      await save(meal({ items: [item({ ...SLICES, portion_unit: "s".repeat(80) })] }))
    ).json<FoodLogsCreated>();
    expect((await storedPortion(saved.logs[0]!.id))?.portion_unit).toBe("s".repeat(24));
  });

  it("refuses a unit that is only whitespace — a count of nothing named", async () => {
    expect((await save(meal({ items: [item({ ...SLICES, portion_unit: "   " })] }))).status).toBe(400);
  });
});

/** A row written before migration 0009 existed. `ALTER TABLE ADD COLUMN` with
 *  no default leaves exactly this on disk — the columns present and NULL — so
 *  an INSERT naming only 0001's columns is the real thing and not a mock of
 *  it. Every meal logged before today is one of these, permanently. */
describe("a row older than the portion columns (#104)", () => {
  const OLD = "food-logs-pre-0009";

  async function insertPreMigrationRow() {
    await env.DB.prepare(
      `INSERT INTO food_logs (id, user_id, logged_on, logged_at, meal_slot, name, kcal, protein_g, carbs_g, fat_g, source, confidence, edited)
       VALUES (?, ?, '2026-08-10', '2026-08-10T09:00:00.000Z', 'breakfast', 'Porridge', 320, 11, 54, 6, 'text', 0.6, 0)`,
    )
      .bind(OLD, USER)
      .run();
  }

  it("reads back as not-recorded rather than failing", async () => {
    await insertPreMigrationRow();
    const body = await (await dayRead("2026-08-10")).json<DayResponse>();
    expect(body.logs[0]).toMatchObject({
      portion_qty: null,
      portion_unit: null,
      ai_portion_qty: null,
    });
  });

  it("still carries everything it always did", async () => {
    await insertPreMigrationRow();
    const body = await (await dayRead("2026-08-10")).json<DayResponse>();
    expect(body.logs[0]).toMatchObject({ name: "Porridge", kcal: 320 });
  });

  it("sits beside a row that does have a portion without disturbing it", async () => {
    await insertPreMigrationRow();
    await save(meal({ items: [item(SCALED)] }));
    const body = await (await dayRead("2026-08-10")).json<DayResponse>();
    expect(body.logs.map((l) => l.portion_qty)).toEqual([null, 4]);
  });

  it("still totals the day, which is the only thing that reads it today", async () => {
    await insertPreMigrationRow();
    const body = await (await dayRead("2026-08-10")).json<DayResponse>();
    expect(body.totals.kcal).toBe(320);
  });
});

async function rowCount() {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ?")
    .bind(USER)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/* ── #115: this route is now the ONLY cap on the recents half ─────────────── */

/** `mergePicks` used to slice the joined picks list at 8 and no longer slices
 *  at all, because a cap over the join threw away *favourites* — which are
 *  chosen, and which nothing else in the app lists. What survives is this
 *  route's own `meals.length >= 8`, and it is load-bearing in a way it was not
 *  before: it is the whole reason an endless log history does not become an
 *  endless panel. Two statements of eight became one, and this is the one.
 *
 *  Fifteen meals rather than nine, so a route that had quietly grown a
 *  `.limit(10)` in front of the fold would still fail this. */
const recents = () => app.fetch(new Request("https://fuel.debrief.run/api/food-logs/recent"), env);

/** `Meal 1` … `Meal n`, oldest first, so `Meal n` is the newest. Shared by
 *  #115's cap and #117's exclusion below — the two describe the same route
 *  from either side of the same loop, and seeding it two ways would let them
 *  drift into testing two different histories. */
async function saveDistinctMeals(n: number) {
  for (let i = 1; i <= n; i++) {
    const res = await save(
      meal({
        // Distinct instants: `foldMeals` groups on `logged_at|meal_slot`, so
        // saves sharing a millisecond would fold into ONE meal and the test
        // would pass by having too little data rather than by the cap.
        logged_at: `2026-08-10T${String(i).padStart(2, "0")}:00:00.000Z`,
        items: [item({ name: `Meal ${i}` })],
      }),
    );
    if (res.status !== 201) throw new Error(`seed ${i} failed: ${res.status}`);
  }
}

/** Star a meal exactly the way the picks row does — `api.post("/api/favorites",
 *  pick.meal)`, the whole `RecentMeal` as the body. Throws rather than
 *  asserting: a star that failed to land is a broken fixture, and a fixture
 *  failure that reads as a test failure sends the next person to the wrong
 *  file. */
async function starMeal(m: Pick<RecentMeal, "name" | "kcal" | "protein_g" | "carbs_g" | "fat_g">) {
  const res = await app.fetch(
    new Request("https://fuel.debrief.run/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(m),
    }),
    env,
  );
  if (!res.ok) throw new Error(`star "${m.name}" failed: ${res.status}`);
}

describe("GET /api/food-logs/recent — the only bound on the recents half (#115)", () => {
  it("stops at eight distinct meals however long the history is", async () => {
    await saveDistinctMeals(15);
    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual([
      "Meal 15",
      "Meal 14",
      "Meal 13",
      "Meal 12",
      "Meal 11",
      "Meal 10",
      "Meal 9",
      "Meal 8",
    ]);
  });
});

/* ── #117: the cap is spent on rows the panel will actually draw ──────────── */

/** **Starring a meal used to make the shortcut list shorter.** The cap above
 *  ran first and `mergePicks` removed the starred meals afterwards, so a star
 *  did not move a meal from the recents half to the favourites half — it burned
 *  a recents slot and then vanished from it, and no older meal could take the
 *  place, because the window had already closed here. Production on 2026-08-21:
 *  nine favourites, all eight returned meals starred, recents half empty, the
 *  panel down to nine rows that no longer scrolled.
 *
 *  Every test below stars through `POST /api/favorites` rather than inserting
 *  into the table, because the claim under test is that two routes agree about
 *  what a starred meal is called. */
describe("GET /api/food-logs/recent — a star must not cost a slot (#117)", () => {
  /** The issue's own "done when", and the state production was in when it was
   *  filed. Twenty meals: eight to star, eight to prove the half refills, four
   *  spare so a route that had grown an off-by-one somewhere still fails. */
  it("refills the half from older history when every meal it returned is starred", async () => {
    await saveDistinctMeals(20);
    const first = await (await recents()).json<RecentsResponse>();
    if (first.meals.length !== 8) throw new Error(`fixture: expected 8, got ${first.meals.length}`);
    for (const m of first.meals) await starMeal(m);

    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual([
      "Meal 12",
      "Meal 11",
      "Meal 10",
      "Meal 9",
      "Meal 8",
      "Meal 7",
      "Meal 6",
      "Meal 5",
    ]);
  });

  /** One star, which is the actual gesture — A above is the accumulated state.
   *  The starred meal leaves this list and `Meal 12` arrives at the end of it,
   *  so the panel keeps every row it had and gains one.
   *
   *  **This test was first written as `expect(after.length).toBe(before.length)`
   *  and that version was decorative**: the broken route also returned eight
   *  both times — it returned the starred meal and let the client drop it, which
   *  is the entire defect. A length that cannot tell the two apart reads as
   *  coverage and is not, so the assertion is on *which* meals come back. */
  it("fills the slot a star frees with the next meal down", async () => {
    await saveDistinctMeals(20);
    const before = await (await recents()).json<RecentsResponse>();
    if (!before.meals[0]) throw new Error("fixture: nothing to star");
    await starMeal(before.meals[0]);

    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual([
      "Meal 19",
      "Meal 18",
      "Meal 17",
      "Meal 16",
      "Meal 15",
      "Meal 14",
      "Meal 13",
      "Meal 12",
    ]);
  });

  it("never lists a meal that is already starred", async () => {
    await saveDistinctMeals(3);
    await starMeal({ name: "Meal 2", kcal: 240, protein_g: 15, carbs_g: 22, fat_g: 11 });

    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual(["Meal 3", "Meal 1"]);
  });

  /** `mealNameKey`, from both sides of the wire at once: the star stores one
   *  case and the log holds another. The panel has hidden the duplicate
   *  case-insensitively since #12 and the route has to hide the same one, or a
   *  slot is spent on a row the client then removes — the defect again, wearing
   *  a capital letter. */
  it("matches the star case-insensitively, the way the panel does", async () => {
    await saveDistinctMeals(2);
    await starMeal({ name: "MEAL 2", kcal: 240, protein_g: 15, carbs_g: 22, fat_g: 11 });

    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual(["Meal 1"]);
  });

  /** The exclusion is a *meal* rule and cannot become a SQL `WHERE name NOT IN`
   *  over rows. A meal's name is the fold of its items, which is no single
   *  row's name — filtering rows would drop one item out of a three-item meal
   *  and hand back a meal with a different name and two thirds of its calories.
   *  This fails the moment anyone moves the filter into the query. */
  it("excludes whole meals, not the rows a meal is folded from", async () => {
    const res = await save(
      meal({
        items: [
          item({ name: "Chicken breast" }),
          item({ name: "Jasmine rice" }),
          item({ name: "Steamed broccoli" }),
        ],
      }),
    );
    if (res.status !== 201) throw new Error(`fixture: save failed ${res.status}`);
    await starMeal({ name: "Chicken breast", kcal: 240, protein_g: 15, carbs_g: 22, fat_g: 11 });

    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual(["Chicken breast, jasmine rice, steamed broccoli"]);
  });

  /** Empty is an honest answer here and was not before. Every meal it skipped
   *  is already on the panel one row further up, in the favourites half — so
   *  nothing is hidden, which is precisely what could not be said while the cap
   *  ran first. */
  it("returns nothing when the whole window is already on the panel", async () => {
    await saveDistinctMeals(3);
    for (const m of (await (await recents()).json<RecentsResponse>()).meals) await starMeal(m);

    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals).toEqual([]);
  });
});

/** **`SCAN_ROWS` is the other quantity, and #117 is what made it do any work.**
 *  `RECENTS_MAX` is how many meals the panel gets; this is how much history the
 *  search reads to find them, and it had never bound anything while the route
 *  returned the newest eight distinct names — the newest 60 rows always hold
 *  eight of those. Skipping starred meals spends the window, so it can now be
 *  reached, and CLAUDE.md's rule is that a bound nobody has reached has never
 *  been tested.
 *
 *  Both sides on purpose: an `expect([...])` that only checks the far edge
 *  passes just as well against a route that reads nothing at all. Sixty rows
 *  from twenty three-item saves, so the fold does the work rather than sixty
 *  round trips. */
describe("GET /api/food-logs/recent — how far back it reads (#117)", () => {
  /** `n` saves of the same three items — one distinct meal name, 3n rows. */
  async function fillRows(saves: number) {
    for (let i = 1; i <= saves; i++) {
      const res = await save(
        meal({
          logged_at: `2026-08-10T${String(i).padStart(2, "0")}:00:00.000Z`,
          items: [item({ name: "Filler" }), item({ name: "More filler" }), item({ name: "Yet more" })],
        }),
      );
      if (res.status !== 201) throw new Error(`filler ${i} failed: ${res.status}`);
    }
  }

  const older = () =>
    save(
      meal({
        logged_at: "2026-08-09T12:00:00.000Z",
        items: [item({ name: "Older meal" })],
      }),
    );

  it("reads a meal sitting on the 58th row", async () => {
    await older();
    await fillRows(19);
    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual(["Filler, more filler, yet more", "Older meal"]);
  });

  it("does not read one sitting on the 61st", async () => {
    await older();
    await fillRows(20);
    const { meals } = await (await recents()).json<RecentsResponse>();
    expect(meals.map((m) => m.name)).toEqual(["Filler, more filler, yet more"]);
  });
});
