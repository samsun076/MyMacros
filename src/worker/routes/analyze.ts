import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import type { AnalyzeResponse, AnalyzedItem } from "../../shared/api";
import { newPhotoKey } from "../photos";
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
        },
        required: ["name", "calories", "protein_g", "carbs_g", "fat_g", "confidence"],
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
    });
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
    console.error("analyze/text api error", err);
    run.done("api_error");
    return c.json({ error: "analyze_unavailable" }, 502);
  }

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(raw) as { items?: unknown };
  } catch {
    console.error("analyze/text unparseable output", raw.slice(0, 200));
    run.done("unparseable");
    return c.json({ error: "analyze_failed" }, 502);
  }

  const items = Array.isArray(parsed.items) ? parsed.items.map(normalize).filter(Boolean) : [];
  run.done("ok");
  return c.json<AnalyzeResponse>({ items: items as AnalyzedItem[] });
});

/** Largest upload accepted. The client downscales to 1568px on the long edge
 *  at q0.8, which measured 214 KB on device — 6 MB is a wide ceiling that
 *  still refuses a full-resolution original before it costs an R2 write. */
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** POST /api/analyze/photo (#13/#14): the photo arrives in the same request
 *  that persists it — settled on #13, because at 214 KB there is nothing for
 *  a presigned direct-to-R2 upload to save, and one request is one place for
 *  #16's failure UX rather than two.
 *
 *  Order matters: **R2 is written before Claude is called.** #16 requires
 *  "never lose the photo the user took", and doing it in this order makes
 *  that structural instead of something the error path has to remember. */
analyze.post("/photo", async (c) => {
  const t0 = performance.now();

  const form = await c.req.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return c.json({ error: "photo_required" }, 400);
  if (photo.size > MAX_PHOTO_BYTES) return c.json({ error: "photo_too_large" }, 413);
  // Both capture paths — the live viewfinder and the <input capture> fallback
  // — encode through the same canvas helper, so JPEG is a contract the client
  // always meets and not a guess about what a device might hand us.
  if (photo.type !== "image/jpeg") return c.json({ error: "photo_not_jpeg" }, 415);

  const bytes = new Uint8Array(await photo.arrayBuffer());

  const key = newPhotoKey(c.var.user.id);
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

  // Base64, not a URL source: R2 objects here are private and served through
  // an authenticated Worker route, so Anthropic's fetcher cannot reach them.
  // Not a preference — the URL source is unavailable to this deployment. The
  // Worker already holds the bytes, so there is nothing to re-fetch either.
  const run = instrument(c.env, "analyze/photo", t0);
  const noteRaw = form?.get("note");
  const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 300) : "";

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
            {
              type: "text",
              text: note
                ? `Log what is in this photo. The person added a note: ${note}`
                : "Log what is in this photo.",
            },
          ],
        },
      ],
    });
    run.apiDone();

    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
      console.error("analyze/photo stopped early", response.stop_reason);
      run.done("stopped_early", { photo_bytes: photo.size });
      return c.json<AnalyzeResponse>({ items: [], photo_key: key }, 200);
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block) {
      run.done("no_text_block", { photo_bytes: photo.size });
      return c.json<AnalyzeResponse>({ items: [], photo_key: key }, 200);
    }
    raw = block.text;
  } catch (err) {
    run.apiDone();
    console.error("analyze/photo api error", err);
    run.done("api_error", { photo_bytes: photo.size });
    // 502 with the key attached: the read failed, the photo did not. The
    // client keeps the key so the save path stays open (#16).
    return c.json({ error: "analyze_unavailable", photo_key: key }, 502);
  }

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(raw) as { items?: unknown };
  } catch {
    console.error("analyze/photo unparseable output", raw.slice(0, 200));
    run.done("unparseable", { photo_bytes: photo.size });
    return c.json({ error: "analyze_failed", photo_key: key }, 502);
  }

  const items = Array.isArray(parsed.items) ? parsed.items.map(normalize).filter(Boolean) : [];
  run.done("ok", { photo_bytes: photo.size, items: items.length });
  return c.json<AnalyzeResponse>({ items: items as AnalyzedItem[], photo_key: key });
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

/** The schema guarantees presence and type; this guards the ranges the
 *  schema can't. */
function normalize(item: unknown): AnalyzedItem | null {
  const it = item as Record<string, unknown>;
  if (typeof it?.name !== "string" || !it.name.trim()) return null;
  const num = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0;
  return {
    name: it.name.trim().slice(0, 120),
    calories: Math.round(num(it.calories, 10000)),
    protein_g: round1(num(it.protein_g, 1000)),
    carbs_g: round1(num(it.carbs_g, 1000)),
    fat_g: round1(num(it.fat_g, 1000)),
    confidence: round2(num(it.confidence, 1)),
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default analyze;
