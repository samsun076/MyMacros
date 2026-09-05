import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  DayResponse,
  FoodLog,
  FoodLogItemInput,
  FoodLogsCreated,
  FoodLogsUpdated,
  RecentMeal,
  RecentsResponse,
} from "../../shared/api";
import { foldMeals } from "../../shared/meals";
import { scaleMacros } from "../../shared/portion";
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
     the agreement of the Worker's copy with the client's, live in
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

/* ── PATCH /api/food-logs — reopening a saved entry (#60) ─────────────────── */

/** The half of #60 that no screenshot reaches.
 *
 *  The edit sheet is a surface and can be shot; what cannot be shot is that
 *  reopening a meal leaves `logged_on` where it was, that a slot change is not
 *  an override of anything the AI said, and that `confidence` and the four
 *  `ai_*` macros — the columns migration 0006 says can never be backfilled —
 *  come through untouched. Every one of those failures produces a perfectly
 *  well-formed row.
 *
 *  Against real D1 rather than a fixture, because most of these are claims
 *  about what is IN the column afterwards, and half of them are claims about
 *  columns the request never mentions.
 */
const patch = (body: unknown) =>
  app.fetch(
    new Request("https://fuel.debrief.run/api/food-logs", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

const AT = "2026-08-10T18:30:00.000Z";

/** Save a meal and hand back its rows keyed by name.
 *
 *  Keyed rather than indexed because a save's rows share one `logged_at`, so
 *  the route's `ORDER BY logged_at` is a tie and the array order is the query
 *  plan's. A test that read `logs[0]` would be asserting against whichever row
 *  SQLite happened to hand back first, which is exactly the kind of pass that
 *  survives the code being wrong.
 */
async function saveEntry(over: Record<string, unknown> = {}) {
  const res = await save(meal({ logged_at: AT, ...over }));
  if (res.status !== 201) throw new Error(`fixture save failed: ${res.status}`);
  const { logs } = await res.json<FoodLogsCreated>();
  return {
    logs,
    ids: logs.map((l) => l.id),
    byName: new Map(logs.map((l) => [l.name, l])),
  };
}

/** The three-item meal the edit sheet is actually about. */
const THREE = [
  item({ name: "Grilled chicken breast", kcal: 280, protein_g: 52, carbs_g: 0, fat_g: 6, confidence: 0.9 }),
  item({ name: "Jasmine rice", kcal: 210, protein_g: 4, carbs_g: 45, fat_g: 0, confidence: 0.6 }),
  item({ name: "Steamed broccoli", kcal: 55, protein_g: 4, carbs_g: 11, fat_g: 1, confidence: 0.85 }),
];

/** A row with a portion, whose macros are not all round numbers — 12.3 g of
 *  protein is what makes the down-scale below round rather than divide. */
const PIZZA = item({
  name: "Pizza",
  kcal: 360,
  protein_g: 12.3,
  carbs_g: 44,
  fat_g: 14,
  confidence: 0.7,
  // the reader agreed, so nothing about this row is an override before the
  // PATCH — otherwise `edited` would already be 1 and the assertions below
  // would be reading the fixture rather than the route
  ai_kcal: 360,
  ai_protein_g: 12.3,
  ai_carbs_g: 44,
  ai_fat_g: 14,
  portion_qty: 2,
  portion_unit: "slices",
  ai_portion_qty: 2,
});

/** What `EditMealSheet` sends after HOW MUCH is moved to `qty`.
 *
 *  **Through `scaleMacros`, deliberately, and it is not the test agreeing with
 *  itself.** The route does not call this to decide anything — it recomputes
 *  from the *stored* row, which is a different input reached by a different
 *  path. What this stands in for is the client, which really does call this
 *  function (`setPortionQty`); writing the expected figures out by hand here
 *  would be testing a request no sheet produces, which is exactly how the old
 *  portion test managed to be green against a broken route. The figures
 *  themselves are asserted literally above (720 / 28 / 88 / 28, and 90 on the
 *  way down), so a `scaleMacros` that started returning nonsense fails there. */
function scaled(row: FoodLog, qty: number) {
  const m = scaleMacros(
    { kcal: row.kcal, protein_g: row.protein_g, carbs_g: row.carbs_g, fat_g: row.fat_g },
    row.portion_qty as number,
    qty,
  );
  if (!m) throw new Error("fixture: row has no portion to scale from");
  return m;
}

/** Turn a stored row into the item the sheet would send back unchanged. Only
 *  the six editable fields — everything else is deliberately unsayable on the
 *  wire (see `FoodLogItemEdit`), and a helper that sent more would be testing a
 *  request the client cannot make. */
const asIs = (row: FoodLog) => ({
  id: row.id,
  name: row.name,
  kcal: row.kcal,
  protein_g: row.protein_g,
  carbs_g: row.carbs_g,
  fat_g: row.fat_g,
  ...(row.portion_qty !== null ? { portion_qty: row.portion_qty } : {}),
});

const OTHER = "food-logs-other-user";
const OTHER_ROW = "other-row";

/** A row belonging to somebody else, written with raw SQL because the stub
 *  above only ever authenticates as `USER` — and the claim under test is about
 *  the WHERE clause, not about how the row got there. */
async function seedOtherUsersRow() {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(OTHER).run();
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(OTHER, "Other", `${OTHER}@example.com`, AT, AT)
    .run();
  await env.DB.prepare(
    `INSERT INTO food_logs (id, user_id, logged_on, logged_at, meal_slot, name, kcal, protein_g, carbs_g, fat_g, source, confidence, edited)
     VALUES (?, ?, '2026-08-10', ?, 'dinner', 'Their dinner', 700, 40, 50, 20, 'text', 0.8, 0)`,
  )
    .bind(OTHER_ROW, OTHER, AT)
    .run();
}

/** Read one row straight out of D1 — the response body is this route's own
 *  account of what it did, and half of these assertions are about whether that
 *  account is true. */
async function storedRow(id: string) {
  return await env.DB.prepare("SELECT * FROM food_logs WHERE id = ?").bind(id).first<FoodLog>();
}

describe("PATCH /api/food-logs — the entry it may touch (#60)", () => {
  /** The rule every route in this app carries, on the statement rather than in
   *  front of it. The ids come from the request, so a "does this belong to
   *  them" read followed by an unscoped write is two statements that can
   *  disagree — and here the disagreement rewrites someone else's dinner. */
  /** **Two `it`s for one request, deliberately.** The status and the state of
   *  the row afterwards are separate facts, and an assertion sitting after a
   *  failed one never runs — so a single test would report "expected 404, got
   *  200" and say *nothing at all* about whether someone else's dinner had
   *  just been overwritten, which is the half that matters. Verified: with the
   *  scope removed from the SELECT, the one-test version reported only the
   *  status and left two assertions unexecuted. */
  it("answers 404 for another user's row", async () => {
    await seedOtherUsersRow();
    const res = await patch({
      ids: [OTHER_ROW],
      meal_slot: "breakfast",
      items: [{ id: OTHER_ROW, name: "Mine now", kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    });
    expect(res.status).toBe(404);
  });

  it("leaves another user's row exactly as it was", async () => {
    await seedOtherUsersRow();
    await patch({
      ids: [OTHER_ROW],
      meal_slot: "breakfast",
      items: [{ id: OTHER_ROW, name: "Mine now", kcal: 1, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    });
    const after = await storedRow(OTHER_ROW);
    expect(after).toMatchObject({ name: "Their dinner", kcal: 700, meal_slot: "dinner", user_id: OTHER });
  });

  /** A short read is what a stale client looks like, and rewriting the group
   *  from a stale list would silently drop whatever the client could not see. */
  it("refuses when one of the ids resolves to nothing", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    const res = await patch({
      ids: [...ids, "no-such-row"],
      meal_slot: "dinner",
      items: logs.map(asIs),
    });
    expect(res.status).toBe(404);
  });

  it("writes nothing when one of the ids resolves to nothing", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    await patch({ ids: [...ids, "no-such-row"], meal_slot: "dinner", items: logs.map(asIs) });
    expect(await rowCount()).toBe(3);
  });

  /** Two meals in one list would be merged into one, and no undo covers that.
   *  `foldMeals` groups on `logged_at|meal_slot`, so "one entry" is exactly
   *  what this checks. */
  it("refuses a list that spans two entries", async () => {
    const a = await saveEntry({ items: [item({ name: "Breakfast thing" })] });
    const b = await saveEntry({
      logged_at: "2026-08-10T20:00:00.000Z",
      items: [item({ name: "Dinner thing" })],
    });
    const res = await patch({
      ids: [...a.ids, ...b.ids],
      meal_slot: "dinner",
      items: [...a.logs, ...b.logs].map(asIs),
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("mixed_entry");
  });

  /** An id outside the entry would make the "rows nobody claimed are removed"
   *  pass delete a row the client never mentioned. */
  it("refuses an item claiming a row outside the entry", async () => {
    const a = await saveEntry({ items: [item({ name: "Mine" })] });
    const b = await saveEntry({
      logged_at: "2026-08-10T20:00:00.000Z",
      items: [item({ name: "Also mine, elsewhere" })],
    });
    const res = await patch({
      ids: a.ids,
      meal_slot: "dinner",
      items: [{ ...asIs(a.logs[0] as FoodLog), id: b.ids[0] }],
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_item_id");
  });

  /** **A duplicated id is caught by the length comparison, not by a separate
   *  check**, and that is load-bearing enough to be executable rather than
   *  reasoned: `WHERE id IN ('a','a')` returns one row, so `stored.length` is
   *  1 against an `ids.length` of 2 and the request is refused. If it were
   *  not, the entry would be rewritten from an item list that could claim
   *  fewer rows than `ids` names, and the "rows nobody claimed are removed"
   *  pass would delete the difference. */
  it("refuses a duplicated id", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Only one" })] });
    const res = await patch({
      ids: [ids[0] as string, ids[0] as string],
      meal_slot: "dinner",
      items: [asIs(logs[0] as FoodLog)],
    });
    expect(res.status).toBe(404);
  });

  it("still has the entry after a duplicated id is refused", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Only one" })] });
    await patch({
      ids: [ids[0] as string, ids[0] as string],
      meal_slot: "dinner",
      items: [asIs(logs[0] as FoodLog)],
    });
    expect(await rowCount()).toBe(1);
  });

  it("refuses the same row claimed by two items", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Only one" })] });
    const one = asIs(logs[0] as FoodLog);
    const res = await patch({ ids, meal_slot: "dinner", items: [one, { ...one, name: "Copy" }] });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_item_id");
  });
});

describe("PATCH /api/food-logs — what an edit may never move (#60)", () => {
  /** #44's set-once rule, and the reason the day a meal belongs to is not
   *  recomputed: correcting last night's dinner at 00:20 must not move it to
   *  today. There is no field on the wire that could ask for this — the test is
   *  that nothing derives it either. */
  it("leaves logged_on and logged_at exactly where they were", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    const res = await patch({
      ids,
      meal_slot: "breakfast",
      items: logs.map((l) => ({ ...asIs(l), kcal: l.kcal + 5 })),
    });
    expect(res.status).toBe(200);
    for (const l of (await res.json<FoodLogsUpdated>()).logs) {
      expect(l.logged_on).toBe("2026-08-10");
      expect(l.logged_at).toBe(AT);
    }
  });

  /** `logged_at` is `foldMeals`' group key. A route that re-stamped it would
   *  split one meal into two timeline entries, or merge it into a neighbour —
   *  so this asserts on the fold rather than on the column. */
  it("still folds to ONE timeline entry afterwards", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    await patch({ ids, meal_slot: "lunch", items: logs.map(asIs) });
    const body = await (await app.fetch(new Request("https://fuel.debrief.run/api/day/2026-08-10"), env)).json<DayResponse>();
    expect(foldMeals(body.logs)).toHaveLength(1);
  });

  /** `photo_key`, `barcode` and `source` describe how the meal was captured.
   *  Retyping its numbers does not retroactively make a photographed meal a
   *  typed one. */
  it("keeps photo_key, barcode and source through an edit", async () => {
    const { logs, ids } = await saveEntry({
      source: "barcode",
      barcode: "748927022728",
      photo_key: `${USER}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`,
      items: [item({ name: "Whey, chocolate" })],
    });
    const res = await patch({
      ids,
      meal_slot: "snack",
      items: [{ ...asIs(logs[0] as FoodLog), kcal: 130 }],
    });
    expect(res.status).toBe(200);
    const [row] = (await res.json<FoodLogsUpdated>()).logs;
    expect(row).toMatchObject({
      source: "barcode",
      barcode: "748927022728",
      photo_key: `${USER}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`,
      kcal: 130,
    });
  });

  /** **Preserved, never nulled.** An item whose macros the user has replaced
   *  still has a meaningful record of what the read *claimed* — that is the
   *  whole of #75's question, and `edited` is the flag that says the estimate
   *  was overridden. Nulling it would destroy the only statement of how sure
   *  the reader was, on exactly the rows where it is most interesting. */
  it("keeps confidence on a row whose numbers were replaced", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Tofu", confidence: 0.45 })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), kcal: 120, protein_g: 14 }],
    });
    const [row] = (await res.json<FoodLogsUpdated>()).logs;
    expect(row?.confidence).toBe(0.45);
    expect(row?.edited).toBe(1);
  });

  /** The four columns migration 0006 says can never be backfilled. An edit is
   *  precisely the moment they become interesting — the row now records what
   *  the reader said AND what it actually was — so overwriting them with the
   *  new figures would delete the answer at the moment the question arises. */
  it("keeps the reader's own numbers, so the pair stays subtractable", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Fish sticks" })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), kcal: 180, protein_g: 20, carbs_g: 10, fat_g: 8 }],
    });
    const [row] = (await res.json<FoodLogsUpdated>()).logs;
    expect(row).toMatchObject({ kcal: 180, protein_g: 20, carbs_g: 10, fat_g: 8 });
    expect(row).toMatchObject({ ai_kcal: 240, ai_protein_g: 15, ai_carbs_g: 22, ai_fat_g: 11 });
  });

  /** Surviving rows keep their identity, so `created_at` still means "when
   *  this food was logged" rather than "when the sheet was last saved". A
   *  delete-and-reinsert implementation renders identically and fails here. */
  it("edits the row in place rather than replacing it", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "In place" })] });
    const before = logs[0] as FoodLog;
    /* A real millisecond, because `updated_at` is stamped from the wall clock
       and the column holds milliseconds: on a fast machine the save and the
       edit land inside the same one, and the last assertion below fails for a
       reason that has nothing to do with the route. Caught on the first full
       run after the file was written — the two timestamps were equal to the
       digit. A test whose result depends on how fast the laptop is gets
       deleted, so the wait is the fix rather than a weaker assertion. */
    await new Promise((r) => setTimeout(r, 5));
    const res = await patch({ ids, meal_slot: "dinner", items: [{ ...asIs(before), kcal: 300 }] });
    const [after] = (await res.json<FoodLogsUpdated>()).logs;
    expect(after?.id).toBe(before.id);
    expect(after?.created_at).toBe(before.created_at);
    expect(after?.updated_at).not.toBe(before.updated_at);
  });

  /** `updated_at` goes on meaning "this row last changed" rather than
   *  "somebody last opened the sheet". */
  it("writes nothing at all when the sheet is saved unchanged", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    const res = await patch({ ids, meal_slot: "dinner", items: logs.map(asIs) });
    expect(res.status).toBe(200);
    for (const l of (await res.json<FoodLogsUpdated>()).logs) {
      const before = logs.find((o) => o.id === l.id);
      expect(l.updated_at).toBe(before?.updated_at);
    }
  });
});

