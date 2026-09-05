import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import type { AnalyzeResponse, AnalyzedItem } from "../../shared/api";
import { newPhotoKey, ownedPhotoKey } from "../photos";
import { maxPortionQty } from "../portion-limits";
import type { AppEnv } from "../types";

const analyze = new Hono<AppEnv>();

/** What we ask Claude to return. Structured outputs guarantee the shape but
 *  silently DROP numeric bounds (minimum/maximum are stripped from the schema
 *  sent to the API — settled on #45), so confidence and the macro numbers are
 *  range-checked in normalize() below, never trusted from the wire.
 *
 *  Shared by the text and photo paths on purpose (#14): one schema means one
 *  `AnalyzeResponse`, so the confirm sheet, the save route and the toast never
 *  learn which input mode produced the items. */
const ITEM_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short human-readable name of the food" },
          calories: { type: "integer", description: "Estimated kcal for the described portion" },
          protein_g: { type: "number", description: "Grams of protein" },
          carbs_g: { type: "number", description: "Grams of carbohydrate" },
          fat_g: { type: "number", description: "Grams of fat" },
          confidence: {
            type: "number",
            description:
              "0..1 — how confident the estimate is given portion ambiguity. Lower it when the description omits portion size.",
          },
          /** #58. **Optional-or-absent is spelled `anyOf: [object, null]`, and
           *  the key stays in `required`.**
           *
           *  Measured against the live API on 2026-08-20, both ways, because
           *  the guess going in was wrong: dropping `portion` from `required`
           *  is *also* accepted (200, and the model still answered
           *  `"portion": null` on three vague samples out of three). So this is
           *  a choice, not a constraint the API imposed — say so rather than
           *  let a comment imply an error nobody saw.
           *
           *  It is in `required` because that makes "no portion" a **stated
           *  null instead of a missing key**, which is #69's distinction one
           *  layer down: an absent field and a field that says "there is no
           *  amount here" are the same bytes to a reader and different claims.
           *  The one the sheet acts on — draw no control — should be the one
           *  the model committed to.
           *
           *  The null branch itself is load-bearing and is not a choice: an
           *  object-only schema would make every read carry a portion, and an
           *  invented "1 serving" is exactly what #58 forbids. */
          portion: {
            anyOf: [
              {
                type: "object",
                properties: {
                  qty: { type: "number", description: "How many of the unit below" },
                  unit: {
                    type: "string",
                    description:
                      "What is being counted, as a plain label: slices, cups, bowl, g, oz, tacos. Never a conversion factor.",
                  },
                },
                required: ["qty", "unit"],
                additionalProperties: false,
              },
              { type: "null" },
            ],
            description:
              "How much of this food the numbers above describe. null when the description gives no natural amount to count — never invent one.",
          },
        },
        required: ["name", "calories", "protein_g", "carbs_g", "fat_g", "confidence", "portion"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the nutrition engine of a food-logging app. The user \
describes what they ate in casual free text ("chipotle chicken bowl, no rice, \
extra beans"). Estimate realistic calories and macros for the described \
portion, honoring modifiers like "no rice", "half", "large".

- Split the description into its distinct foods when that aids editing (a \
bowl's components stay one item; "burger and fries" is two).
- Use typical restaurant/brand portions when named, otherwise common home \
portions.
- The amount goes in \`portion\`, never in \`name\`. name is a plain food \
label ("Pepperoni pizza"), and portion carries the count and what is being \
counted ({"qty": 4, "unit": "slices"}). A name that repeats the quantity goes \
stale the moment someone adjusts the portion.
- If the text states an amount, lift it into \`portion\` as stated and keep it \
out of \`name\`: "4oz grilled cheddar cheese burger" is name "Grilled cheddar \
cheese burger", portion {"qty": 4, "unit": "oz"}. Don't round it to a standard \
serving — portion and the macros must describe the same amount, and it must be \
the amount the person actually said.
- If the text states no amount, estimate a typical one and name the unit you \
counted it in — slices, cups, bowl, g, oz, tacos. A bare food name still gets \
a portion; that estimate is the handle someone adjusts.
- \`portion.unit\` is a label, not a conversion. Use null only when there is \
nothing real to count: the person disclaimed the amount ("not sure how \
much"), or no honest unit exists. Never a unit that counts nothing — \
"serving", "portion", "helping" are the invention to avoid.
- confidence reflects portion certainty: ~0.9 for branded/exact items, \
~0.5-0.7 for typical guesses, lower when the text is vague.
- If the text describes no food at all, return an empty items array.`;

/** One prompt covers both jobs #14's body distinguishes — reading a nutrition
 *  label (near-exact) and estimating a plated portion (a guess). The model can
 *  see which it is looking at, and `confidence` already carries the
 *  distinction, so there is no mode flag on the request (settled on #14). */
const PHOTO_SYSTEM = `You are the nutrition engine of a food-logging app. The \
user photographs what they are about to eat — a plated meal, a packaged \
product, or a nutrition label — and you estimate calories and macros for what \
is in the picture.

- A nutrition label or packaged product is a near-exact read: use the panel's \
numbers, scale them to the servings actually shown, and set confidence 0.9 or \
higher.
- A plated meal is an estimate: identify the foods, judge the portion against \
the plate, utensils or hand for scale, and set confidence around 0.5-0.7 — \
lower when the portion is genuinely ambiguous or the photo is unclear.
- Split the photo into its distinct foods when that aids editing (a bowl's \
components stay one item; a burger and fries is two).
- The amount goes in \`portion\`, never in \`name\`. name is a plain food \
label ("Pepperoni pizza"), and portion carries what you counted in the \
picture ({"qty": 2, "unit": "slices"}). A name that repeats the quantity goes \
stale the moment someone adjusts the portion.
- If the picture or the note states an amount — a panel's serving count, a \
weight printed on the pack, "4oz patty" — lift it into \`portion\` as stated \
and keep it out of \`name\`. Don't round it to a standard serving — portion and \
the macros must describe the same amount.
- Otherwise count or estimate what is in frame and name the unit you counted \
it in — slices, cups, bowl, g, oz, tacos. A plated meal still gets a portion; \
that estimate is the handle someone adjusts.
- \`portion.unit\` is a label, not a conversion. Use null only when there is \
nothing real to count: the note disclaims the amount, or no honest unit \
exists. Never a unit that counts nothing — "serving", "portion", "helping" \
are the invention to avoid.
- A note from the person may accompany the photo. Trust it over the picture \
for anything it addresses — they know what they ate and what is out of frame.
- If the photo contains no food at all, return an empty items array.`;

/** POST /api/analyze/text (#9): free text → claude-sonnet-5 structured
 *  output → items for the confirm sheet. Sonnet 5 thinks by default;
 *  thinking is disabled and effort low because PLAN.md promises the happy
 *  path under ~10 seconds (settled on #45). */
analyze.post("/text", async (c) => {
  const t0 = performance.now();
  const body = await c.req.json<{ text?: unknown }>().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text_required" }, 400);
  if (text.length > 1000) return c.json({ error: "text_too_long" }, 400);

  const run = instrument(c.env, "analyze/text", t0);

  let raw: string;
  try {
    const response = await run.client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ITEM_SCHEMA },
      },
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
    }, { signal: AbortSignal.timeout(DEADLINE_MS) });
    run.apiDone();

    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
      console.error("analyze/text stopped early", response.stop_reason);
      run.done("stopped_early");
      return c.json({ error: "analyze_failed" }, 502);
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block) {
      run.done("no_text_block");
      return c.json({ error: "analyze_failed" }, 502);
    }
    raw = block.text;
  } catch (err) {
    // surfaced, never stubbed: a missing/invalid key or an API outage should
    // be visible to the person logging, not silently zero-calorie
    run.apiDone();
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("analyze/text api error", err);
    run.done(timedOut ? "deadline" : "api_error");
    return c.json({ error: timedOut ? "analyze_timeout" : "analyze_unavailable" }, 502);
  }

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(raw) as { items?: unknown };
  } catch {
    console.error("analyze/text unparseable output", raw.slice(0, 200));
    run.done("unparseable");
    return c.json({ error: "analyze_failed" }, 502);
  }

  const read = usable(parsed.items);
  run.done("ok", { items: read.items.length, dropped: read.dropped });
  return c.json<AnalyzeResponse>(read);
});

