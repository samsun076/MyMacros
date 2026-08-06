import { Hono } from "hono";
import type { AnalyzeResponse, AnalyzedItem } from "../../shared/api";
import type { AppEnv } from "../types";

const barcode = new Hono<AppEnv>();

/** OpenFoodFacts asks callers to identify themselves; an anonymous client can
 *  be rate-limited or blocked. Free, no key, no account. */
const USER_AGENT = "MyMacros/0.1 (https://fuel.debrief.run)";

/** The lookup is the whole latency budget for a scan — a barcode should feel
 *  instant next to a 4s vision call, and a slow third party shouldn't hold the
 *  viewfinder hostage. */
const LOOKUP_TIMEOUT_MS = 6000;

/** Below this, a package is one sitting and logging the whole thing is right
 *  (a 60 g bar). Above it, 100 g is the sane default — nobody eats a 400 g jar
 *  of Nutella in one go. Settled on #15. */
const SINGLE_SERVE_MAX_G = 200;

/** GET /api/barcode/:code (#15): UPC → OpenFoodFacts → the same
 *  `AnalyzeResponse` the photo and text paths return, so the confirm sheet,
 *  the save route and the toast never learn which mode produced the items.
 *
 *  Exact-match products carry `confidence: null` — the schema comment already
 *  says null means not-AI-estimated — and cost nothing, since no model runs. */
barcode.get("/:code", async (c) => {
  const code = c.req.param("code");
  // EAN-8 through GTIN-14 covers every food barcode; the regex also keeps
  // arbitrary path segments out of the upstream URL.
  if (!/^\d{8,14}$/.test(code)) return c.json({ error: "invalid_barcode" }, 400);

  const t0 = performance.now();
  const url =
    `https://world.openfoodfacts.org/api/v2/product/${code}.json` +
    `?fields=product_name,brands,quantity,nutriments`;

  let payload: OffResponse;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("barcode lookup http", res.status);
      return c.json({ error: "lookup_unavailable" }, 502);
    }
    payload = (await res.json()) as OffResponse;
  } catch (err) {
    console.error("barcode lookup failed", err);
    return c.json({ error: "lookup_unavailable" }, 502);
  }

  // Measured, not assumed: an unknown product comes back as HTTP 200 with
  // status 0. Checking the status code alone reports every unknown barcode as
  // a success and then reads nutriments off an empty object.
  if (payload.status !== 1 || !payload.product) {
    console.log("barcode timing", { code, outcome: "not_found", total_ms: Math.round(performance.now() - t0) });
    return c.json({ error: "product_not_found" }, 404);
  }

  const product = payload.product;
  const per100 = macrosPer100g(product.nutriments ?? {});
  if (per100 === null) {
    // The product exists but nobody has filled in its nutrition. Different
    // from not-found, and the client says so: the panel is in the user's hand.
    console.log("barcode timing", { code, outcome: "no_nutrition", total_ms: Math.round(performance.now() - t0) });
    return c.json({ error: "no_nutrition" }, 404);
  }

  const packageG = gramsOf(product.quantity);
  const grams = packageG !== null && packageG <= SINGLE_SERVE_MAX_G ? packageG : 100;
  const scale = grams / 100;

  const item: AnalyzedItem = {
    name: nameOf(product) || `Barcode ${code}`,
    calories: Math.round(per100.kcal * scale),
    protein_g: round1(per100.protein * scale),
    carbs_g: round1(per100.carbs * scale),
    fat_g: round1(per100.fat * scale),
    confidence: null,
  };

  console.log("barcode timing", {
    code,
    outcome: "ok",
    grams,
    total_ms: Math.round(performance.now() - t0),
  });
  return c.json<AnalyzeResponse>({ items: [item], barcode: code, grams });
});

type OffResponse = {
  status?: number;
  product?: {
    product_name?: unknown;
    brands?: unknown;
    quantity?: unknown;
    nutriments?: Record<string, unknown>;
  };
};

/** "Ferrero Nutella" — brand first, the way a label reads, skipping the brand
 *  when the product name already carries it. */
function nameOf(product: NonNullable<OffResponse["product"]>) {
  const name = str(product.product_name);
  const brand = str(product.brands).split(",")[0]?.trim() ?? "";
  if (!name) return brand;
  if (!brand || name.toLowerCase().includes(brand.toLowerCase())) return name;
  return `${brand} ${name}`;
}

/** The per-100g nutriments, or null when the product has no usable energy
 *  value. `_100g` is the field family OpenFoodFacts computes for every
 *  product regardless of how the contributor entered it. */
function macrosPer100g(n: Record<string, unknown>) {
  let kcal = num(n["energy-kcal_100g"]);
  // Plenty of EU products carry only kilojoules; the rest of the row is fine,
  // so converting beats discarding the product.
  if (kcal === null) {
    const kj = num(n["energy_100g"]);
    kcal = kj === null ? null : kj / 4.184;
  }
  if (kcal === null) return null;
  return {
    kcal,
    protein: num(n["proteins_100g"]) ?? 0,
    carbs: num(n["carbohydrates_100g"]) ?? 0,
    fat: num(n["fat_100g"]) ?? 0,
  };
}

/** "400.0 g" / "60g" / "1.5 kg" → grams. Anything else (millilitres, "6 x
 *  25 g", a bare number) is left to the 100 g default rather than guessed at. */
function gramsOf(quantity: unknown) {
  const match = /^\s*([\d.]+)\s*(kg|g)\b/i.exec(str(quantity));
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2]!.toLowerCase() === "kg" ? value * 1000 : value;
}

function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown) {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export default barcode;
