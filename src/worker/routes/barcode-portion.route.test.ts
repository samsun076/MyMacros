import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { FOOD_LIMITS } from "../../client/lib/numeric";
import { savedGrams } from "../../client/lib/portion";
import type { FoodLog, FoodLogItemInput, FoodLogsCreated } from "../../shared/api";
import { createDb } from "../db";
import type { AppEnv } from "../types";
import { maxPortionQty as saveMax } from "../portion-limits";
import foodLogs from "./food-logs";

/** The barcode read's grams, from the sheet's memory into the column (#107).
 *
 *  **What this file is for.** #104 gave `food_logs` three portion columns and
 *  filled them from #58's per-item control. The barcode path — the control that
 *  had a portion field first, since #15 — went on discarding its number: you
 *  scan a yoghurt, type 150 into HOW MUCH, watch every macro rescale, save, and
 *  the 150 exists nowhere afterwards. It cannot be backfilled, because per-100 g
 *  figures scaled by a number nobody stored are indistinguishable from figures
 *  that were always those figures.
 *
 *  **The payload is composed by `savedGrams`, not by hand, and that is the
 *  point.** The route has accepted these three fields since #104 — nothing in
 *  it changed for this issue — so a route test that spelled `ai_portion_qty:
 *  100` into a literal would prove the route stores what it is given, which was
 *  never in doubt. What was in doubt is which number the *client* puts there.
 *  Driving the real decision function through the real route and reading D1 is
 *  what makes "the as-read grams came from the value a rescale already moved"
 *  a red test rather than a code review.
 *
 *  **Importing a client module in a Worker test is the established case**, for
 *  the reason `portion-limits.route.test.ts` sets out at length: the rule the
 *  source comments state is about the production bundle, and a test import
 *  drags nothing into it.
 *
 *  **What it cannot catch, said plainly.** It reaches `savedGrams`, not
 *  `Log.tsx`'s `save()`. Nothing in this repo can see the client's save payload
 *  — that is #104's own recorded ceiling, where two of nine mutations left the
 *  whole suite green — so "the sheet calls this function at all, with the read
 *  it is holding" is proved only by driving a browser. That drive is recorded
 *  on the issue.
 */
const db = createDb(env as unknown as Env);
const USER = "barcode-portion-test-user";

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

/** Greek yoghurt as OpenFoodFacts returns it: per-100 g figures, no
 *  confidence (nothing was estimated), and the sheet scaling them by the grams
 *  field. The macros are the ones `/log#portion` carries, scaled to 150 g. */
function item(over: Partial<FoodLogItemInput> = {}): FoodLogItemInput {
  return {
    name: "Greek yoghurt, 2%",
    kcal: 146,
    protein_g: 13.5,
    carbs_g: 5.9,
    fat_g: 3.9,
    confidence: null,
    edited: false,
    ai_kcal: 146,
    ai_protein_g: 13.5,
    ai_carbs_g: 5.9,
    ai_fat_g: 3.9,
    ...over,
  };
}

/** One barcode save, with the portion composed the way the sheet composes it.
 *
 *  `grams` is what the field holds; `baseGrams` is what the read arrived at.
 *  They differ whenever anybody touched the field, and an assertion made while
 *  they agree cannot tell a correct implementation from a broken one. */
const saveBarcode = (grams: number, baseGrams: number) =>
  save({
    logged_on: "2026-08-21",
    meal_slot: "snack",
    source: "barcode",
    barcode: "5000112637922",
    items: [item({ ...savedGrams({ grams, baseGrams }) })],
  });

async function storedPortion(id: string) {
  return await env.DB.prepare(
    "SELECT portion_qty, portion_unit, ai_portion_qty FROM food_logs WHERE id = ?",
  )
    .bind(id)
    .first<{ portion_qty: number | null; portion_unit: string | null; ai_portion_qty: number | null }>();
}

/** Save, then read the row back out of D1 rather than off the 201 body — the
 *  column is what has to hold the number, and a response echo would only prove
 *  the object the route built in memory. */
async function savedRow(grams: number, baseGrams: number) {
  const res = await saveBarcode(grams, baseGrams);
  expect(res.status).toBe(201);
  const body = await res.json<FoodLogsCreated>();
  return await storedPortion(body.logs[0]!.id);
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  const now = "2026-08-21T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, now, now)
    .run();
});

/** 137 g of a product the reader opened at 100 g. **Not a whole multiple** —
 *  #58's own round-trip tests went green against a compounding bug because
 *  every step in them was ×2, and a base of 100 with a scale of 1.5 would let
 *  "the reader said 150" and "the reader said 100" both look plausible beside
 *  a 1.5× row. 137/100 separates every candidate. */
const TYPED = 137;
const AS_READ = 100;

