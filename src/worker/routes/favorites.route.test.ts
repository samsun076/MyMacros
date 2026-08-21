import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { favoriteDraft, favoriteNamed } from "../../client/lib/picks";
import type { Favorite, FavoritesResponse } from "../../shared/api";
import { FAVORITE_NAME_MAX } from "../../shared/meals";
import { createDb } from "../db";
import type { AppEnv } from "../types";
import favorites from "./favorites";

/** The confirm sheet's star, end to end (#103).
 *
 *  **What this file is for.** The star has to answer "is the meal in front of
 *  me already starred?" before anything is written, and the only honest way to
 *  answer it is to compare against the name `POST /api/favorites` *would*
 *  store. That makes the client's `favoriteDraft`/`favoriteNamed` and this
 *  route two halves of one rule, and the failure mode if they drift is silent:
 *  the star simply stops filling — for long meals only — while re-tapping it
 *  re-posts, gets the same row back by idempotency, and changes nothing on
 *  screen. A dead button, arriving months later, for a subset of meals.
 *
 *  So the tests below run the *client's* functions against the *real* route on
 *  real D1, rather than restating the trim and the ceiling here where a
 *  transcription could agree with itself.
 *
 *  **It imports a client module, and that is not the barrier being broken** —
 *  same argument `portion-limits.route.test.ts` makes: the rule the source
 *  comments state is about the production bundle (the Worker ships without
 *  React and without the client's `lib/`), and a test import drags nothing
 *  into it.
 *
 *  **What it cannot catch.** Nothing here sees the sheet. Whether the star is
 *  drawn, whether it is drawn *filled*, and whether the body the component
 *  hands `api.post` is `favoriteDraft`'s output at all are outside every test
 *  in this repo — that is the standing ceiling, and it is why #103 was driven
 *  against the running dev server by hand. */

const db = createDb(env as unknown as Env);
const USER = "favorites-route-test-user";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("user", { id: USER, name: "Test", email: `${USER}@example.com` } as never);
  await next();
});
app.route("/api/favorites", favorites);

async function star(body: unknown): Promise<Response> {
  return await app.fetch(
    new Request("https://fuel.debrief.run/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
}

/** The row a POST landed on, whether it created it or found it. */
async function starred(body: unknown): Promise<Favorite> {
  return await star(body).then((r) => r.json<Favorite>());
}

/** Every favourite this user holds, as the sheet and the picks list read it. */
async function listed(): Promise<Favorite[]> {
  const res = await app.fetch(new Request("https://fuel.debrief.run/api/favorites"), env);
  const { favorites: rows } = await res.json<FavoritesResponse>();
  return rows;
}

async function unstar(id: string): Promise<Response> {
  return await app.fetch(
    new Request(`https://fuel.debrief.run/api/favorites/${id}`, { method: "DELETE" }),
    env,
  );
}

const item = (name: string, over: Partial<Record<"calories" | "protein_g" | "carbs_g" | "fat_g", number>> = {}) => ({
  name,
  calories: 100,
  protein_g: 10,
  carbs_g: 5,
  fat_g: 2,
  ...over,
});

/** A read whose fold runs past the ceiling — 12 items, ~22 characters each. */
const longRead = () => Array.from({ length: 12 }, (_, i) => item(`Ingredient number ${i + 1}`));

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(USER).run();
  const now = "2026-08-21T00:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
  )
    .bind(USER, "Test", `${USER}@example.com`, now, now)
    .run();
});

