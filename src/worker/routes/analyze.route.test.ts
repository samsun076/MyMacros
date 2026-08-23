import { env } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnalyzeResponse, AnalyzedItem, FoodLogsCreated } from "../../shared/api";
import { type Capture, reread } from "../../client/lib/basket";
import { editable, isEdited } from "../../client/lib/portion";
import { createDb } from "../db";
import { newPhotoKey } from "../photos";
import type { AppEnv } from "../types";
import analyze from "./analyze";
import foodLogs from "./food-logs";

/** #59 — telling the reader it got the food wrong, against real workerd, real
 *  R2 and real D1.
 *
 *  Three things live here that nowhere else can hold them:
 *
 *  1. **The authorization decision.** A `photo_key` now arrives on a route that
 *     reads bytes back out of R2, and `ownedPhotoKey` is the whole check —
 *     the key's `<userId>/` prefix IS the authorization (`src/worker/photos.ts`),
 *     not a convention layered on one. A unit test of `ownedPhotoKey` proves
 *     the function; only this proves the route calls it.
 *  2. **The bounds, as they reach the wire.** `photoTurn` is unit-tested in
 *     `analyze.test.ts`; what is asserted here is the *prompt the API actually
 *     receives*, which is the artifact the bound exists to protect.
 *  3. **`edited` after a re-read**, end to end through the save route — the one
 *     claim of this issue that spans the client's `reread`, the analyze route
 *     and `POST /api/food-logs` at once, and the one #60's own defect says to
 *     verify by driving rather than by reading.
 *
 *  **The model is stubbed at `globalThis.fetch`**, which is where the SDK's
 *  request leaves the isolate. Not a mock of the SDK: the schema, the abort
 *  signal, `normalize` and the whole handler run for real, and the only thing
 *  replaced is Anthropic answering. That also means these tests cost nothing
 *  and depend on no key — `.dev.vars` supplies one locally and CI does not
 *  (CLAUDE.md), so the env is overridden with a literal.
 *
 *  Mounted behind a stub that sets exactly what `requireAuth` sets, rather than
 *  forging a signed better-auth cookie. The mount-level claim (nothing under
 *  /api/analyze is reachable without a session) is `index.route.test.ts`'s. */

const db = createDb(env as unknown as Env);
const USER = "analyze-test-user";
const OTHER = "analyze-other-user";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  c.set("db", db);
  c.set("user", { id: USER, name: "Test", email: `${USER}@example.com` } as never);
  await next();
});
app.route("/api/analyze", analyze);
// The save route is mounted here on purpose: "a re-read does not set `edited`"
// is a claim about a *column*, and asserting it against the analyze response
// would only prove that the reader answered.
app.route("/api/food-logs", foodLogs);

/** Never the real key. A test that depended on `.dev.vars` would pass here and
 *  fail in CI, where the file does not exist. */
const testEnv = { ...env, ANTHROPIC_API_KEY: "sk-not-a-real-key" } as unknown as Env;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const HAM: AnalyzedItem = {
  name: "Ham and cheese toastie",
  calories: 430,
  protein_g: 22,
  carbs_g: 38,
  fat_g: 21,
  confidence: 0.55,
  portion: { qty: 1, unit: "toastie" },
};
const CHEESE: AnalyzedItem = {
  name: "Cheese toastie",
  calories: 340,
  protein_g: 15,
  carbs_g: 36,
  fat_g: 15,
  confidence: 0.6,
  portion: { qty: 1, unit: "toastie" },
};

/** What the API said, and what it was asked. `turns` collects the text block of
 *  every request that left the isolate, which is the artifact the note and
 *  previous-answer bounds are about. */
type Session = { turns: string[]; calls: number };

