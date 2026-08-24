import { readFileSync } from "node:fs";

/** Read `wrangler.jsonc` well enough to preflight a deploy (#127).
 *
 *  **Why not a JSONC library:** there isn't one in this tree, and adding a
 *  dependency so one script can read one file is the wrong trade. **Why not a
 *  naive `//` strip:** `wrangler.jsonc` contains `"https://fuel.debrief.run"`,
 *  and a stripper that does not know it is inside a string turns that into
 *  `"https:` and takes the rest of the config with it. So this tracks string
 *  state, and `wrangler-config.test.mjs` asserts the values it extracts from
 *  the real file — which is the only reason a hand-rolled parser is acceptable
 *  here rather than merely convenient.
 */
export function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch; // keep the newline so line numbers survive
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      // A backslash escapes the next character, including a quote — without
      // this, "a\"b" ends the string early and every following comment marker
      // is read inside-out.
      if (ch === "\\") {
        out += text[++i] ?? "";
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }

  // Trailing commas are legal in JSONC and wrangler accepts them.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** The deployment identity this config would deploy: what it is called, and
 *  which resources it would bind. These four are what a second instance must
 *  change, and forgetting the first is what silently replaces the first
 *  instance. */
export function readWranglerConfig(path = "wrangler.jsonc") {
  const config = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
  return {
    name: config.name,
    databaseId: config.d1_databases?.[0]?.database_id ?? null,
    databaseName: config.d1_databases?.[0]?.database_name ?? null,
    bucket: config.r2_buckets?.[0]?.bucket_name ?? null,
    appUrl: config.vars?.APP_URL ?? null,
    routes: config.routes ?? [],
  };
}