describe("PATCH /api/food-logs — what `edited` means (#60)", () => {
  /** The pre-save meaning, extended: the user overrode the AI's numbers. */
  it("is set by a numeric change", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Corrected" })] });
    const res = await patch({ ids, meal_slot: "dinner", items: [{ ...asIs(logs[0] as FoodLog), kcal: 199 }] });
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.edited).toBe(1);
  });

  it("is set by a name change, the way the confirm sheet counts one", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Fish sticks" })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), name: "Tofu" }],
    });
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.edited).toBe(1);
  });

  /** **A slot is not something the AI said.** This is the case the issue calls
   *  out by name, and the one a client-supplied `edited` would get wrong
   *  silently. */
  it("is NOT set by a slot-only change", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    const res = await patch({ ids, meal_slot: "breakfast", items: logs.map(asIs) });
    for (const l of (await res.json<FoodLogsUpdated>()).logs) {
      expect(l.meal_slot).toBe("breakfast");
      expect(l.edited).toBe(0);
    }
  });

  /** #58 is explicit that eating four slices instead of two overrides nothing —
   *  the reader was right about a slice — and `ai_portion_qty` exists precisely
   *  because `edited` must not answer this question.
   *
   *  **The version of this test that only moved `portion_qty` was passing while
   *  the route was wrong**, which is worth recording as its own lesson. The
   *  edit sheet rescales every macro the instant HOW MUCH is touched, so a
   *  request carrying a new quantity beside *unchanged* macros is one no client
   *  can produce — the test was green because it described a state the app
   *  never reaches. `scaled()` below sends what the sheet actually sends.
   *
   *  Found by driving the route, not by reading it: `2 → 4` slices came back
   *  `edited = 1`, on a row whose name was identical and whose 720 kcal was
   *  exactly 2× the stored 360. */
  it("is NOT set by a portion change, which rescales every macro with it", async () => {
    const { logs, ids } = await saveEntry({ items: [PIZZA] });
    const stored = logs[0] as FoodLog;
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(stored), ...scaled(stored, 4), portion_qty: 4 }],
    });
    expect(res.status).toBe(200);
    const [row] = (await res.json<FoodLogsUpdated>()).logs;
    // the rescale did land — a route that ignored the macros would also pass
    // the `edited` assertion below, and pass it for the wrong reason
    expect(row).toMatchObject({ portion_qty: 4, kcal: 720, protein_g: 24.6, carbs_g: 88, fat_g: 28 });
  });

  it("leaves `edited` at 0 after a portion-only change", async () => {
    const { logs, ids } = await saveEntry({ items: [PIZZA] });
    const stored = logs[0] as FoodLog;
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(stored), ...scaled(stored, 4), portion_qty: 4 }],
    });
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.edited).toBe(0);
  });

  /** Scaling DOWN, because a halving rounds where a doubling does not: 2 → 4
   *  slices is exact arithmetic on every figure, where 2 → 1 turns 12.3 g of
   *  protein into 6.15 and `round1` has to land it on 6.2. That is the only
   *  figure in this file whose value depends on *which* rounding the two sides
   *  use, so it is the direction that breaks first if they ever stop sharing
   *  `scaleMacros`. */
  it("leaves `edited` at 0 when the portion goes down and the figures round", async () => {
    const { logs, ids } = await saveEntry({ items: [PIZZA] });
    const stored = logs[0] as FoodLog;
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(stored), ...scaled(stored, 1), portion_qty: 1 }],
    });
    const [row] = (await res.json<FoodLogsUpdated>()).logs;
    expect(row).toMatchObject({ portion_qty: 1, kcal: 180, protein_g: 6.2, edited: 0 });
  });

  /** **The inverse, and the reason a tolerance was refused.** A portion change
   *  AND a hand-edit in one save is still a correction: the part the rescale
   *  does not explain is exactly the part the user typed. One kilocalorie off
   *  the rescaled figure is enough, because with both sides calling
   *  `scaleMacros` the only way to be one off is to have typed it. */
  it("IS set when a portion change is accompanied by a hand-edit", async () => {
    const { logs, ids } = await saveEntry({ items: [PIZZA] });
    const stored = logs[0] as FoodLog;
    const rescaled = scaled(stored, 4);
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(stored), ...rescaled, kcal: rescaled.kcal + 1, portion_qty: 4 }],
    });
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.edited).toBe(1);
  });

  /** And a rename is an override whatever the amount did — the reader was wrong
   *  about *what it was*, which no quantity explains. */
  it("IS set when a portion change is accompanied by a rename", async () => {
    const { logs, ids } = await saveEntry({ items: [PIZZA] });
    const stored = logs[0] as FoodLog;
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(stored), ...scaled(stored, 4), name: "Calzone", portion_qty: 4 }],
    });
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.edited).toBe(1);
  });

  /** A hand-edit with NO portion in play at all — the case the fix must not
   *  have weakened, and the one every other `edited` assertion here rests on. */
  it("IS set by a hand-edit on a row that has a portion and did not move it", async () => {
    const { logs, ids } = await saveEntry({ items: [PIZZA] });
    const stored = logs[0] as FoodLog;
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(stored), kcal: 400 }],
    });
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.edited).toBe(1);
  });

  /** Un-setting it would claim the reader had been agreed with, on a row where
   *  somebody had already said otherwise. */
  it("stays set on a row that was already edited", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Already", edited: true, kcal: 300 })] });
    expect(logs[0]?.edited).toBe(1);
    const res = await patch({ ids, meal_slot: "dinner", items: [asIs(logs[0] as FoodLog)] });
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.edited).toBe(1);
  });
});