async function withModel<T>(
  items: AnalyzedItem[],
  fn: (session: Session) => Promise<T>,
): Promise<{ result: T; session: Session }> {
  const session: Session = { turns: [], calls: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo, init?: RequestInit) => {
    session.calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      messages: { content: string | { type: string; text?: string }[] }[];
    };
    // The photo route sends a content ARRAY (image block + text block); the
    // text route sends a bare string. Both are the turn, and reading only the
    // first shape threw a TypeError inside the stub — which surfaced as a 502
    // from a route that was working, so widening this is what lets #110's
    // text-path tests exist at all.
    const content = body.messages[0]?.content;
    const text = Array.isArray(content) ? content.find((b) => b.type === "text")?.text : content;
    if (text !== undefined) session.turns.push(text);
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: JSON.stringify({ items }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  try {
    return { result: await fn(session), session };
  } finally {
    globalThis.fetch = original;
  }
}

const post = async (form: FormData) =>
  await app.fetch(
    new Request("https://fuel.debrief.run/api/analyze/photo", { method: "POST", body: form }),
    testEnv,
  );

function upload(fields: Record<string, string> = {}) {
  const form = new FormData();
  form.append("photo", new File([JPEG], "meal.jpg", { type: "image/jpeg" }));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

/** A photo this user really does own, written the way the route writes one. */
async function storedPhoto(owner: string) {
  const key = newPhotoKey(owner);
  await env.PHOTOS.put(key, JPEG, { httpMetadata: { contentType: "image/jpeg" } });
  return key;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users WHERE id IN (?, ?)").bind(USER, OTHER).run();
  // R2 outlives a test the way D1 does. The bucket is emptied under both
  // prefixes so "how many objects does this user have?" is a question about
  // *this* test rather than about the order the file happened to run in.
  for (const id of [USER, OTHER]) {
    const listed = await env.PHOTOS.list({ prefix: `${id}/` });
    await Promise.all(listed.objects.map((o) => env.PHOTOS.delete(o.key)));
  }
  const now = "2026-08-21T00:00:00.000Z";
  for (const id of [USER, OTHER]) {
    await env.DB.prepare(
      "INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)",
    )
      .bind(id, "Test", `${id}@example.com`, now, now)
      .run();
  }
});

describe("POST /api/analyze/photo — whose photo is it (#59)", () => {
  it("refuses a photo_key that belongs to another user", async () => {
    const theirs = await storedPhoto(OTHER);
    const form = new FormData();
    form.append("photo_key", theirs);
    form.append("note", "no ham");
    const { result } = await withModel([CHEESE], () => post(form));
    // 404 rather than 403, exactly as GET /api/photos answers: a 403 would
    // confirm the object exists.
    expect(result.status).toBe(404);
  });

  it("does not read another user's bytes, or spend a model call on them", async () => {
    const theirs = await storedPhoto(OTHER);
    const form = new FormData();
    form.append("photo_key", theirs);
    const { session } = await withModel([CHEESE], () => post(form));
    expect(session.calls).toBe(0);
  });

  it("refuses a key that tries to climb out of its own prefix", async () => {
    const form = new FormData();
    form.append("photo_key", `${USER}/../${OTHER}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`);
    const { result } = await withModel([CHEESE], () => post(form));
    expect(result.status).toBe(404);
  });

  it("refuses an owned key that names no object", async () => {
    const form = new FormData();
    form.append("photo_key", newPhotoKey(USER));
    const { result } = await withModel([CHEESE], () => post(form));
    expect(result.status).toBe(404);
  });

  it("refuses a request carrying neither a file nor a key", async () => {
    const { result } = await withModel([CHEESE], () => post(new FormData()));
    expect(result.status).toBe(400);
  });

  it("names that refusal photo_required, so the client can tell it apart", async () => {
    const { result } = await withModel([CHEESE], () => post(new FormData()));
    expect(await result.json()).toEqual({ error: "photo_required" });
  });

  it("refuses a request carrying both — no client makes that request", async () => {
    const mine = await storedPhoto(USER);
    const { result } = await withModel([CHEESE], () => post(upload({ photo_key: mine })));
    expect(await result.json()).toEqual({ error: "photo_ambiguous" });
  });
});

describe("POST /api/analyze/photo — re-reading the stored photo (#59)", () => {
  it("reads a photo this user owns back out of R2", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "no ham");
    const { result } = await withModel([CHEESE], () => post(form));
    expect((await result.json<AnalyzeResponse>()).items[0]?.name).toBe("Cheese toastie");
  });

  it("hands back the SAME key, so a correction can be made twice", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "no ham");
    const { result } = await withModel([CHEESE], () => post(form));
    expect((await result.json<AnalyzeResponse>()).photo_key).toBe(mine);
  });

  /** The reason the key travels instead of the bytes. Re-uploading writes a
   *  second R2 object per attempt and orphans the first, on the one path a
   *  frustrated user hits twice — an unbounded leak with no cleanup anywhere
   *  (#60 already accepts one orphan per edited photo and says so). */
  it("writes no second object — the whole reason a key travels and bytes do not", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "no ham");
    await withModel([CHEESE], () => post(form));
    const listed = await env.PHOTOS.list({ prefix: `${USER}/` });
    expect(listed.objects.map((o) => o.key)).toEqual([mine]);
  });
});

