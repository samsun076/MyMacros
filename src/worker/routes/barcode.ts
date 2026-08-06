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

/** Below this, a package is one sitting and logging the whole thing is right.
 *  Above it, 100 g is the sane default — nobody eats a 400 g jar of Nutella in
 *  one go. Only consulted when the product defines no serving of its own. */
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
    // `quantity` is requested but never read: OpenFoodFacts derives
    // `product_quantity` from it *inside* the fields filter, so omitting the
    // string nulls out the number. Asking for fewer fields changes the value
    // of a field you did ask for. Measured — dropping it silently sent a 51 g
    // Mars bar back to the 100 g default.
    `?fields=product_name,brands,quantity,serving_quantity,product_quantity,nutriments`;

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

  const grams = defaultGrams(product);
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
    /** Grams in one serving as the product defines it, already numeric. */
    serving_quantity?: unknown;
    /** Grams in the whole package, already numeric. */
    product_quantity?: unknown;
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

/** How much of it the sheet opens on.
 *
 *  **`serving_quantity` first.** It is the portion the product defines for
 *  itself — "1 bar (68 g)" → 68 — and it is exactly the amount someone
 *  scanning a single-serve item is about to eat. Missing it is what made a
 *  CLIF bar open at 368 kcal (100 g) instead of the 250 kcal printed on it: a
 *  47% overstatement, silent, with correct nutrition underneath.
 *
 *  That mistake came from generalising off one product. Nutella has no
 *  `serving_size` — but Nutella is a 400 g jar, the one shape that genuinely
 *  has no serving. Single-serve items, where the portion matters most, carry
 *  it. One observation was never enough to build a default on.
 *
 *  These fields are **pre-parsed numbers**, so there is no string to regex.
 *  The regex this replaced only understood metric-first strings and matched
 *  nothing against a US label's "2.40 oz (68 g)" — a second silent fallback to
 *  100 g underneath the first. */
function defaultGrams(product: NonNullable<OffResponse["product"]>) {
  const serving = positive(num(product.serving_quantity));
  const packaged = positive(num(product.product_quantity));

  // A serving larger than the whole package is contributor junk, not a
  // serving — a 51 g Mars bar carries "100 g" in that field, which nobody
  // eats. The package is the ceiling on what one serving can be.
  if (serving !== null && (packaged === null || serving <= packaged)) {
    return Math.round(serving);
  }

  // No usable serving: log the whole package if it's plausibly one sitting.
  if (packaged !== null && packaged <= SINGLE_SERVE_MAX_G) return Math.round(packaged);

  return 100;
}

function positive(n: number | null) {
  return n !== null && n > 0 ? n : null;
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