describe("PATCH /api/food-logs — the portion (#60, #104)", () => {
  it("round-trips the user's count and leaves the unit alone", async () => {
    const { logs, ids } = await saveEntry({
      items: [item({ name: "Chicken", portion_qty: 200, portion_unit: "g", ai_portion_qty: 100 })],
    });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), portion_qty: 250 }],
    });
    const [row] = (await res.json<FoodLogsUpdated>()).logs;
    expect(row).toMatchObject({ portion_qty: 250, portion_unit: "g", ai_portion_qty: 100 });
  });

  /** The bound follows the STORED unit (#109), never the body's — 250 g is
   *  Tuesday and 250 slices is a slipped thumb, and the label that decides
   *  which is already on the row. */
  it("accepts a measured qty a counted ceiling would refuse", async () => {
    const { logs, ids } = await saveEntry({
      items: [item({ name: "Chicken", portion_qty: 200, portion_unit: "g", ai_portion_qty: 200 })],
    });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), portion_qty: 900 }],
    });
    expect(res.status).toBe(200);
    expect((await res.json<FoodLogsUpdated>()).logs[0]?.portion_qty).toBe(900);
  });

  it("refuses a counted qty past the counted ceiling", async () => {
    const { logs, ids } = await saveEntry({
      items: [item({ name: "Pizza", portion_qty: 2, portion_unit: "slices", ai_portion_qty: 2 })],
    });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), portion_qty: 900 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_portion");
  });

  /** A portion nobody read is #58's invented "1 serving". The sheet draws no
   *  control for such a row; this is the refusal underneath it. */
  it("refuses a portion on a row that never had one", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "Had lunch out" })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), portion_qty: 3 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_portion");
  });

  it("leaves a stored portion alone when the body omits it", async () => {
    const { logs, ids } = await saveEntry({
      items: [item({ name: "Pizza", portion_qty: 2, portion_unit: "slices", ai_portion_qty: 2 })],
    });
    const bare = { ...asIs(logs[0] as FoodLog), kcal: 999 };
    delete (bare as { portion_qty?: number }).portion_qty;
    const res = await patch({ ids, meal_slot: "dinner", items: [bare] });
    const [row] = (await res.json<FoodLogsUpdated>()).logs;
    expect(row).toMatchObject({ portion_qty: 2, portion_unit: "slices", ai_portion_qty: 2, kcal: 999 });
  });
});