/** Largest upload accepted. The client downscales to 1568px on the long edge
 *  at q0.8, which measured 214 KB on device — 6 MB is a wide ceiling that
 *  still refuses a full-resolution original before it costs an R2 write. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** The most of a person's note that reaches the prompt.
 *
 *  300 has been the trim since #13 and is unchanged; it is a named constant
 *  now only because #59 gave it a second reader. Nothing re-derived it. */
const NOTE_MAX = 300;

/** #59's bounds on the *previous answer* — the half of a correction that is
 *  not the note.
 *
 *  A correction is a diff ("no ham") and a diff has no antecedent on its own,
 *  so the re-read carries what the reader previously said. That list arrives
 *  **from the client**, which makes it untrusted text going into a prompt on
 *  exactly the path a frustrated user hits twice — so it is bounded here the
 *  way `note` is, and for the same reason.
 *
 *  Both numbers are **carried rather than derived**, and saying so is the
 *  point (CLAUDE.md: a literal kept through a rewrite is a decision):
 *
 *  - 20 is `MAX_ITEMS` in `routes/food-logs.ts` and `MAX_MEAL_ITEMS` in
 *    `lib/basket.ts`, and it is a *different rule* landing on the same figure:
 *    those bound a meal, this bounds a prompt. It is defensible because the
 *    list can never honestly be longer than the meal it describes, and it has
 *    never bound anything — a photo read returns a handful of foods.
 *  - 120 is `normalize`'s own name truncation. Restated rather than shared, and
 *    deliberately: `normalize` bounds what the *model* said on the way in, this
 *    bounds what a *client* claims the model said. Same shape as `FOOD_LIMITS`
 *    against `normalize`'s ceilings — each side enforces independently, so
 *    neither may assume the other ran. */
