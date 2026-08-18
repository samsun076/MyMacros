import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { type NumericRule, commitOnBlur } from "../../client/lib/numeric";
import type { Units, WeightsResponse } from "../../shared/api";
import { lbToKg } from "../../shared/units";
import { MAX_WEIGHT_KG, MIN_WEIGHT_KG, weightBounds } from "../../shared/weight";
import { createDb } from "../db";
import type { AppEnv } from "../types";
import weights from "./weights";

/** The seam between a weight field and the route that stores what it produces
 *  (#99), walked rather than asserted.
 *
 *  **This file imports client code on purpose.** The claim is not "the
 *  constants match" — that is one `expect` and it proves nothing, because the
 *  defect #99 is about lives entirely in the gap between the two ends: the
 *  field holds pounds, the column holds kilograms, and a ceiling stated on
 *  either side alone is a different ceiling. So the test holds both ends. It
 *  runs the real `commitOnBlur` under the real bounds, converts the way the
 *  screens convert, and posts the result to the real route against real D1. A
 *  test that could not reach across that gap could not have caught 882 lb.
 *
 *  Three things get asserted per unit, and the third is what makes the other
 *  two mean anything:
 *
 *  1. The displayed bound commits *unchanged* — the field does not clamp its
 *     own ceiling, which would put the printed number out of reach.
 *  2. One step past it clamps, says so, and the clamped figure is accepted.
 *  3. **The unclamped step is refused by the route.** Without this the clamp
 *     could be removed and everything above would still pass, because the
 *     server would have taken the number anyway. In imperial this is exactly
 *     the trap the issue names: 882 lb is 400.07 kg, and the route says no.
 *
 *  Mounted behind a stub that sets what `requireAuth` sets; the mount-level
 *  session claim belongs to index.route.test.ts, which covers this route by
 *  name.
 */
const db = createDb(env as unknown as Env);
const USER = "weights-test-user";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("user", { id: USER, name: "Test", email: `${USER}@example.com` } as never);
  await next();
});
app.route("/api/weights", weights);

const DAY = "2026-08-18";

const post = (weight_kg: number) =>
  app.fetch(
    new Request("https://fuel.debrief.run/api/weights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ measured_on: DAY, weight_kg }),
    }),
    env,
  );

const stored = async () => {
  const res = await app.fetch(new Request("https://fuel.debrief.run/api/weights"), env);
  return (await res.json<WeightsResponse>()).latest;
};

/** What the goal weight field does with typed text, verbatim: `NumericField`
 *  is wiring over `commitOnBlur` (#100), and the rule it wires is these four
 *  props. `min`/`max` come from the one source and may not be restated here;
 *  `decimals` and `allowEmpty` are the field's own ergonomics and are copied,
 *  because the alternative is exporting a rule object nothing else would use. */
function fieldCommit(text: string, units: Units) {
  const { min, max } = weightBounds(units);
  const rule: NumericRule = { min, max, decimals: 1, allowEmpty: true };
  return commitOnBlur(text, rule, { value: null, atFocus: null });
}

/** The conversion both screens do on the way out: `Weight.tsx` on save,
 *  `GoalWeightField` on commit. */
const toKg = (displayed: number, units: Units) => (units === "imperial" ? lbToKg(displayed) : displayed);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  const now = "2026-08-18T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, now, now)
    .run();
  await db.insertInto("profiles").values({ user_id: USER }).execute();
});

describe.each<[Units, { min: number; max: number }]>([
  ["metric", { min: 20, max: 400 }],
  ["imperial", { min: 45, max: 881 }],
])("the goal weight bound in %s", (units, expected) => {
  // The printed pair, restated once per unit so a silent change to
  // `weightBounds` cannot quietly rewrite every case below to agree with it.
  it("is the pair the field prints", () => {
    expect(weightBounds(units)).toEqual(expected);
  });

  it("commits its own ceiling unchanged, and the route takes it", async () => {
    const action = fieldCommit(String(expected.max), units);
    expect(action).toEqual({ do: "commit", value: expected.max, note: null });
    if (action.do !== "commit") return;

    const kg = toKg(action.value, units);
    expect(kg).toBeLessThanOrEqual(MAX_WEIGHT_KG);
    expect((await post(kg)).status).toBe(201);
    expect((await stored())?.weight_kg).toBe(Math.round(kg * 10) / 10);
  });

  it("commits its own floor unchanged, and the route takes it", async () => {
    const action = fieldCommit(String(expected.min), units);
    expect(action).toEqual({ do: "commit", value: expected.min, note: null });
    if (action.do !== "commit") return;

    const kg = toKg(action.value, units);
    expect(kg).toBeGreaterThanOrEqual(MIN_WEIGHT_KG);
    expect((await post(kg)).status).toBe(201);
    expect((await stored())?.weight_kg).toBe(Math.round(kg * 10) / 10);
  });

  it("clamps a step over the ceiling rather than passing it on", async () => {
    const over = expected.max + 1;

    // what the route would have done with the number as typed
    const raw = await post(toKg(over, units));
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({ error: "invalid_weight" });
    expect(await stored()).toBeNull();

    const action = fieldCommit(String(over), units);
    expect(action).toEqual({ do: "commit", value: expected.max, note: `MAX ${expected.max}` });
    if (action.do !== "commit") return;
    expect((await post(toKg(action.value, units))).status).toBe(201);
  });

  it("clamps a step under the floor rather than passing it on", async () => {
    const under = expected.min - 1;

    const raw = await post(toKg(under, units));
    expect(raw.status).toBe(400);
    expect(await raw.json()).toEqual({ error: "invalid_weight" });
    expect(await stored()).toBeNull();

    const action = fieldCommit(String(under), units);
    expect(action).toEqual({ do: "commit", value: expected.min, note: `MIN ${expected.min}` });
    if (action.do !== "commit") return;
    expect((await post(toKg(action.value, units))).status).toBe(201);
  });

  /** Clearing is not a bound (#22): empty means "draw no goal line", and #99
   *  put a ceiling on this field without being allowed to touch that. */
  it("leaves an empty commit alone", () => {
    expect(fieldCommit("", units)).toEqual({ do: "clear", note: null });
  });
});

/** The far end of the report: 99,999 lb, which is what a person actually
 *  managed to save. Kept separate from the boundary walk because it is not a
 *  boundary — it is the number that proved there wasn't one. */
describe("the reported figure", () => {
  it("cannot reach the route from the field, and would be refused if it did", async () => {
    const action = fieldCommit("99999", "imperial");
    expect(action).toEqual({ do: "commit", value: 881, note: "MAX 881" });

    expect((await post(lbToKg(99999))).status).toBe(400);
    expect(await stored()).toBeNull();
  });
});