describe("PATCH /api/food-logs — removing and adding items (#60)", () => {
  /** #52 deferred per-item deletion to exactly here. */
  it("removes the rows the item list no longer claims", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    const keep = logs.filter((l) => l.name !== "Jasmine rice");
    const res = await patch({ ids, meal_slot: "dinner", items: keep.map(asIs) });
    expect(res.status).toBe(200);
    expect((await res.json<FoodLogsUpdated>()).logs).toHaveLength(2);
    expect(await rowCount()).toBe(2);
  });

  /** **The refusal design call 3 is about.** Emptying an entry is a delete, and
   *  #52's swipe is the delete — it has an undo toast and a restore path. A
   *  PATCH that emptied one would be a second delete with no way back. */
  it("refuses an empty item list", async () => {
    const { ids } = await saveEntry({ items: THREE });
    const res = await patch({ ids, meal_slot: "dinner", items: [] });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("items_required");
  });

  /** Separated from the refusal above for the isolation pair's reason: this is
   *  the assertion about the entry still existing, and in the one-test version
   *  it never ran — a mutation that accepted the empty list reported a status
   *  and stayed silent about the three rows it had just deleted. */
  it("still has the entry after an empty item list is refused", async () => {
    const { ids } = await saveEntry({ items: THREE });
    await patch({ ids, meal_slot: "dinner", items: [] });
    expect(await rowCount()).toBe(3);
  });

  it("refuses a basket past the cap POST already refuses", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "One" })] });
    const extra = Array.from({ length: 20 }, (_, i) => ({
      name: `Added ${i}`,
      kcal: 10,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    }));
    const res = await patch({ ids, meal_slot: "dinner", items: [asIs(logs[0] as FoodLog), ...extra] });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("items_required");
  });

  /** An added row is #16's blank recovery row with a meal already around it:
   *  nothing read it, so it carries no confidence, no `ai_*` and no portion,
   *  and `source` is `text` rather than the entry's — the meal was
   *  photographed, this food was typed. */
  it("adds a row with no provenance it did not earn", async () => {
    const { logs, ids } = await saveEntry({
      source: "photo",
      photo_key: `${USER}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`,
      items: [item({ name: "Photographed plate" })],
    });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [asIs(logs[0] as FoodLog), { name: "Olive oil", kcal: 90, protein_g: 0, carbs_g: 0, fat_g: 10 }],
    });
    expect(res.status).toBe(200);
    const added = (await res.json<FoodLogsUpdated>()).logs.find((l) => l.name === "Olive oil");
    expect(added).toMatchObject({
      source: "text",
      photo_key: null,
      barcode: null,
      confidence: null,
      edited: 0,
      ai_kcal: null,
      portion_qty: null,
      portion_unit: null,
      ai_portion_qty: null,
    });
  });

  /** The added row joins the entry, which means taking its instant and its day
   *  — the only way `foldMeals` will ever put it in the same meal. */
  it("joins the added row to the entry rather than starting a new one", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "First" })] });
    await patch({
      ids,
      meal_slot: "dinner",
      items: [asIs(logs[0] as FoodLog), { name: "Second", kcal: 50, protein_g: 1, carbs_g: 2, fat_g: 3 }],
    });
    const body = await (await app.fetch(new Request("https://fuel.debrief.run/api/day/2026-08-10"), env)).json<DayResponse>();
    const folded = foldMeals(body.logs);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.rows).toHaveLength(2);
    expect(folded[0]?.name).toBe("First, second");
  });

  it("refuses a portion on an added row, which nothing read", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "First" })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [
        asIs(logs[0] as FoodLog),
        { name: "Invented", kcal: 50, protein_g: 1, carbs_g: 2, fat_g: 3, portion_qty: 2 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_portion");
  });

  it("refuses an item with no name, and writes nothing when it does", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [...logs.map(asIs), { name: "   ", kcal: 10, protein_g: 0, carbs_g: 0, fat_g: 0 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_item");
    expect(await rowCount()).toBe(3);
  });

  it("refuses a kcal past the ceiling POST refuses", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "One" })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), kcal: 99_000 }],
    });
    expect(res.status).toBe(400);
    expect((await res.json<{ error: string }>()).error).toBe("invalid_item");
  });

  it("refuses a meal slot outside the four", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "One" })] });
    const res = await patch({ ids, meal_slot: "brunch", items: [asIs(logs[0] as FoodLog)] });
    expect(res.status).toBe(400);
  });

  /** A removal and an addition in one save, which is what actually happens when
   *  somebody corrects a meal — and the case where a route that deleted before
   *  it validated would already have destroyed a row. */
  it("removes, edits and adds in one request, or does none of it", async () => {
    const { logs, ids } = await saveEntry({ items: THREE });
    const chicken = logs.find((l) => l.name === "Grilled chicken breast") as FoodLog;
    const rice = logs.find((l) => l.name === "Jasmine rice") as FoodLog;
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [
        { ...asIs(chicken), kcal: 310 },
        asIs(rice),
        { name: "Olive oil", kcal: 90, protein_g: 0, carbs_g: 0, fat_g: 10 },
      ],
    });
    expect(res.status).toBe(200);
    const names = (await res.json<FoodLogsUpdated>()).logs.map((l) => l.name).sort();
    expect(names).toEqual(["Grilled chicken breast", "Jasmine rice", "Olive oil"]);
    expect(await rowCount()).toBe(3);
    expect((await storedRow(chicken.id))?.kcal).toBe(310);
  });
});

/* ── #81: one meal, several captures ───────────────────────────────────────── */