const MAX_PREVIOUS_ITEMS = 20;
const PREVIOUS_NAME_MAX = 120;

/** The text turn that accompanies the photo — one function for both reads
 *  (#59), exported for its tests.
 *
 *  **The no-note, no-previous sentence is byte-identical to what shipped**, and
 *  so is the note-only one. That is not tidiness: the first read is the app's
 *  most-used path and this issue is about the *second* one, so the shipped
 *  prompt is a thing to leave alone. A test pins both strings.
 *
 *  **The previous answer goes in as NAMES ONLY.** The complaint the issue is
 *  built on is "it said ham and there was no ham" — an identity claim, and the
 *  names are its antecedent. Sending the old macros back would give the model
 *  numbers to anchor on when the whole point of a re-read is that it derives
 *  them again from the picture; a hamless toastie does not weigh what a ham one
 *  weighs, which is the sentence in the issue that rules the cheap fix out.
 *
 *  Here rather than inline in the handler for #100's reason: the bounds are the
 *  part worth testing, and a bound reachable only by driving a route that calls
 *  a paid API is a bound nobody will exercise. */
export function photoTurn({
  note,
  previous,
}: {
  note: string;
  previous: readonly string[];
}): string {
  const said = previous
    .map((n) => n.trim().slice(0, PREVIOUS_NAME_MAX))
    .filter(Boolean)
    .slice(0, MAX_PREVIOUS_ITEMS);
  const trimmed = note.trim().slice(0, NOTE_MAX);

  if (!said.length) {
    return trimmed
      ? `Log what is in this photo. The person added a note: ${trimmed}`
      : "Log what is in this photo.";
  }

  return [
    "Log what is in this photo.",
    `You have read this photo before and answered: ${said.join("; ")}.`,
    trimmed
      ? `The person says that answer was wrong: ${trimmed}`
      : "The person says that answer was wrong.",
    "Read the picture again and answer from scratch. Their correction is about your previous answer and overrides the picture wherever the two disagree — do not list a food they have told you is not there, and re-estimate the amounts for what is actually left.",
  ].join("\n");
}

