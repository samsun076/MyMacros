import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { FoodLogItemInput, FoodLogsCreated } from "../../shared/api";
import { createDb } from "../db";
import type { AppEnv } from "../types";
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

async function rowCount() {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM food_logs WHERE user_id = ?")
    .bind(USER)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