/** Scan the chicken patty, scan its bun, type the mustard — one save, one
 *  timeline entry, three sources.
 *
 *  Nothing here needed a migration and that is the point: `source`, `photo_key`
 *  and `barcode` have been per-row columns since 0001, and what #81 adds is a
 *  wire that can say so. So these tests are mostly about the *fallback* — an
 *  item that names none of the three takes the body's, which is what every
 *  single-capture save in the app has always done and must go on doing
 *  byte-for-byte.
 *
 *  One assertion per `it` wherever two facts are separable. #60's own note says
 *  why: an assertion after a failed one never runs, and "expected 400, got 201"
 *  says nothing about whether the row it should not have written exists. */

const PHOTO_KEY = `${USER}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`;
const OTHER_PHOTO_KEY = "food-logs-other-user/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg";

/** The issue's lunch, as the confirm sheet's basket would send it: body-level
 *  values from the FIRST capture, every item stating its own. */
const BASKET = {
  logged_on: "2026-08-10",
  meal_slot: "lunch",
  source: "barcode",
  barcode: "5000112637922",
  items: [
    {
      ...item({ name: "Chicken patty", kcal: 190, protein_g: 23, carbs_g: 9.5, fat_g: 7, confidence: null }),
      ai_kcal: 190,
      ai_protein_g: 23,
      ai_carbs_g: 9.5,
      ai_fat_g: 7,
      source: "barcode",
      photo_key: null,
      barcode: "5000112637922",
    },
    {
      ...item({ name: "Brioche bun", kcal: 250, protein_g: 8, carbs_g: 42, fat_g: 5.5, confidence: null }),
      ai_kcal: 250,
      ai_protein_g: 8,
      ai_carbs_g: 42,
      ai_fat_g: 5.5,
      source: "barcode",
      photo_key: null,
      barcode: "8712566341726",
    },
    {
      ...item({ name: "Yellow mustard", kcal: 15, protein_g: 0.9, carbs_g: 1.4, fat_g: 0.6, confidence: 0.7 }),
      ai_kcal: 15,
      ai_protein_g: 0.9,
      ai_carbs_g: 1.4,
      ai_fat_g: 0.6,
      source: "text",
      photo_key: null,
      barcode: null,
    },
  ],
};

describe("POST /api/food-logs — one meal from several captures (#81)", () => {
  it("accepts a body whose items name their own capture", async () => {
    expect((await save(BASKET)).status).toBe(201);
  });

  it("writes every capture's rows under one shared logged_at", async () => {
    // The claim the whole feature rests on: the shared instant is what folds
    // these back into a single timeline entry (#10), so two scans and a typed
    // line are one row on Today rather than three.
    //
    // Split from the status above deliberately (#60's note): an assertion after
    // a failed one never runs, so a single test would report "expected 201, got
    // 400" and say nothing at all about the instant, which is the half the
    // feature rests on.
    const { logs } = await (await save(BASKET)).json<FoodLogsCreated>();
    expect(new Set(logs.map((l) => l.logged_at)).size).toBe(1);
  });

  it("keeps each row's own source through a mixed save", async () => {
    const res = await save(BASKET);
    const { logs } = await res.json<FoodLogsCreated>();
    const byName = new Map(logs.map((l) => [l.name, l]));
    expect([
      byName.get("Chicken patty")?.source,
      byName.get("Brioche bun")?.source,
      byName.get("Yellow mustard")?.source,
    ]).toEqual(["barcode", "barcode", "text"]);
  });

  it("keeps each row's own barcode, including the one that has none", async () => {
    // Collapsing a basket to one code would put the patty's barcode on the
    // mustard — a row claiming to be a scan of a product it is not.
    const res = await save(BASKET);
    const { logs } = await res.json<FoodLogsCreated>();
    const byName = new Map(logs.map((l) => [l.name, l]));
    expect([
      byName.get("Chicken patty")?.barcode,
      byName.get("Brioche bun")?.barcode,
      byName.get("Yellow mustard")?.barcode,
    ]).toEqual(["5000112637922", "8712566341726", null]);
  });

  it("folds a mixed save into exactly one meal", async () => {
    // Asserted through `foldMeals` rather than by eye, because the fold is what
    // the Today timeline and the recents list both run — this is the claim the
    // issue's "Done when" makes, stated in the function that decides it.
    await save(BASKET);
    const rows = await env.DB.prepare(
      "SELECT * FROM food_logs WHERE user_id = ? AND logged_on = '2026-08-10' AND meal_slot = 'lunch'",
    )
      .bind(USER)
      .all<FoodLog>();
    expect(foldMeals(rows.results).length).toBe(1);
  });

  it("sums a mixed save's calories into that one entry", async () => {
    await save(BASKET);
    const rows = await env.DB.prepare(
      "SELECT * FROM food_logs WHERE user_id = ? AND logged_on = '2026-08-10' AND meal_slot = 'lunch'",
    )
      .bind(USER)
      .all<FoodLog>();
    expect(foldMeals(rows.results)[0]?.kcal).toBe(455);
  });

  it("names all three foods in the entry's description", async () => {
    await save(BASKET);
    const rows = await env.DB.prepare(
      "SELECT * FROM food_logs WHERE user_id = ? AND logged_on = '2026-08-10' AND meal_slot = 'lunch' ORDER BY rowid",
    )
      .bind(USER)
      .all<FoodLog>();
    expect(foldMeals(rows.results)[0]?.name).toBe("Chicken patty, brioche bun, yellow mustard");
  });

  it("keeps `edited` per row inside a mixed save", async () => {
    // `edited` answers "did the user override the reader?", one food at a time.
    // A basket that flattened it would report the whole meal as corrected
    // because one item in it was.
    const res = await save({
      ...BASKET,
      items: [
        BASKET.items[0],
        { ...BASKET.items[1], edited: true, kcal: 300 },
        BASKET.items[2],
      ],
    });
    const { logs } = await res.json<FoodLogsCreated>();
    const byName = new Map(logs.map((l) => [l.name, l]));
    expect([
      byName.get("Chicken patty")?.edited,
      byName.get("Brioche bun")?.edited,
      byName.get("Yellow mustard")?.edited,
    ]).toEqual([0, 1, 0]);
  });
});

describe("POST /api/food-logs — a per-item photo key is checked on its own (#81)", () => {
  /** **The R2 prefix IS the authorization check** (`worker/photos.ts`), and the
   *  check the body-level key goes through vouches for exactly one string. A
   *  key arriving on an item has been through nothing unless this route puts it
   *  through `ownedPhotoKey` itself — so these two tests are the ones that fail
   *  if that call is ever removed, and the body-level tests above are not. */
  const withOwnKey = () =>
    save({
      ...BASKET,
      source: "photo",
      photo_key: PHOTO_KEY,
      items: [
        { ...BASKET.items[0], source: "photo", photo_key: PHOTO_KEY },
        BASKET.items[2],
      ],
    });

  it("accepts a per-item key that is under the caller's own prefix", async () => {
    expect((await withOwnKey()).status).toBe(201);
  });

  it("stores that key on the row that named it", async () => {
    const { logs } = await (await withOwnKey()).json<FoodLogsCreated>();
    expect(logs.find((l) => l.name === "Chicken patty")?.photo_key).toBe(PHOTO_KEY);
  });

  it("refuses a per-item key belonging to another user", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], photo_key: OTHER_PHOTO_KEY }, BASKET.items[2]],
    });
    expect(res.status).toBe(400);
  });

  it("names the refusal so the client can tell it from a bad macro", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], photo_key: OTHER_PHOTO_KEY }, BASKET.items[2]],
    });
    expect((await res.json<{ error: string }>()).error).toBe("invalid_photo_key");
  });

  it("writes NO rows when one item's key is refused", async () => {
    // The half that a status assertion cannot reach: the loop validates every
    // item before a single INSERT runs, so a refusal partway through must leave
    // the table exactly as it was rather than half a meal.
    const before = await rowCount();
    await save({
      ...BASKET,
      items: [BASKET.items[0], { ...BASKET.items[1], photo_key: OTHER_PHOTO_KEY }],
    });
    expect(await rowCount()).toBe(before);
  });

  it("refuses a per-item key that is not a well-formed key at all", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], photo_key: `${USER}/../../etc/passwd` }, BASKET.items[2]],
    });
    expect(res.status).toBe(400);
  });

  it("an explicit null per-item key means NO photo, not the body's", async () => {
    // The distinction the mixed basket needs: the body carries the
    // photographed capture's key so the meal still has a thumbnail, and the
    // hand-typed food in the same save has to be able to say the photo does
    // not show it.
    const res = await save({
      ...BASKET,
      source: "photo",
      photo_key: PHOTO_KEY,
      items: [{ ...BASKET.items[2], photo_key: null }],
    });
    expect((await res.json<FoodLogsCreated>()).logs[0]?.photo_key).toBe(null);
  });
});