/** POST /api/analyze/photo (#13/#14/#59): the photo arrives in the same request
 *  that persists it — settled on #13, because at 214 KB there is nothing for
 *  a presigned direct-to-R2 upload to save, and one request is one place for
 *  #16's failure UX rather than two.
 *
 *  Order matters: **R2 is written before Claude is called.** #16 requires
 *  "never lose the photo the user took", and doing it in this order makes
 *  that structural instead of something the error path has to remember.
 *
 *  **Since #59 the bytes may come from R2 instead of the wire.** A correction
 *  ("no ham") re-reads a photo this route already stored, and it is the *same*
 *  route rather than a second endpoint: same schema, same `normalize`, same
 *  `DEADLINE_MS` abort. Re-uploading was the alternative and it is worse in
 *  three ways the issue names — a second R2 object per attempt, orphaning the
 *  first, on the one path a frustrated user hits twice; and the client no
 *  longer holds the blob once the sheet is up, only an object URL.
 *
 *  **The arriving key goes through `ownedPhotoKey`, and that is the whole
 *  authorization decision.** R2 keys are `<userId>/<uuid>.jpg` and the prefix
 *  IS the check (`src/worker/photos.ts`) — the same check a key gets when it
 *  arrives on a save, not a new trust decision. A key that fails it answers
 *  **404, never 403**, exactly as `GET /api/photos/:owner/:name` does: a 403
 *  would confirm the object exists. */
