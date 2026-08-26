import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Documentation truth, for the part of it that is decidable (#135).
 *
 *  This repo's documentation rots and nothing noticed. Measured 2026-08-25, one
 *  day after the changes that broke it: `CLAUDE.md` asserted that passkey
 *  registration "needs an existing session" — the requirement #126 had removed
 *  that morning — and six npm scripts were undocumented, three of them added
 *  the same day. Every automated gate stayed green through all of it, because
 *  none of them reads prose.
 *
 *  ---
 *
 *  **WHAT THIS CANNOT SEE, and it is most of the problem.**
 *
 *  No test can know that a sentence stopped being true. "Passkey registration
 *  needs an existing session" is well-formed, cites nothing checkable, and was
 *  false — this file would have passed it every day for a year. What catches
 *  that is build rule 10 (when you remove a constraint, grep for its
 *  justification), which is a habit, not a check.
 *
 *  So this covers the *mechanical* half only: commands that exist, files that
 *  exist, migrations that exist. It is a guard against drift, never evidence
 *  that the docs are correct. Saying so here rather than leaving it to be
 *  inferred, because a check mistaken for coverage it does not have is this
 *  project's most-repeated defect.
 */

const read = (p) => readFileSync(p, "utf8");
const pkg = JSON.parse(read("package.json"));

/** The docs that make checkable claims. NEXT-STEPS.md is deliberately absent:
 *  it is a session log, an append-only record of what was true on a given day,
 *  and holding history to present-tense truth would be wrong. */
const DOCS = ["CLAUDE.md", "README.md", "install.md", "CONTRIBUTING.md", "PLAN.md"];

describe("every npm script is documented", () => {
  const claude = read("CLAUDE.md");

  it.each(Object.keys(pkg.scripts))("%s appears in CLAUDE.md", (script) => {
    expect(claude).toContain(`npm run ${script}`);
  });

  it("is checking a non-empty list of scripts", () => {
    // Without this, a renamed `scripts` key makes `it.each` iterate nothing,
    // the suite reports zero failures, and the whole file passes while
    // checking nothing. A green assertion is the dangerous kind.
    expect(Object.keys(pkg.scripts).length).toBeGreaterThan(15);
  });
});

describe("every documented command exists", () => {
  it.each(DOCS)("%s names no npm script that is gone", (doc) => {
    const named = [...read(doc).matchAll(/`?npm run ([a-z][a-z0-9:-]*)/g)].map((m) => m[1]);
    const unknown = [...new Set(named)].filter((s) => !(s in pkg.scripts));
    expect(unknown, `${doc} refers to npm scripts that do not exist`).toEqual([]);
  });

  it("found some commands to check", () => {
    const all = DOCS.flatMap((d) => [...read(d).matchAll(/npm run ([a-z][a-z0-9:-]*)/g)]);
    expect(all.length).toBeGreaterThan(20);
  });
});

describe("every file path a doc cites exists", () => {
  // Backticked paths that look like real repo paths: a slash, a known top-level
  // directory, and a file extension. Deliberately narrow — the cost of a false
  // positive here is a failing build over a sentence, which would get the
  // whole file deleted.
  const PATH = /`((?:src|tools|migrations|design|public|sketches|docs)\/[A-Za-z0-9._/-]+\.[a-z]{2,4})`/g;

  it.each(DOCS)("%s cites only files that are on disk", (doc) => {
    const cited = [...new Set([...read(doc).matchAll(PATH)].map((m) => m[1]))];
    const missing = cited.filter((f) => !existsSync(f));
    expect(missing, `${doc} cites paths that no longer exist`).toEqual([]);
  });

  it("found some paths to check", () => {
    const all = DOCS.flatMap((d) => [...read(d).matchAll(PATH)]);
    expect(all.length).toBeGreaterThan(20);
  });
});

describe("every migration a doc names is the CURRENT one", () => {
  /** Stricter than "the file exists", and deliberately so.
   *
   *  Every full migration filename in these docs today sits inside a sample
   *  `/api/health` response — a "this is what you should see" example. An
   *  example naming an older migration is stale by construction, and the file
   *  existing says nothing, because old migrations never go away.
   *
   *  Both docs quoted `0009_portion.sql` **the day after 0010 shipped**, in
   *  text written the day before that. This is the rot in its purest form:
   *  the install guide written to fix the documentation problem grew a stale
   *  claim within 24 hours.
   *
   *  If a doc ever needs to cite an old migration as history rather than as an
   *  example, this will fail and that is the moment to exempt it explicitly —
   *  a false failure that makes somebody look is worth far more than silence. */
  const expected = read("src/shared/schema.ts").match(/EXPECTED_MIGRATION = "([^"]+)"/)?.[1];

  it("found the constant to compare against", () => {
    expect(expected).toMatch(/^\d{4}_.+\.sql$/);
  });

  it.each(DOCS)("%s names no migration but the current one", (doc) => {
    const named = [...new Set([...read(doc).matchAll(/(\d{4}_[a-z0-9_]+\.sql)/g)].map((m) => m[1]))];
    for (const f of named) {
      expect(existsSync(`migrations/${f}`), `${doc} names a migration that does not exist: ${f}`).toBe(true);
    }
    const stale = named.filter((f) => f !== expected);
    expect(
      stale,
      `${doc} names a migration that is no longer current (expected ${expected}). ` +
        `If this is deliberate history rather than a sample response, exempt it here.`,
    ).toEqual([]);
  });
});
