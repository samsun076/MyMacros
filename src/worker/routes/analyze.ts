import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import type { AnalyzeResponse, AnalyzedItem } from "../../shared/api";
import type { AppEnv } from "../types";

const analyze = new Hono<AppEnv>();

/** What we ask Claude to return. Structured outputs guarantee the shape but
 *  silently DROP numeric bounds (minimum/maximum are stripped from the schema
 *  sent to the API — settled on #45), so confidence and the macro numbers are
 *  range-checked in normalize() below, never trusted from the wire. */
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

/** POST /api/analyze/text (#9): free text → claude-sonnet-5 structured
 *  output → items for the confirm sheet. Sonnet 5 thinks by default;
 *  thinking is disabled and effort low because PLAN.md promises the happy
 *  path under ~10 seconds (settled on #45). */
analyze.post("/text", async (c) => {
  const body = await c.req.json<{ text?: unknown }>().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return c.json({ error: "text_required" }, 400);
  if (text.length > 1000) return c.json({ error: "text_too_long" }, 400);

  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const response = await client.messages.create({
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

    if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
      console.error("analyze/text stopped early", response.stop_reason);
      return c.json({ error: "analyze_failed" }, 502);
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block) return c.json({ error: "analyze_failed" }, 502);
    raw = block.text;
  } catch (err) {
    // surfaced, never stubbed: a missing/invalid key or an API outage should
    // be visible to the person logging, not silently zero-calorie
    console.error("analyze/text api error", err);
    return c.json({ error: "analyze_unavailable" }, 502);
  }

  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(raw) as { items?: unknown };
  } catch {
    console.error("analyze/text unparseable output", raw.slice(0, 200));
    return c.json({ error: "analyze_failed" }, 502);
  }

  const items = Array.isArray(parsed.items) ? parsed.items.map(normalize).filter(Boolean) : [];
  return c.json<AnalyzeResponse>({ items: items as AnalyzedItem[] });
});

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