analyze.post("/photo", async (c) => {
  const t0 = performance.now();

  const form = await c.req.formData().catch(() => null);
  const photo = form?.get("photo") ?? null;
  const claimed = form?.get("photo_key") ?? null;

  // A request stating both is a client that does not know which read it is
  // making. No client produces it, which is exactly why the contract should
  // not permit it — #81's provenance rule, one route over.
  if (photo !== null && claimed !== null) return c.json({ error: "photo_ambiguous" }, 400);

  let key: string;
  let bytes: Uint8Array;
  /** Which read this is, said once. Both branches below and the timing line
   *  read it, so "is this a correction?" cannot be answered two ways. */
  const reread = claimed !== null;

  if (reread) {
    const owned = ownedPhotoKey(claimed, c.var.user.id);
    // Malformed, someone else's, or simply gone — one answer for all three,
    // deliberately. Separating them would let this route enumerate another
    // user's photo keys by status code.
    if (!owned) return c.json({ error: "photo_not_found" }, 404);
    const object = await c.env.PHOTOS.get(owned);
    if (!object) return c.json({ error: "photo_not_found" }, 404);
    key = owned;
    // No size ceiling on this branch: MAX_PHOTO_BYTES refuses a
    // full-resolution original *before it costs an R2 write*, and this object
    // is one we wrote and already paid for.
    bytes = new Uint8Array(await object.arrayBuffer());
  } else {
    if (!(photo instanceof File) || photo.size === 0) return c.json({ error: "photo_required" }, 400);
    if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: "photo_too_large" }, 413);
    // Both capture paths — the live viewfinder and the <input capture> fallback
    // — encode through the same canvas helper, so JPEG is a contract the client
    // always meets and not a guess about what a device might hand us.
    if (photo.type !== "image/jpeg") return c.json({ error: "photo_not_jpeg" }, 415);

    bytes = new Uint8Array(await photo.arrayBuffer());

    key = newPhotoKey(c.var.user.id);
    try {
      await c.env.PHOTOS.put(key, bytes, {
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { userId: c.var.user.id },
      });
    } catch (err) {
      // Nothing to fall back to: the whole point of this ordering is that the
      // photo is safe before anything expensive runs, so a failed write is the
      // one case where there is genuinely no photo to keep.
      console.error("analyze/photo r2 write failed", err);
      console.log("analyze/photo timing", {
        outcome: "store_failed",
        bytes: photo.size,
        total_ms: Math.round(performance.now() - t0),
      });
      return c.json({ error: "photo_store_failed" }, 502);
    }
  }

  // Base64, not a URL source: R2 objects here are private and served through
  // an authenticated Worker route, so Anthropic's fetcher cannot reach them.
  // Not a preference — the URL source is unavailable to this deployment. The
  // Worker already holds the bytes, so there is nothing to re-fetch either.
  const run = instrument(c.env, "analyze/photo", t0);
  const noteRaw = form?.get("note");
  const note = typeof noteRaw === "string" ? noteRaw : "";
  // Repeated fields rather than a JSON string: a list of names is what this
  // is, `getAll` already returns one, and a JSON parse here would be a second
  // failure mode on a request whose whole job is to recover from a failure.
  const previous = (form?.getAll("previous") ?? []).filter((v) => typeof v === "string");
  const stat = { photo_bytes: bytes.length, reread };

  let raw: string;
  try {
    const response = await run.client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ITEM_SCHEMA },
      },
      system: PHOTO_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: toBase64(bytes) } },
            { type: "text", text: photoTurn({ note, previous }) },
          ],
        },
      ],
    }, { signal: AbortSignal.timeout(DEADLINE_MS) });
    run.apiDone();

    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
      console.error("analyze/photo stopped early", response.stop_reason);
      run.done("stopped_early", stat);
      return c.json<AnalyzeResponse>({ items: [], photo_key: key }, 200);
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block) {
      run.done("no_text_block", stat);
      return c.json<AnalyzeResponse>({ items: [], photo_key: key }, 200);
    }
    raw = block.text;
  } catch (err) {
    run.apiDone();
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("analyze/photo api error", err);
    run.done(timedOut ? "deadline" : "api_error", stat);
    // 502 with the key attached: the read failed, the photo did not. The
    // client keeps the key so the manual save path stays open (#16).
    return c.json({ error: timedOut ? "analyze_timeout" : "analyze_unavailable", photo_key: key }, 502);
  }

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(raw) as { items?: unknown };
  } catch {
    console.error("analyze/photo unparseable output", raw.slice(0, 200));
    run.done("unparseable", stat);
    return c.json({ error: "analyze_failed", photo_key: key }, 502);
  }

  const read = usable(parsed.items);
  run.done("ok", { ...stat, items: read.items.length, dropped: read.dropped });
  return c.json<AnalyzeResponse>({ ...read, photo_key: key });
});

/** Workers have btoa but no Buffer, and String.fromCharCode(...bytes) blows
 *  the argument limit on anything this size — so chunk it. A 214 KB frame is
 *  ~285 KB of base64. */