describe("POST /api/food-logs — a per-item barcode is validated like the body's (#81)", () => {
  it("refuses a per-item barcode that is not 8–14 digits", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], barcode: "12345" }, BASKET.items[2]],
    });
    expect(res.status).toBe(400);
  });

  it("names that refusal invalid_barcode", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], barcode: "12345" }, BASKET.items[2]],
    });
    expect((await res.json<{ error: string }>()).error).toBe("invalid_barcode");
  });

  it("refuses a per-item barcode carrying anything but digits", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], barcode: "5000112637a2" }, BASKET.items[2]],
    });
    expect(res.status).toBe(400);
  });

  it("accepts a 14-digit per-item code", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], barcode: "50001126379221" }],
    });
    expect((await res.json<FoodLogsCreated>()).logs[0]?.barcode).toBe("50001126379221");
  });

  it("refuses a per-item source outside the four the column allows", async () => {
    const res = await save({
      ...BASKET,
      items: [{ ...BASKET.items[0], source: "guess" }],
    });
    expect(res.status).toBe(400);
  });

  it("names that refusal invalid_item_source", async () => {
    const res = await save({ ...BASKET, items: [{ ...BASKET.items[0], source: "guess" }] });
    expect((await res.json<{ error: string }>()).error).toBe("invalid_item_source");
  });
});

describe("POST /api/food-logs — an item that says nothing takes the body's (#81)", () => {
  /** The fallback, and it is not a new path: every save the app has ever made
   *  from one capture goes through it. If it broke, the symptom would be the
   *  whole app rather than #81's basket — which is exactly why it is worth a
   *  test that names it. */
  it("takes the body's source when the item names none", async () => {
    const res = await save(meal({ source: "photo", items: [item()] }));
    expect((await res.json<FoodLogsCreated>()).logs[0]?.source).toBe("photo");
  });

  it("takes the body's photo_key when the item names none", async () => {
    const res = await save(meal({ source: "photo", photo_key: PHOTO_KEY, items: [item()] }));
    expect((await res.json<FoodLogsCreated>()).logs[0]?.photo_key).toBe(PHOTO_KEY);
  });

  it("takes the body's barcode when the item names none", async () => {
    const res = await save(meal({ source: "barcode", barcode: "5000112637922", items: [item()] }));
    expect((await res.json<FoodLogsCreated>()).logs[0]?.barcode).toBe("5000112637922");
  });

  it("stamps the body's photo_key on every row of a multi-item single capture", async () => {
    // One photograph returning three foods: still one capture, still one photo,
    // and the rows still all carry it. This is the behaviour #81 must not have
    // changed while making the column per-item on the wire.
    const res = await save(
      meal({
        source: "photo",
        photo_key: PHOTO_KEY,
        items: [item({ name: "A" }), item({ name: "B" }), item({ name: "C" })],
      }),
    );
    const { logs } = await res.json<FoodLogsCreated>();
    expect(logs.map((l) => l.photo_key)).toEqual([PHOTO_KEY, PHOTO_KEY, PHOTO_KEY]);
  });

  it("a photographed row and a typed one in one save, both stating all three", async () => {
    // **This test used to mix a stated item with a silent one and it no longer
    // may**: the all-or-nothing guard below refuses that shape outright,
    // because a silent item inside a stated basket is how a hand-typed food
    // ends up carrying somebody else's barcode. What it asserts now is the
    // thing that mattered about it — a basket really can hold two provenances
    // — said in the shape the contract allows.
    const res = await save(
      meal({
        source: "photo",
        photo_key: PHOTO_KEY,
        items: [
          { ...item({ name: "Photographed" }), source: "photo", photo_key: PHOTO_KEY, barcode: null },
          { ...item({ name: "Typed" }), source: "text", photo_key: null, barcode: null },
        ],
      }),
    );
    const { logs } = await res.json<FoodLogsCreated>();
    const byName = new Map(logs.map((l) => [l.name, l]));
    expect([byName.get("Photographed")?.source, byName.get("Typed")?.source]).toEqual(["photo", "text"]);
  });

  it("and the typed row carries no photo while the photographed one does", async () => {
    const res = await save(
      meal({
        source: "photo",
        photo_key: PHOTO_KEY,
        items: [
          { ...item({ name: "Photographed" }), source: "photo", photo_key: PHOTO_KEY, barcode: null },
          { ...item({ name: "Typed" }), source: "text", photo_key: null, barcode: null },
        ],
      }),
    );
    const { logs } = await res.json<FoodLogsCreated>();
    const byName = new Map(logs.map((l) => [l.name, l]));
    expect([byName.get("Photographed")?.photo_key, byName.get("Typed")?.photo_key]).toEqual([PHOTO_KEY, null]);
  });
});

describe("POST /api/food-logs — the cap on one meal (#81)", () => {
  /** `MAX_ITEMS`. The client refuses first and says why (`MAX_MEAL_ITEMS` in
   *  `lib/basket.ts`), so this is the refusal nobody should ever meet — and it
   *  is the only execution of the bound that exists, because nothing in
   *  production has ever put twenty distinct foods in one meal. */
  it("accepts exactly twenty foods in one save", async () => {
    const items = Array.from({ length: 20 }, (_, i) => item({ name: `Food ${i}` }));
    const res = await save(meal({ items }));
    expect(res.status).toBe(201);
  });

  it("refuses twenty-one", async () => {
    const items = Array.from({ length: 21 }, (_, i) => item({ name: `Food ${i}` }));
    const res = await save(meal({ items }));
    expect(res.status).toBe(400);
  });

  it("writes no rows at all when the cap is exceeded", async () => {
    const before = await rowCount();
    const items = Array.from({ length: 21 }, (_, i) => item({ name: `Food ${i}` }));
    await save(meal({ items }));
    expect(await rowCount()).toBe(before);
  });
});