describe("a scaled barcode save (#107)", () => {
  it("stores the grams the user settled on", async () => {
    expect((await savedRow(TYPED, AS_READ))?.portion_qty).toBe(137);
  });

  /** The assertion this issue exists for. `read.grams` is 137 by the time save
   *  runs — it is the field's value, and the rescale moved it. Taking the
   *  reader's amount from there stores a row that says the product was read at
   *  137 g, which is false and which nothing downstream can ever detect. */
  it("stores the AS-READ grams beside it, not the number in the field", async () => {
    expect((await savedRow(TYPED, AS_READ))?.ai_portion_qty).toBe(100);
  });

  /** The pair, asserted as a pair: either value alone can be right while the
   *  row still fails to answer "was this rescaled?", which is the question. */
  it("keeps the two amounts DIFFERENT, which is what makes the row readable", async () => {
    const row = await savedRow(TYPED, AS_READ);
    expect(row?.ai_portion_qty).not.toBe(row?.portion_qty);
  });

  it("stores the unit as a label the save route recognises as measured", async () => {
    expect((await savedRow(TYPED, AS_READ))?.portion_unit).toBe("g");
  });
});

/** 0006's rule at the read level. Withholding here would put every untouched
 *  barcode save back where this issue found it — NULL, indistinguishable from
 *  the 77 rows that predate the migration. */
describe("an untouched barcode save (#107)", () => {
  it("writes the two amounts EQUAL rather than null", async () => {
    const row = await savedRow(AS_READ, AS_READ);
    expect(row?.ai_portion_qty).toBe(row?.portion_qty);
  });

  it("writes a real number, not NULL, merely because nobody adjusted it", async () => {
    expect((await savedRow(AS_READ, AS_READ))?.portion_qty).toBe(100);
  });
});

/** The interlock #109 created and #107 depends on: the bound on the HOW MUCH
 *  field and the bound the save route puts on a gram weight are the same
 *  number, so a value the field lets you type cannot be refused on the way to
 *  the column. Before #109 they were 2,000 and 100 — every gram value over a
 *  hundred, which is most of them, would have been refused outright.
 *
 *  Stated here rather than in `portion-limits.route.test.ts` because that file
 *  pins the *per-item* rule (`portionQtyRule`) against the route; this is the
 *  barcode field's own row of `FOOD_LIMITS`, which #109 made the source both
 *  ceilings derive from. */
describe("the grams field and the save route agree on the ceiling (#107/#109)", () => {
  it("the route's ceiling for g IS the grams field's ceiling", () => {
    expect(saveMax("g")).toBe(FOOD_LIMITS.grams.max);
  });

  it("stores a save at the very top of the field — 2,000 g", async () => {
    expect((await savedRow(FOOD_LIMITS.grams.max, FOOD_LIMITS.grams.max))?.portion_qty).toBe(2000);
  });

  it("stores a save at the very bottom of the field — 1 g", async () => {
    expect((await savedRow(FOOD_LIMITS.grams.min, FOOD_LIMITS.grams.min))?.portion_qty).toBe(1);
  });

  /** A ceiling that only *nearly* reaches is worse than a lower one: the field
   *  would commit 2,000 and the save would 400 with the sheet full of numbers.
   *  This is the assertion that fails if either side moves alone. */
  it("does not refuse the top of the field, which would 400 a full sheet", async () => {
    expect((await saveBarcode(FOOD_LIMITS.grams.max, FOOD_LIMITS.grams.max)).status).toBe(201);
  });
});

/** #52's undo re-posts the row it is holding, which makes it a writer of these
 *  columns as well as a reader — #104 found that an undo dropping them would
 *  strip the portion permanently, one entry at a time, with nothing on screen
 *  to say so. `Today.tsx` sends them straight off the row, so what has to hold
 *  is that a value the save accepted is still acceptable coming back: an
 *  exclusive bound anywhere would make a 2,000 g meal deletable and never
 *  restorable. */
describe("a barcode row survives the undo round trip (#52)", () => {
  /** Exactly the three fields `Today.tsx` copies off the stored row. */
  const repost = (row: FoodLog) =>
    save({
      logged_on: row.logged_on,
      logged_at: row.logged_at,
      meal_slot: row.meal_slot,
      source: row.source,
      barcode: row.barcode,
      items: [
        item({
          portion_qty: row.portion_qty,
          portion_unit: row.portion_unit,
          ai_portion_qty: row.ai_portion_qty,
        }),
      ],
    });

  async function restored(grams: number, baseGrams: number) {
    const first = await (await saveBarcode(grams, baseGrams)).json<FoodLogsCreated>();
    const res = await repost(first.logs[0]!);
    expect(res.status).toBe(201);
    const back = await res.json<FoodLogsCreated>();
    return await storedPortion(back.logs[0]!.id);
  }

  it("puts the user's amount back", async () => {
    expect((await restored(TYPED, AS_READ))?.portion_qty).toBe(137);
  });

  it("puts the reader's amount back, still distinct from it", async () => {
    expect((await restored(TYPED, AS_READ))?.ai_portion_qty).toBe(100);
  });

  it("can restore a meal saved at the very top of the field", async () => {
    expect((await restored(FOOD_LIMITS.grams.max, FOOD_LIMITS.grams.max))?.portion_qty).toBe(2000);
  });
});