function toBase64(bytes: Uint8Array) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The wall-clock budget for a read (#16).
 *
 *  #49 is the reason this is a deadline and not an attempt cap. 33s was never
 *  reproduced across 11 production and 17 control samples, and there were zero
 *  retries — the slowest call of that whole exercise (11.3s) was a *single
 *  un-retried attempt*, which `maxRetries: 0` would not have prevented.
 *
 *  It is an AbortSignal rather than the SDK's `timeout` option deliberately: a
 *  timed-out request is retried, so a 20s `timeout` with maxRetries 2 is a 60s
 *  worst case. An abort is terminal, which is what makes this an actual
 *  ceiling. Sized off the measured 11.3s with headroom, not off the 33s
 *  outlier — past this point the user has given up, and #16's manual path is a
 *  better answer than a longer wait. */
const DEADLINE_MS = 20_000;

/** An Anthropic client with #49's timing instrumentation wired in, plus the
 *  two log lines that read it.
 *
 *  #49: production measured 33s for a call that takes ~4.6s locally. One
 *  wall-clock number can't separate a single slow upstream call from the
 *  SDK's retry loop (maxRetries: 2, exponential backoff on 429/529/5xx), so
 *  the client gets a wrapping fetch that stamps every attempt — the backoff
 *  sleeps are then the arithmetic between one attempt ending and the next
 *  starting. Observability only: retry behaviour is deliberately untouched,
 *  and the fail-fast decision is #16's. */
function instrument(env: Env, label: string, t0: number) {
  let attempts = 0;
  let apiMs = 0;
  const apiStart = performance.now();

  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    fetch: async (input, init) => {
      const attempt = ++attempts;
      const at = performance.now() - t0;
      try {
        const res = await fetch(input as RequestInfo, init as RequestInit);
        console.log(`${label} timing`, {
          attempt,
          at_ms: Math.round(at),
          elapsed_ms: Math.round(performance.now() - t0 - at),
          status: res.status,
          ...upstreamHeaders(res.headers),
        });
        return res;
      } catch (err) {
        console.log(`${label} timing`, {
          attempt,
          at_ms: Math.round(at),
          elapsed_ms: Math.round(performance.now() - t0 - at),
          status: null,
          transport_error: String(err),
        });
        throw err;
      }
    },
  });

  return {
    client,
    /** Stamp the API leg — called on both the success and the error path, so
     *  a failed call still reports how long it burned. */
    apiDone: () => {
      apiMs = performance.now() - apiStart;
    },
    done: (outcome: string, extra: Record<string, unknown> = {}) =>
      console.log(`${label} timing`, {
        outcome,
        attempts,
        api_ms: Math.round(apiMs),
        total_ms: Math.round(performance.now() - t0),
        ...extra,
      }),
  };
}

/** The rate-limit header set the API returns varies per response, so they're
 *  collected by prefix rather than named one by one. */
function upstreamHeaders(headers: Headers) {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key === "request-id" || key === "retry-after" || key.startsWith("anthropic-ratelimit-")) {
      out[key] = value;
    }
  });
  return out;
}

/** Everything the reader returned, split into what the sheet can show and a
 *  count of what it cannot (#110). Exported for its tests (#47).
 *
 *  **The count is the whole point.** Dropping an item is the honest answer to
 *  a figure no food reaches — but a person who photographed a plate and got
 *  back fewer foods than are on it has been told nothing, and a silent drop is
 *  the same defect as the silent clamp it replaces, one level up. So the
 *  number crosses the wire and the confirm sheet says it (`droppedNote` in
 *  `src/client/lib/basket.ts`).
 *
 *  **It counts every unusable item, not only the out-of-range ones**, because
 *  the sheet has one sentence to say about all of them: a food came back that
 *  we could not show you. A nameless item has been dropped silently since #9
 *  and is the same experience from the user's side; separating the causes
 *  would put a taxonomy on screen that answers a question nobody asked.
 *
 *  **`dropped: 0` is emitted rather than omitted**, for #69's reason exactly:
 *  present-and-zero says "the reader returned nothing we refused", where an
 *  absent key says nothing at all — and the only thing that can produce an
 *  absent key on this route is a worker older than this issue. */
export function usable(returned: unknown): { items: AnalyzedItem[]; dropped: number } {
  const all = Array.isArray(returned) ? returned : [];
  const items = all.map(normalize).filter((it): it is AnalyzedItem => it !== null);
  return { items, dropped: all.length - items.length };
}