describe("POST /api/food-logs — more foods than one INSERT can bind (#81)", () => {
  /** **The ceiling under the cap, found by driving the route.**
   *
   *  D1 binds at most 100 parameters per statement and a `food_logs` row is 22
   *  columns, so five foods in one INSERT is 110 placeholders and D1 answers
   *  `too many SQL variables` — a 500, on the one route where the thing being
   *  saved exists nowhere but the browser's memory. Measured across 1…21 items
   *  before the fix: **1–4 were 201, 5–20 were 500**, 21 was the route's own
   *  400. It has been there since #10 and had never fired, because a save was
   *  one read and a read is usually one or two foods; #81 makes five a matter
   *  of five taps, and a photographed plate could already reach it.
   *
   *  Five is the case that separates the fixed route from the broken one.
   *  Everything else here is a regression guard around it. */
  it("saves five foods in one meal", async () => {
    const items = Array.from({ length: 5 }, (_, i) => item({ name: `Five ${i}` }));
    const res = await save(meal({ items }));
    expect(res.status).toBe(201);
  });

  it("writes all five rows, not the first four", async () => {
    // The half a status assertion cannot see: a chunked insert that dropped a
    // chunk would still answer 201.
    const before = await rowCount();
    const items = Array.from({ length: 5 }, (_, i) => item({ name: `Rows ${i}` }));
    await save(meal({ items }));
    expect(await rowCount()).toBe(before + 5);
  });

  it("keeps all twenty rows of a full meal under one instant", async () => {
    // Twenty is five statements. If they were separate saves rather than
    // separate statements, the meal would fold into five timeline entries.
    const items = Array.from({ length: 20 }, (_, i) => item({ name: `Full ${i}` }));
    const res = await save(meal({ items }));
    const { logs } = await res.json<FoodLogsCreated>();
    expect(new Set(logs.map((l) => l.logged_at)).size).toBe(1);
  });

  it("returns every row it wrote", async () => {
    const items = Array.from({ length: 20 }, (_, i) => item({ name: `Back ${i}` }));
    const res = await save(meal({ items }));
    expect((await res.json<FoodLogsCreated>()).logs.length).toBe(20);
  });

  it("adds five items to a saved meal in one PATCH", async () => {
    // The same ceiling on the other route: #60's edit sheet can add rows until
    // `MAX_ITEMS`, and every added row is an INSERT of the same 22 columns.
    const { logs, ids } = await saveEntry({ items: [item({ name: "One" })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [
        asIs(logs[0] as FoodLog),
        ...Array.from({ length: 5 }, (_, i) => ({
          name: `Added ${i}`,
          kcal: 50,
          protein_g: 1,
          carbs_g: 2,
          fat_g: 3,
        })),
      ],
    });
    expect(res.status).toBe(200);
  });

  it("stores all five of those added rows", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "One" })] });
    await patch({
      ids,
      meal_slot: "dinner",
      items: [
        asIs(logs[0] as FoodLog),
        ...Array.from({ length: 5 }, (_, i) => ({
          name: `Stored ${i}`,
          kcal: 50,
          protein_g: 1,
          carbs_g: 2,
          fat_g: 3,
        })),
      ],
    });
    expect(await rowCount()).toBe(6);
  });
});

describe("POST /api/food-logs — provenance is stated by all the items or none (#81)", () => {
  /** The middle case, and the reason it is refused rather than tolerated.
   *
   *  The three fields fall back to the body when an item is silent — which is
   *  what every single-capture save in the app relies on. But a basket that
   *  states `source: "text"` on the mustard and forgets its `barcode: null`
   *  writes a hand-typed row carrying the patty's code: a row claiming to have
   *  been scanned, on the column #75's per-source analysis reads, unfixable
   *  afterwards because the capture is gone. Nothing about it looks wrong.
   *
   *  Same all-or-nothing this route already keeps for the four `ai_*` macros
   *  and for the portion triple, and for the identical reason. */
  const patty = BASKET.items[0] as Record<string, unknown>;
  const mustard = BASKET.items[2] as Record<string, unknown>;
  const without = (it: Record<string, unknown>, key: string) => {
    const copy = { ...it };
    delete copy[key];
    return copy;
  };

  it("refuses a basket where one item omits its barcode", async () => {
    const res = await save({ ...BASKET, items: [patty, without(mustard, "barcode")] });
    expect(res.status).toBe(400);
  });

  it("names that refusal invalid_item_provenance", async () => {
    const res = await save({ ...BASKET, items: [patty, without(mustard, "barcode")] });
    expect((await res.json<{ error: string }>()).error).toBe("invalid_item_provenance");
  });

  it("would have written the patty's barcode onto the mustard — and writes nothing", async () => {
    // The assertion the status cannot make. Before the guard this request
    // returned 201 and stored `source=text` beside `barcode=5000112637922`.
    const before = await rowCount();
    await save({ ...BASKET, items: [patty, without(mustard, "barcode")] });
    expect(await rowCount()).toBe(before);
  });

  it("refuses a basket where one item omits its photo_key", async () => {
    const res = await save({ ...BASKET, items: [patty, without(mustard, "photo_key")] });
    expect(res.status).toBe(400);
  });

  it("refuses a basket where one item omits its source", async () => {
    const res = await save({ ...BASKET, items: [patty, without(mustard, "source")] });
    expect(res.status).toBe(400);
  });

  it("refuses a basket where one item states nothing at all", async () => {
    // The shape a client bug takes: three captures appended correctly and the
    // fourth built by a path that forgot to stamp it.
    const res = await save({ ...BASKET, items: [patty, item({ name: "Silent" })] });
    expect(res.status).toBe(400);
  });

  it("accepts a basket where every item states all three", async () => {
    expect((await save(BASKET)).status).toBe(201);
  });

  it("still accepts a save where NO item states any of them", async () => {
    // The compatibility path, and the one this guard must not touch: a save
    // from one capture names none of the three and inherits all three.
    const res = await save(meal({ source: "photo", photo_key: PHOTO_KEY, items: [item(), item({ name: "Two" })] }));
    expect(res.status).toBe(201);
  });

  it("and that save still inherits every field from the body", async () => {
    const res = await save(
      meal({ source: "photo", photo_key: PHOTO_KEY, barcode: "5000112637922", items: [item(), item({ name: "Two" })] }),
    );
    const { logs } = await res.json<FoodLogsCreated>();
    expect(logs.map((l) => [l.source, l.photo_key, l.barcode])).toEqual([
      ["photo", PHOTO_KEY, "5000112637922"],
      ["photo", PHOTO_KEY, "5000112637922"],
    ]);
  });
});

/* ── #118: the payload a one-tap re-log actually sends ───────────────────────
 *
 * The unit test above pins what `relogItem` builds. This pins that the ROUTE
 * accepts it — because the two halves failing together is exactly what
 * happened: #81 tightened the contract here and nothing checked the one client
 * that was already sending a wider object.
 *
 * The second test is the falsifiable one. It sends what the BROKEN client sent
 * — a whole `Favorite` row spread into the item — and asserts the route still
 * refuses it, because the route was never what was wrong. */