describe("POST /api/analyze/photo — what reaches the prompt (#59)", () => {
  it("sends a first read's note, which no client had ever done", async () => {
    // `PHOTO_SYSTEM` has promised to trust a note over the picture since #13
    // and nothing sent one: a prompt contract built and unreachable.
    const { session } = await withModel([CHEESE], () => post(upload({ note: "wife's plate, no ham" })));
    expect(session.turns[0]).toBe(
      "Log what is in this photo. The person added a note: wife's plate, no ham",
    );
  });

  it("trims the note to 300 characters before it reaches the model", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "x".repeat(500));
    form.append("previous", "Ham and cheese toastie");
    const { session } = await withModel([CHEESE], () => post(form));
    expect(session.turns[0]).toContain(`wrong: ${"x".repeat(300)}\n`);
  });

  it("does not let the 301st character through", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "x".repeat(500));
    const { session } = await withModel([CHEESE], () => post(form));
    expect(session.turns[0]).not.toContain("x".repeat(301));
  });

  it("tells the model what it previously said, so 'no ham' has an antecedent", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "no ham");
    form.append("previous", "Ham and cheese toastie");
    form.append("previous", "Side salad");
    const { session } = await withModel([CHEESE], () => post(form));
    expect(session.turns[0]).toContain("answered: Ham and cheese toastie; Side salad.");
  });

  it("caps the previous answer, however many the client sends", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "no ham");
    for (let i = 0; i < 40; i++) form.append("previous", `Food ${i}`);
    const { session } = await withModel([CHEESE], () => post(form));
    expect(session.turns[0]).not.toContain("Food 20");
  });

  it("truncates one absurd previous name rather than growing the prompt by it", async () => {
    const mine = await storedPhoto(USER);
    const form = new FormData();
    form.append("photo_key", mine);
    form.append("note", "no ham");
    form.append("previous", "y".repeat(500));
    const { session } = await withModel([CHEESE], () => post(form));
    expect(session.turns[0]).not.toContain("y".repeat(121));
  });
});

/** The end-to-end claim, and the one #60 says to drive rather than read: its
 *  own defect was a route docstring asserting the correct behaviour beside code
 *  that did the opposite.
 *
 *  A re-read produces fresh AI numbers, so it resets `orig` — the AI is
 *  overriding *itself* at the user's request, where `edited` answers "did the
 *  user override the AI?". Carrying the old `orig` through would file every
 *  correction as a user edit and poison the one column #75's estimate-quality
 *  analysis reads, and it would do so invisibly: the row is perfectly
 *  well-formed and wrong about the only question it was written to answer.
 *
 *  The two facts are two tests over one setup, deliberately. An assertion after
 *  a failed one never runs and reports nothing, and "edited is 0" and "ai_kcal
 *  is the SECOND read's" are separately falsifiable — carrying `orig` breaks
 *  both, but reading `ai_*` off the wrong copy breaks only the second. */
async function correctedMeal() {
  const first = await withModel([HAM], () => post(upload()));
  const read = await first.result.json<AnalyzeResponse>();
  const key = read.photo_key as string;

  // what the confirm sheet holds after the first read
  const held: Capture[] = [
    { items: read.items.map(editable), readMs: 4300, source: "photo", photoKey: key },
  ];

  // "no ham" — the correction, carrying the previous answer with it
  const form = new FormData();
  form.append("photo_key", key);
  form.append("note", "no ham");
  for (const it of held[0]?.items ?? []) form.append("previous", it.name);
  const second = await withModel([CHEESE], () => post(form));
  const again = await second.result.json<AnalyzeResponse>();

  const after = reread(held, 0, again.items, 3900, "no ham");

  // and the save the sheet then sends, item-for-item
  const res = await app.fetch(
    new Request("https://fuel.debrief.run/api/food-logs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        logged_on: "2026-08-21",
        meal_slot: "lunch",
        source: "photo",
        photo_key: key,
        items: (after[0]?.items ?? []).map((it) => ({
          name: it.name,
          kcal: it.calories,
          protein_g: it.protein_g,
          carbs_g: it.carbs_g,
          fat_g: it.fat_g,
          confidence: it.confidence,
          edited: isEdited(it),
          ai_kcal: it.orig.calories,
          ai_protein_g: it.orig.protein_g,
          ai_carbs_g: it.orig.carbs_g,
          ai_fat_g: it.orig.fat_g,
        })),
      }),
    }),
    testEnv,
  );
  return (await res.json<FoodLogsCreated>()).logs;
}

