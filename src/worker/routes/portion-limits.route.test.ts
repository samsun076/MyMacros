import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { MEASURED_PORTION_UNITS as CLIENT_UNITS, portionQtyRule } from "../../client/lib/numeric";
import type { FoodLogItemInput, FoodLogsCreated } from "../../shared/api";
import { createDb } from "../db";
import type { AppEnv } from "../types";
import { MEASURED_PORTION_UNITS as ANALYZE_UNITS, maxPortionQty as analyzeMax, normalize } from "./analyze";
import foodLogs, { MEASURED_PORTION_UNITS as SAVE_UNITS, maxPortionQty as saveMax } from "./food-logs";

/** The portion ceiling, stated three times, pinned against itself (#109).
 *
 *  **What this file is for.** The ceiling on `portion_qty` lives in three
 *  places — `FOOD_LIMITS` in `src/client/lib/numeric.ts`, `normalize()` in
 *  `routes/analyze.ts`, `portionQty()` in `routes/food-logs.ts` — each
 *  deliberately restating the one above it, because the Worker must not import
 *  a client module. #86's register calls that the acceptable case. #109 is the
 *  bill: the number was wrong, and it was wrong in all three at once, so
 *  nothing looked broken. *Consistently wrong is indistinguishable from
 *  correct until somebody reads a row.* This file is what makes them
 *  distinguishable — the first defence against #109 recurring is not the new
 *  number, it is a test that fails when the three copies stop agreeing.
 *
 *  **It imports the client module, and that is not the barrier being broken.**
 *  The rule the three source comments state is about the production bundle:
 *  the Worker ships without React, without the client's `lib/`, and a route
 *  that imported `FOOD_LIMITS` would drag a client module into it. A *test*
 *  import does none of that. The alternative considered and rejected was
 *  reading `numeric.ts` as text and regexing the numbers out of it — legal,
 *  but it compares this file's transcription of the rule against the source,
 *  which is a test that can agree with itself, and it goes vacuously green the
 *  day the regex stops matching. Running both implementations over the same
 *  units cannot do either.
 *
 *  **What it cannot catch, said plainly.** It compares the three lists to each
 *  other. A unit missing from *all three* — which is exactly what #109 was, `g`
 *  absent from an enumeration that named slices, tacos, cups and wings — is
 *  invisible here and always will be. No test finds an enumeration that is
 *  short everywhere. That one is caught by using the app, and by the question
 *  the three source comments now put to anyone adding a unit.
 */

const db = createDb(env as unknown as Env);
const USER = "portion-limits-test-user";

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

function item(over: Partial<FoodLogItemInput> = {}): FoodLogItemInput {
  return {
    name: "Grilled chicken breast",
    kcal: 330,
    protein_g: 62,
    carbs_g: 0,
    fat_g: 7,
    confidence: 0.9,
    edited: false,
    ai_kcal: 330,
    ai_protein_g: 62,
    ai_carbs_g: 0,
    ai_fat_g: 7,
    ...over,
  };
}

const meal = (over: Record<string, unknown> = {}) => ({
  logged_on: "2026-08-21",
  meal_slot: "dinner",
  source: "text",
  items: [item()],
  ...over,
});

/** One save carrying a portion, which the route only accepts all-or-nothing. */
const savePortion = (qty: number, unit: string, aiQty = qty) =>
  save(meal({ items: [item({ portion_qty: qty, portion_unit: unit, ai_portion_qty: aiQty })] }));

const analyzed = (qty: number, unit: string) =>
  normalize({ name: "Grilled chicken breast", calories: 330, protein_g: 62, carbs_g: 0, fat_g: 7, confidence: 0.9, portion: { qty, unit } })?.portion;

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  const now = "2026-08-21T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, now, now)
    .run();
});

/** Every unit any of the three copies has an opinion about, plus counted
 *  controls that none of them list — the controls are what prove a unit
 *  *falling out* of one list is caught as loudly as one being added to it. */
const COUNTED_CONTROLS = ["slices", "slice", "cups", "cup", "tbsp", "tsp", "tacos", "eggs", "bowl", "wings", "breast"];

/** Spellings none of the three lists contains literally, so they pin the
 *  *normaliser* as well as the list — three copies of `unitKey` is three
 *  chances for one of them to stop folding plurals or periods, and the lists
 *  are all written singular and bare. */
const SPELLING_CONTROLS = ["grams", "Grams", "G", "oz.", "ML", "fl oz", "fl. oz.", "litres"];

const UNITS = [
  ...new Set<string>([...CLIENT_UNITS, ...ANALYZE_UNITS, ...SAVE_UNITS, ...COUNTED_CONTROLS, ...SPELLING_CONTROLS]),
];

/** Above the counted ceiling (100) and below the measured one (2,000), so a
 *  single probe separates the two buckets for any unit. */
const DISCRIMINATING_QTY = 200;

