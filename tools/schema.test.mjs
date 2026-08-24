import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPECTED_MIGRATION } from "../src/shared/schema.ts";

/** The oracle that lets `EXPECTED_MIGRATION` be a hand-written constant (#129).
 *
 *  In `tools/` rather than beside its source because it reads the filesystem,
 *  and `tsconfig.app`/`tsconfig.worker` carry no Node types — the same reason
 *  `reconcile-inputs.test.mjs` lives here. The unit project picks up
 *  `tools/ **\/*.test.mjs` already.
 *
 *  It reads the real directory rather than a fixture on purpose: a fixture
 *  would be a third statement of the same fact, and the failure being guarded
 *  against is precisely that two statements of it come apart. */
describe("EXPECTED_MIGRATION", () => {
  const applied = readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("is the newest file in migrations/", () => {
    expect(EXPECTED_MIGRATION).toBe(applied.at(-1));
  });

  it("names a file that exists", () => {
    expect(applied).toContain(EXPECTED_MIGRATION);
  });

  it("is checked against a directory that actually has migrations in it", () => {
    // Without this, a mistyped path makes `applied` an empty array, the first
    // assertion compares undefined to undefined, and the whole oracle passes
    // while checking nothing. A green assertion is the dangerous kind.
    expect(applied.length).toBeGreaterThan(5);
    expect(applied[0]).toBe("0001_schema_v1.sql");
  });
});