describe("a re-read is not an edit (#59)", () => {
  it("stores edited = 0 — the AI corrected itself, the user overrode nothing", async () => {
    const [log] = await correctedMeal();
    expect(log?.edited).toBe(0);
  });

  it("stores the SECOND read's numbers as what the reader said", async () => {
    const [log] = await correctedMeal();
    expect(log?.ai_kcal).toBe(340);
  });

  it("stores the corrected food, not the one the person said was wrong", async () => {
    const [log] = await correctedMeal();
    expect(log?.name).toBe("Cheese toastie");
  });
});


/** #110 — an out-of-range figure drops the whole food, and the wire says so.
 *
 *  The unit tests in `analyze.test.ts` prove `normalize` and `usable`; this
 *  proves the *route* calls them and that the count survives serialisation.
 *  Driven through the same `globalThis.fetch` stub every other test here uses,
 *  so the schema, the abort signal and the whole handler run for real and the
 *  only thing replaced is Anthropic answering.
 *
 *  `RICE` is #110's own captured response, before the clamp got to it: 5,000 g
 *  of cooked white rice at 6,450 kcal and ~1,400 g of carbohydrate. What
 *  reached the sheet used to be `carbs_g: 1000` — pinned at the ceiling —
 *  sitting beside an unclamped 6,450, a row contradicting itself with nothing
 *  anywhere saying a number had been rewritten. */
describe("an unusable food is dropped and counted (#110)", () => {
  const RICE = {
    name: "White rice, cooked",
    calories: 6450,
    protein_g: 133,
    carbs_g: 1400,
    fat_g: 7,
    confidence: 0.9,
    portion: null,
  } as unknown as AnalyzedItem;

  const text = async (items: AnalyzedItem[]) => {
    const { result } = await withModel(items, async () =>
      app.fetch(
        new Request("https://fuel.debrief.run/api/analyze/text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "5000g of white rice" }),
        }),
        testEnv,
      ),
    );
    return await result.json<AnalyzeResponse>();
  };

  it("does not put the out-of-range food on the sheet", async () => {
    expect((await text([RICE])).items).toEqual([]);
  });

  it("says one food was dropped", async () => {
    expect((await text([RICE])).dropped).toBe(1);
  });

  it("never returns a clamped macro beside an unclamped calorie count again", async () => {
    // The assertion that separates this implementation from the one it
    // replaces: the old normalize answered `carbs_g: 1000, calories: 6450`.
    const { items } = await text([RICE]);
    expect(items.find((i) => i.carbs_g === 1000)).toBeUndefined();
  });

  it("keeps the rest of the read", async () => {
    const { items } = await text([HAM, RICE, CHEESE]);
    expect(items.map((i) => i.name)).toEqual(["Ham and cheese toastie", "Cheese toastie"]);
  });

  it("counts the one it lost out of three", async () => {
    expect((await text([HAM, RICE, CHEESE])).dropped).toBe(1);
  });

  it("reports dropped: 0 on a clean read rather than omitting the key", async () => {
    // #69's rule: present-and-zero says "nothing was refused", where an absent
    // key says nothing at all.
    const read = await text([HAM]);
    expect(read.dropped).toBe(0);
    expect("dropped" in read).toBe(true);
  });

  it("carries the count on the photo route too, beside the photo key", async () => {
    const { result } = await withModel([HAM, RICE], () => post(upload()));
    const read = await result.json<AnalyzeResponse>();
    expect(read.dropped).toBe(1);
    expect(read.photo_key).toMatch(new RegExp(`^${USER}/`));
  });

  it("still returns the photo key when every food was dropped", async () => {
    // #16's rule: the photo survives a read that produced nothing usable, so
    // the manual save path stays open.
    const { result } = await withModel([RICE], () => post(upload()));
    const read = await result.json<AnalyzeResponse>();
    expect(read.items).toEqual([]);
    expect(read.dropped).toBe(1);
    expect(read.photo_key).toMatch(new RegExp(`^${USER}/`));
  });
});