describe("starring a read from the confirm sheet (#103)", () => {
  it("stores the fold's name, not a second join", async () => {
    const draft = favoriteDraft([item("Grilled chicken breast"), item("Jasmine rice")]);
    const created = await starred(draft);
    expect(created.name).toBe("Grilled chicken breast, jasmine rice");
  });

  it("sums the read into one row's kcal", async () => {
    const draft = favoriteDraft([item("Chicken", { calories: 280 }), item("Rice", { calories: 210 })]);
    const created = await starred(draft);
    expect(created.kcal).toBe(490);
  });

  /** The client hands the fold's sums over unrounded on purpose; this route is
   *  where they are rounded, so a `.1`-precision figure has to survive. */
  it("rounds the unrounded macro sum the sheet sends", async () => {
    const draft = favoriteDraft([item("Yogurt", { protein_g: 17.4 }), item("Granola", { protein_g: 4.3 })]);
    const created = await starred(draft);
    expect(created.protein_g).toBe(21.7);
  });

  it("returns the existing row when the same read is starred twice", async () => {
    const draft = favoriteDraft([item("Barebells protein bar")]);
    const first = await starred(draft);
    const second = await starred(draft);
    expect(second.id).toBe(first.id);
  });

  it("writes no second row when the same read is starred twice", async () => {
    const draft = favoriteDraft([item("Barebells protein bar")]);
    await star(draft);
    await star(draft);
    const rows = await listed();
    expect(rows).toHaveLength(1);
  });

  /** The whole point of the sheet knowing: a second visit to the same product
   *  must render the star as already starred rather than as a fresh action. */
  it("is found by the sheet's own lookup on a second visit", async () => {
    const draft = favoriteDraft([item("Barebells protein bar")]);
    const created = await starred(draft);
    const rows = await listed();
    expect(favoriteNamed(rows, draft?.name ?? "")?.id).toBe(created.id);
  });

  /** **The pin.** A fold past the ceiling is stored short, and the sheet still
   *  holds the long one. If this route ever stops using `favoriteName` — an
   *  inlined `.slice(0, 100)`, a ceiling changed on one side — the star goes
   *  quietly dead for exactly these meals. Nothing else in the repo notices. */
  it("is found by the sheet's own lookup even when the fold was too long to store in full", async () => {
    const draft = favoriteDraft(longRead());
    const created = await starred(draft);
    const rows = await listed();
    expect(favoriteNamed(rows, draft?.name ?? "")?.id).toBe(created.id);
  });

  it("stores a too-long fold at exactly the shared ceiling", async () => {
    const created = await starred(favoriteDraft(longRead()));
    expect(created.name).toHaveLength(FAVORITE_NAME_MAX);
  });

  it("writes no second row when a too-long fold is starred twice", async () => {
    const draft = favoriteDraft(longRead());
    await star(draft);
    await star(draft);
    const rows = await listed();
    expect(rows).toHaveLength(1);
  });

  it("trims a name padded by hand on the sheet", async () => {
    const created = await starred({ name: "  Chicken bowl  ", kcal: 400, protein_g: 30, carbs_g: 40, fat_g: 10 });
    expect(created.name).toBe("Chicken bowl");
  });

  /** #16's blank recovery row. `favoriteDraft` refuses it before anything is
   *  sent and the star is `disabled` besides — this is the third guard, the one
   *  that holds if a future caller forgets the other two. */
  it("refuses a favourite with no name", async () => {
    expect((await star({ name: "", kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1 })).status).toBe(400);
  });

  it("refuses a favourite named only with whitespace", async () => {
    expect((await star({ name: "   ", kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1 })).status).toBe(400);
  });

  /** The junk the fold would produce if an unnamed row were folded in rather
   *  than dropped. It is a legal string, so nothing rejects it — which is why
   *  the guard has to be `favoriteDraft`'s, and why this asserts what the
   *  route would happily do with it. */
  it("would happily store the join of a blank row, which is why the client drops it first", async () => {
    const created = await starred({ name: "Chicken, ", kcal: 300, protein_g: 30, carbs_g: 0, fat_g: 5 });
    expect(created.name).toBe("Chicken,");
  });

  it("unstars the row the star created", async () => {
    const draft = favoriteDraft([item("Barebells protein bar")]);
    const created = await starred(draft);
    await unstar(created.id);
    const rows = await listed();
    expect(rows).toEqual([]);
  });
});

/** The server half of #115. `mergePicks` no longer caps anything, so what the
 *  picks list shows is now exactly what these two routes send — which makes
 *  "how long is each feed?" a question with a single answer per feed, and this
 *  is where the favourites one is pinned.
 *
 *  **Twelve, not nine.** Production held ten when the client cap was found, so
 *  a fixture at the boundary would pass against a route that had quietly grown
 *  a `.limit(10)`. */
describe("GET /api/favorites — a chosen row is never dropped (#115)", () => {
  it("returns every favourite, however many there are", async () => {
    for (let i = 1; i <= 12; i++) {
      await star({ name: `Favourite ${i}`, kcal: 300, protein_g: 30, carbs_g: 20, fat_g: 10 });
    }
    expect((await listed()).map((f) => f.name).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `Favourite ${i + 1}`).sort(),
    );
  });
});