describe("the three statements of the portion ceiling agree (#109)", () => {
  it("has units to compare at all — a silent empty table would pass every test below", () => {
    expect(UNITS.length).toBeGreaterThan(20);
  });

  for (const unit of UNITS) {
    it(`analyze.ts and the client field carry the same ceiling for "${unit}"`, () => {
      expect(analyzeMax(unit)).toBe(portionQtyRule(unit).max);
    });
  }

  for (const unit of UNITS) {
    it(`food-logs.ts and the client field carry the same ceiling for "${unit}"`, () => {
      expect(saveMax(unit)).toBe(portionQtyRule(unit).max);
    });
  }

  it("and the client's floor is the one both routes enforce", () => {
    expect(portionQtyRule("g").min).toBe(0.1);
  });
});

/** The comparisons above are between three *exported constants*. These bind
 *  each one to the code path that actually runs, so a route that stopped
 *  calling its own `maxPortionQty` could not leave them green. */
describe("...and each is the ceiling its own code path enforces (#109)", () => {
  for (const unit of UNITS) {
    const allowed = portionQtyRule(unit).max >= DISCRIMINATING_QTY;
    it(`normalize() ${allowed ? "passes" : "drops"} ${DISCRIMINATING_QTY} ${unit}`, () => {
      expect(analyzed(DISCRIMINATING_QTY, unit)).toEqual(allowed ? { qty: DISCRIMINATING_QTY, unit } : null);
    });
  }

  for (const unit of UNITS) {
    const allowed = portionQtyRule(unit).max >= DISCRIMINATING_QTY;
    it(`the save route ${allowed ? "accepts" : "refuses"} ${DISCRIMINATING_QTY} ${unit}`, async () => {
      expect((await savePortion(DISCRIMINATING_QTY, unit)).status).toBe(allowed ? 201 : 400);
    });
  }
});

/** The two numbers themselves, at their edges, on one unit from each bucket.
 *  The per-unit probes above separate the buckets; these say what the bucket
 *  ceilings are. */
describe("the measured ceiling is 2,000 and the counted one is 100 (#109)", () => {
  it("normalize() takes 2000 g", () => {
    expect(analyzed(2000, "g")).toEqual({ qty: 2000, unit: "g" });
  });

  it("normalize() drops 2000.1 g", () => {
    expect(analyzed(2000.1, "g")).toBeNull();
  });

  it("normalize() takes 100 slices", () => {
    expect(analyzed(100, "slices")).toEqual({ qty: 100, unit: "slices" });
  });

  it("normalize() drops 100.1 slices", () => {
    expect(analyzed(100.1, "slices")).toBeNull();
  });

  it("the save route takes 2000 g", async () => {
    expect((await savePortion(2000, "g")).status).toBe(201);
  });

  it("the save route refuses 2000.1 g", async () => {
    expect((await savePortion(2000.1, "g")).status).toBe(400);
  });

  it("the save route takes 100 slices", async () => {
    expect((await savePortion(100, "slices")).status).toBe(201);
  });

  it("the save route refuses 100.1 slices", async () => {
    expect((await savePortion(100.1, "slices")).status).toBe(400);
  });
});

/** #109's headline, end to end through the two things that write the number. */
describe("200 g of chicken (#109)", () => {
  it("survives normalize() as 200", () => {
    expect(analyzed(200, "g")).toEqual({ qty: 200, unit: "g" });
  });

  it("is stored as 200, not 100", async () => {
    const saved = await (await savePortion(200, "g")).json<FoodLogsCreated>();
    const row = await env.DB.prepare("SELECT portion_qty FROM food_logs WHERE id = ?")
      .bind(saved.logs[0]!.id)
      .first<{ portion_qty: number }>();
    expect(row?.portion_qty).toBe(200);
  });

  /** The trap the restructure had to avoid: `ai_portion_qty` counts the same
   *  thing on the same row, so it is bounded by that row's unit. Bounding it by
   *  the counted default would refuse the reader's honest 200 g while accepting
   *  the user's. */
  it("accepts a reader's 200 g on a row the user cut to 180", async () => {
    expect((await savePortion(180, "g", 200)).status).toBe(201);
  });

  it("stores a reader's 200 g beside it", async () => {
    const saved = await (await savePortion(180, "g", 200)).json<FoodLogsCreated>();
    const row = await env.DB.prepare("SELECT ai_portion_qty FROM food_logs WHERE id = ?")
      .bind(saved.logs[0]!.id)
      .first<{ ai_portion_qty: number }>();
    expect(row?.ai_portion_qty).toBe(200);
  });

  it("still refuses a reader's 200 slices", async () => {
    expect((await savePortion(4, "slices", 200)).status).toBe(400);
  });
});

/** Option 3 of the issue: an out-of-range qty becomes null, never a different,
 *  confident number. The clamp lived in `normalize()` only — the save route
 *  already refused — so this is the one behaviour that changed shape. */
describe("an out-of-range qty is dropped, never clamped (#109)", () => {
  it("does not answer 100 for 5000 slices", () => {
    expect(analyzed(5000, "slices")).toBeNull();
  });

  it("does not answer 2000 for 9000 g", () => {
    expect(analyzed(9000, "g")).toBeNull();
  });

  /** Not the clamp returning: 1dp is the resolution the field and the column
   *  both hold, so 100.04 and 100.0 are the same portion. */
  it("still rounds to 1dp before testing, which is quantisation not a clamp", () => {
    expect(analyzed(100.04, "slices")).toEqual({ qty: 100, unit: "slices" });
  });
});
