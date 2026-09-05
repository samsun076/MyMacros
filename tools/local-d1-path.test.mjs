import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { D1_UNIQUE_KEY, durableObjectIdFromName, localD1Path } from "./local-d1-path.mjs";

/** The one pair that matters (#106): the database_id that was in
 *  `wrangler.jsonc` on 2026-09-05 and the file miniflare actually wrote for it,
 *  read off disk beside a stale sibling from a previous id. If a miniflare
 *  upgrade changes the derivation, this goes red before `db:studio` starts
 *  lying again. */
describe("localD1Path resolves the file miniflare uses", () => {
  it("matches the measured live file for the known id", () => {
    expect(durableObjectIdFromName(D1_UNIQUE_KEY, "4cf59eaf-8cfe-4c44-b599-d038018fcaed")).toBe(
      "edc49429acd4c69a7a39acdedd0e4d40c907f79c45c6de3d0e2eeae4bfc10bd2",
    );
  });

  it("is not the stale sibling — a different id, a different file", () => {
    expect(localD1Path("00000000-0000-0000-0000-000000000000")).not.toContain("edc49429");
  });

  it("db:studio goes through it, not through `find | head -1`", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["db:studio"]).toContain("tools/local-d1-path.mjs");
    expect(pkg.scripts["db:studio"]).not.toContain("find ");
  });
});