/** The ceilings the four figures have to sit under, restating `FOOD_LIMITS`'
 *  `kcal.max` and `macro_g.max` in `src/client/lib/numeric.ts` and `energy()`
 *  and `grams()` in `routes/food-logs.ts` — the same deliberate carry the
 *  portion ceilings below are, for the same reason, and named here only
 *  because #110 gave them a second reader in this file. */
const MAX_KCAL = 10000;
const MAX_MACRO_G = 1000;

/** The schema guarantees presence and type; this guards the ranges the
 *  schema can't. Exported for its tests (#47) — it is the only thing standing
 *  between a model's out-of-range number and the database.
 *
 *  **An out-of-range figure drops the whole ITEM; nothing here is clamped
 *  (#110).** This used to be `Math.min(Math.max(v, 0), max)` on all four
 *  numbers, which is the silent truncation #109 had just removed from the
 *  portion qty one function down. It is visible in a real response: `5000g of
 *  white rice` came back `carbs_g: 1000` — pinned at the ceiling — beside an
 *  **unclamped** `calories: 6450`, so the row contradicted itself (1,000 g of
 *  carbohydrate is 4,000 kcal) and nothing anywhere said a number had been
 *  rewritten. Consistently wrong is indistinguishable from correct until
 *  someone reads a row; *inconsistently* wrong is worse.
 *
 *  **Why dropping, and why #109 could not do it here.** A portion is
 *  all-or-nothing and has a null representation, so #109 could refuse a qty by
 *  answering `null` — no control drawn, a hand-edit invited, nothing claimed.
 *  A macro has no such representation: `AnalyzedItem.protein_g` is a `number`
 *  and `0` is a real answer, so "absent" and "none" would read the same, which
 *  is its own bug. Refusing therefore means refusing the item, which is a
 *  larger decision than #109 was scoped to make — left alone on purpose there
 *  rather than overlooked, and **decided by Dave on 2026-08-23** over the
 *  alternative of clamping with the confidence zeroed.
 *
 *  It is defensible because it is narrow three ways: the other items in the
 *  same read are untouched and still land on the sheet; #16's blank recovery
 *  row already exists for typing a food in by hand; and the bound only fires
 *  on input no single food reaches — 1,000 g of one macro is not a food, and
 *  10,000 kcal is four days of eating for the person this app is built for.
 *
 *  **The floor drops too, and that is the same rule rather than an extra
 *  one.** `Math.max(v, 0)` rewrote `-200` to `0` exactly as silently as the
 *  ceiling rewrote `999999` to `10000`; the old test's own name ("rather than
 *  logging a meal that gives calories back") shows the fear was the negative
 *  reaching a day's total, and dropping the item keeps it out of the total
 *  *without* inventing a zero-calorie food to do it.
 *
 *  **A number that is not a number drops the item too.** The schema promises
 *  presence and type, so `NaN`, `Infinity`, `null` and `"41"` can only arrive
 *  when the wire has broken its own contract — and substituting `0` there is
 *  the "unknown and none read the same" bug the paragraph above refuses.
 *
 *  **Rounded first, then tested**, at both ends and for the same reason
 *  `portion()` does it: 1dp is the resolution the macro columns hold and whole
 *  kcal is what `calories` stores, so landing on a bound *through rounding*
 *  (`10000.4` → `10000`, `-0.04` → `0`) is quantisation, not the clamp #110
 *  killed.
 *
 *  **`confidence` is still clamped, deliberately, and it is now the only
 *  silent rewrite left in this function.** Say so rather than let the carry
 *  read as an oversight: it is a statement *about* the four numbers and not
 *  one of them, so clamping it cannot make a row contradict itself, which is
 *  the specific defect #110 is about; and a probability outside 0..1 is a
 *  broken scale rather than a broken food, where throwing the item away would
 *  cost four usable macros to report a malformed meta field. The honest
 *  alternative exists and is representable — `AnalyzedItem.confidence` is
 *  `number | null` already, because a barcode read has no confidence to give —
 *  so `null` is available if this is ever revisited. It was not part of #110's
 *  decision and is not changed here. */