describe("POST /api/food-logs — the one-tap re-log (#118)", () => {
  const relogBody = {
    logged_on: "2026-08-22",
    meal_slot: "snack" as const,
    source: "favorite" as const,
    favorite_id: "fav-1",
    items: [
      {
        name: "Barebells CHOCOLATE DOUGH",
        kcal: 200,
        protein_g: 20,
        carbs_g: 21,
        fat_g: 6,
        confidence: null,
        edited: false,
      },
    ],
  };

  it("accepts what relogItem builds", async () => {
    const res = await save(relogBody);
    expect(res.status).toBe(201);
  });

  it("stores it as a favorite-sourced row", async () => {
    const saved = await (await save(relogBody)).json<FoodLogsCreated>();
    expect(saved.logs[0]!.source).toBe("favorite");
  });

  it("stores no photo_key for it", async () => {
    const saved = await (await save(relogBody)).json<FoodLogsCreated>();
    expect(saved.logs[0]!.photo_key).toBeNull();
  });

  /* The broken shape, kept as a live example rather than described in a
     comment: a `Favorite` row spread whole into the item. `photo_key: null` is
     a STATEMENT under #81's contract, and stating one of the three without the
     other two is refused — correctly. This is the assertion that would have
     gone red the moment #81 landed, had it existed. */
  it("still refuses a whole Favorite row spread into the item", async () => {
    const res = await save({
      ...relogBody,
      items: [
        {
          id: "fav-1",
          user_id: "someone",
          ...relogBody.items[0]!,
          photo_key: null,
          use_count: 3,
          last_used_at: "2026-08-21T00:00:00.000Z",
          created_at: "2026-08-20T00:00:00.000Z",
        },
      ],
    });
    expect(res.status).toBe(400);
  });

  it("names that refusal invalid_item_provenance", async () => {
    const res = await save({
      ...relogBody,
      items: [{ ...relogBody.items[0]!, photo_key: null }],
    });
    expect((await res.json<{ error: string }>()).error).toBe("invalid_item_provenance");
  });
});


/** #113 — the refusal says which field caused it.
 *
 *  **The bug, verbatim from the issue.** Type `2000` into HOW MUCH for Nutella
 *  (539 kcal/100 g) and the row computes 10,780 kcal. `FOOD_LIMITS.grams.max`
 *  is 2,000 so the field takes the number happily; `energy()`'s ceiling is
 *  10,000 so the save is refused whole — and it was refused with a bare
 *  `invalid_item`, naming no field, on a sheet where the last thing the person
 *  touched was the portion.
 *
 *  **Neither bound is changed and neither should be.** They do not know each
 *  other exists and the portion multiplies into the thing the second one
 *  bounds, so the effective portion ceiling is a *product* — 2,000 g for a
 *  lettuce, about 1,850 g for Nutella, lower the denser the product. That band
 *  sits entirely inside the region both ceilings already agree is a typo, and
 *  narrowing either one to make the pair consistent would refuse honest input
 *  to tidy up a case nobody reaches. The defect is the reporting, and only the
 *  reporting.
 *
 *  These drive the real route through real workerd; `item-refusal.test.ts`
 *  proves the classification underneath. */
describe("a refusal caused by the portion says so (#113)", () => {
  /** 2,000 g of Nutella at 539 kcal/100 g, as the sheet would have rescaled it
   *  before sending: over the kcal ceiling, and over two macro ceilings too. */
  const NUTELLA = item({
    name: "Nutella",
    kcal: 10_780,
    protein_g: 120,
    carbs_g: 1148,
    fat_g: 618,
    confidence: null,
    ai_kcal: 10_780,
    ai_protein_g: 120,
    ai_carbs_g: 1148,
    ai_fat_g: 618,
    portion_qty: 2000,
    portion_unit: "g",
    ai_portion_qty: 2000,
  });

  const body = async (res: Response) => await res.json<{ error: string; fields?: string[]; over?: string }>();

  it("still refuses the save — the bound is unchanged", async () => {
    expect((await save(meal({ items: [NUTELLA] }))).status).toBe(400);
  });

  it("names the portion as the cause instead of answering invalid_item", async () => {
    const got = await body(await save(meal({ items: [NUTELLA] })));
    expect(got.error).toBe("item_over_limit");
    expect(got.fields).toEqual(["portion_qty"]);
  });

  it("names which ceiling fired", async () => {
    expect((await body(await save(meal({ items: [NUTELLA] })))).over).toBe("kcal");
  });

  it("writes nothing — a refused save is refused whole", async () => {
    await save(meal({ items: [NUTELLA] }));
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ?")
      .bind(USER)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  /** The comparison that made #113 provable rather than plausible: posting the
   *  same over-limit item WITHOUT the three portion columns returned the
   *  identical `invalid_item`, which is how the issue established the defect
   *  was pre-existing rather than introduced by #107. It still returns the
   *  generic error, and it should — there is no field to blame. */
  it("stays generic for the same numbers with no portion stated", async () => {
    const { portion_qty: _q, portion_unit: _u, ai_portion_qty: _a, ...bare } = NUTELLA;
    const got = await body(await save(meal({ items: [bare] })));
    expect(got.error).toBe("invalid_item");
    expect(got.fields).toBeUndefined();
  });

  it("is still generic when the item is nameless, portion or not", async () => {
    const got = await body(await save(meal({ items: [{ ...NUTELLA, name: "   " }] })));
    expect(got.error).toBe("invalid_item");
  });

  it("names a macro when the macro is what fired and the kcal are fine", async () => {
    // 2,000 g of a low-calorie, high-carb food: under 10,000 kcal, over the
    // 1,000 g macro ceiling. The generic error could not tell these apart.
    const got = await body(
      await save(
        meal({
          items: [
            item({
              name: "Boiled sweets",
              kcal: 7800,
              protein_g: 0,
              carbs_g: 1960,
              fat_g: 0,
              ai_kcal: 7800,
              ai_protein_g: 0,
              ai_carbs_g: 1960,
              ai_fat_g: 0,
              portion_qty: 2000,
              portion_unit: "g",
              ai_portion_qty: 2000,
            }),
          ],
        }),
      ),
    );
    expect(got.error).toBe("item_over_limit");
    expect(got.over).toBe("carbs_g");
  });

  it("accepts the largest portion that stays inside both ceilings", async () => {
    // ~1,850 g of Nutella. The effective ceiling this issue describes, still
    // reachable and still saved — the fix changed the reporting and nothing
    // about what is accepted.
    const res = await save(
      meal({
        items: [
          item({
            name: "Nutella",
            kcal: 9971,
            protein_g: 111,
            carbs_g: 995,
            fat_g: 572,
            ai_kcal: 9971,
            ai_protein_g: 111,
            ai_carbs_g: 995,
            ai_fat_g: 572,
            portion_qty: 1850,
            portion_unit: "g",
            ai_portion_qty: 1850,
          }),
        ],
      }),
    );
    expect(res.status).toBe(201);
  });

  /** PATCH rescales from HOW MUCH exactly as the confirm sheet does (#60), so
   *  the same multiplication reaches the same two ceilings. One classifier,
   *  two call sites (#86). */
  it("PATCH names the portion too", async () => {
    const { logs, ids } = await saveEntry({ items: [PIZZA] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), kcal: 99_000, portion_qty: 900 }],
    });
    expect(res.status).toBe(400);
    const got = await body(res);
    expect(got.error).toBe("item_over_limit");
    expect(got.fields).toEqual(["portion_qty"]);
  });

  it("PATCH stays generic when no portion was touched", async () => {
    const { logs, ids } = await saveEntry({ items: [item({ name: "One" })] });
    const res = await patch({
      ids,
      meal_slot: "dinner",
      items: [{ ...asIs(logs[0] as FoodLog), kcal: 99_000 }],
    });
    expect((await body(res)).error).toBe("invalid_item");
  });
});