export function normalize(item: unknown): AnalyzedItem | null {
  const it = item as Record<string, unknown>;
  if (typeof it?.name !== "string" || !it.name.trim()) return null;

  /** The value as it would be stored, or `null` for "this item is not usable".
   *  `+ 0` normalises `-0`, which `Math.round` produces from `-0.04` and which
   *  is a different value from `0` to anything comparing with `Object.is`. */
  const num = (v: unknown, max: number, decimals: number) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const f = 10 ** decimals;
    const n = Math.round(v * f) / f + 0;
    return n >= 0 && n <= max ? n : null;
  };

  const calories = num(it.calories, MAX_KCAL, 0);
  const protein = num(it.protein_g, MAX_MACRO_G, 1);
  const carbs = num(it.carbs_g, MAX_MACRO_G, 1);
  const fat = num(it.fat_g, MAX_MACRO_G, 1);
  if (calories === null || protein === null || carbs === null || fat === null) return null;

  return {
    name: it.name.trim().slice(0, 120),
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    confidence: confidenceOf(it.confidence),
    portion: portion(it.portion),
  };
}

/** The one figure `normalize` still clamps rather than refuses — argued in
 *  full in its docstring, and kept apart from `num` above so the asymmetry is
 *  visible in the code and not only in a comment. */
function confidenceOf(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return round2(Math.min(Math.max(n, 0), 1));
}

/** #58's half of normalize, and the same rule as everything above it: the
 *  schema promises the *shape*, this decides the *range*.
 *
 *  A portion is all-or-nothing. Half of one — a unit with no usable qty, or a
 *  qty with no name for what it counts — cannot draw the control and cannot be
 *  scaled from, and "1 of something unnamed" is exactly the invented portion
 *  #58 says never to show. So anything short of both parts becomes `null`,
 *  which is the same answer the model gives for "had lunch out".
 *
 *  **An out-of-range qty drops the whole portion, it is never clamped (#109).**
 *  This function used to `Math.min` the qty against the ceiling, which meant
 *  the app showed — and after #104 stored — a portion the person never stated,
 *  with nothing anywhere saying so. `200g of chicken` became a row claiming
 *  330 kcal came out of 100 g. A portion is all-or-nothing in the paragraph
 *  above for a reason, and that reason covers the qty too: null draws no
 *  control and invites a hand-edit, which is honest, where a confident wrong
 *  number is not. Compare #95 — a restore nobody can see is the reported bug
 *  wearing a different hat. The clamp on the *field* stays: a clamp somebody
 *  is watching happen is a typo-catcher, a clamp on the wire is a lie.
 *
 *  The ceilings and the unit list live in `src/worker/portion-limits.ts`
 *  (#111) — one statement for the Worker, carried from the client's
 *  `FOOD_LIMITS` on purpose and pinned against it by
 *  `portion-limits.route.test.ts`. */

function portion(value: unknown): AnalyzedItem["portion"] {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  const unit = typeof p.unit === "string" ? p.unit.trim().slice(0, 24) : "";
  if (!unit) return null;
  if (typeof p.qty !== "number" || !Number.isFinite(p.qty)) return null;
  // Rounded first, then tested — at BOTH ends. `0.04` is a positive number
  // that becomes 0 at one decimal place, and a zero qty is a divide-by-zero in
  // the sheet's rescale; `2000.04` is an over-range number that becomes 2000.
  // The guard has to sit on the value that actually ships, not on the one that
  // arrived, and 1dp is the resolution this field is stored at — so landing on
  // the ceiling *through rounding* is quantisation, not the clamp #109 killed.
  // `food-logs.ts` tests the same predicate in the same order.
  const qty = round1(p.qty);
  if (qty <= 0 || qty > maxPortionQty(unit)) return null;
  return { qty, unit };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default analyze;
