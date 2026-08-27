import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const DOCS = [
  "CLAUDE.md",
  "README.md",
  "install.md",
  "CONTRIBUTING.md",
  "PLAN.md",
  "docs/what-the-numbers-mean.md",
  ...readdirSync("docs/features")
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/features/${f}`),
];

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

/** Every number the walkthrough quotes matches the constant it describes (#134).
 *
 *  #134 said, in a "Watch for" block: *"Do not restate a number. Anything
 *  quoting a threshold (7 days, 60%, 18h) is a second statement of a constant in
 *  `src/shared/`."* That is correct and it is also unusable — you cannot explain
 *  a trend weight to a person without saying "seven days", and "about a week"
 *  ages beautifully while helping nobody.
 *
 *  So the walkthrough quotes the real numbers and this family is the price. It
 *  is the same shape as the migration family above: a doc states a value, a
 *  constant is the source, and the build fails when they disagree.
 *
 *  The constants are IMPORTED rather than regexed out of source, which
 *  `tools/schema.test.mjs` established is possible here — a `tools/*.test.mjs`
 *  runs under the unit project and Vite transforms the TypeScript. Regexing them
 *  would make this a check on two strings rather than on a value and a string.
 *
 *  **The pattern must match, or the check is decorative.** Every entry asserts
 *  its own regex found something before comparing, because a doc reworded past
 *  its pattern and a doc that agrees with the code produce the same green run —
 *  and that is the failure mode CLAUDE.md's test section warns about most.
 */
describe("every number the walkthrough quotes matches its constant", async () => {
  const { TREND_WINDOW_DAYS } = await import("../src/shared/weight.ts");
  const { KCAL_PER_KG, MIN_LOGGED_DAYS, MIN_LOGGED_SHARE } = await import("../src/shared/trends.ts");
  const { STALE_AFTER_HOURS } = await import("../src/shared/sync.ts");
  const { KCAL_PER_G, PROTEIN_G_PER_KG } = await import("../src/shared/budget.ts");
  const { PROFILE_DEFAULTS } = await import("../src/shared/profile.ts");

  const WALKTHROUGH = "docs/what-the-numbers-mean.md";
  const raw = read(WALKTHROUGH);
  /** Matched against whitespace-collapsed prose. Markdown hard-wraps at 90
   *  columns, so a pattern written against the rendered sentence breaks the
   *  moment a paragraph reflows — which is a check going silent for a reason
   *  that has nothing to do with the claim. Caught on this family's first run:
   *  the line wrapped between "day's" and "budget" and the pattern found
   *  nothing. The empty-match guard below is what reported it. */
  const doc = raw.replace(/\s+/g, " ");

  /** [label, /regex with one capture group/g, expected value].
   *  Written against the doc's actual sentences, so rewording the doc past a
   *  pattern fails loudly rather than quietly stopping the check. */
  const QUOTED = [
    ["trend window (list)", /mean of every weigh-in in the last (\d+) days/g, TREND_WINDOW_DAYS],
    ["trend window (lead)", /a \*\*(\d+)-day average\*\*, not today's reading/g, TREND_WINDOW_DAYS],
    ["trend window (summary)", /A (\d+)-day mean, because daily weight/g, TREND_WINDOW_DAYS],
    ["eat-back default", /The default eat-back is \*\*(\d+)%\*\*/g, PROFILE_DEFAULTS.eat_back_pct],
    ["stale hours (body)", /has not checked in for \*\*(\d+) hours\*\*/g, STALE_AFTER_HOURS],
    ["stale hours (summary)", /quiet for over (\d+) hours/g, STALE_AFTER_HOURS],
    ["protein on a cut", /the target is \*\*([\d.]+) g\*\* per kg/g, PROTEIN_G_PER_KG.cut],
    ["protein on maintenance", /but ([\d.]+) on maintenance/g, PROTEIN_G_PER_KG.maintain],
    ["kcal per kg of tissue", /\*\*([\d,]+) kcal per kg\*\*/g, KCAL_PER_KG],
    ["minimum logged days", /at least \*\*(\d+)\*\* logged days/g, MIN_LOGGED_DAYS],
    ["minimum logged share", /at least \*\*(\d+)%\*\* of that day's budget/g, MIN_LOGGED_SHARE * 100],
  ];

  it.each(QUOTED)("%s", (label, re, expected) => {
    const found = [...doc.matchAll(re)].map((m) => Number(m[1].replace(/,/g, "")));
    expect(
      found.length,
      `${WALKTHROUGH} no longer contains the sentence this check reads (${label}). ` +
        `Either the doc was reworded — update the pattern — or the claim was dropped. ` +
        `A pattern that matches nothing is a check that cannot fail.`,
    ).toBeGreaterThan(0);
    for (const n of found) {
      expect(n, `${WALKTHROUGH} quotes ${n} for ${label}; the constant says ${expected}`).toBe(
        expected,
      );
    }
  });

  it("quotes the macro energy values the code uses", () => {
    const m = doc.match(/protein (\d+) kcal, carbs (\d+) kcal, fat (\d+) kcal/);
    expect(m, `${WALKTHROUGH} no longer states the per-gram energy values`).not.toBeNull();
    expect([Number(m[1]), Number(m[2]), Number(m[3])]).toEqual([
      KCAL_PER_G.protein,
      KCAL_PER_G.carbs,
      KCAL_PER_G.fat,
    ]);
  });

  /** The guard every family in this file carries: a corpus that went empty, or a
   *  table someone trimmed, must not pass as coverage. */
  it("checked a plausible number of quotations", () => {
    expect(QUOTED.length).toBeGreaterThan(8);
    expect(raw.length).toBeGreaterThan(4000);
  });
});

/** Every screenshot a feature article cites is generated, and still there (#134).
 *
 *  The whole design of `docs/features/` rests on one claim: **no image in it is
 *  hand-placed**. CLAUDE.md's account of how the site's documentation rotted is
 *  *"images decay loudly and prose decays quietly"* — loud decay is only the
 *  better half if the images are cheap to redo, and they are only cheap to redo
 *  if every one of them is in the manifest `npm run docs:shots` walks.
 *
 *  So this asserts the two halves of that claim in the two directions that can
 *  break:
 *
 *    - an article cites an image no manifest entry produces (someone dropped a
 *      PNG in by hand, and it will silently age forever), and
 *    - an article cites an image that is not on disk (the manifest entry was
 *      renamed or removed and the article was not).
 *
 *  What it deliberately does NOT assert is that the images are up to date. No
 *  test can know that a screenshot stopped resembling the app — that is the
 *  same half build rule 10 exists for, one medium over.
 */
describe("every feature-article screenshot is generated and present", async () => {
  const { MANIFEST } = await import("./doc-shots.mjs");
  const ids = new Set(MANIFEST.map((s) => s.id));
  const articles = readdirSync("docs/features")
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => `docs/features/${f}`);

  it("the manifest is populated", () => {
    expect(MANIFEST.length).toBeGreaterThan(20);
    expect(new Set(MANIFEST.map((s) => s.id)).size, "duplicate ids overwrite each other").toBe(
      MANIFEST.length,
    );
  });

  it("there is at least one article to check", () => {
    // Without this, an empty docs/features/ makes every assertion below vacuous
    // and the family reports a clean pass over nothing at all.
    expect(articles.length).toBeGreaterThan(0);
  });

  it.each(articles)("%s cites only generated, existing images", (article) => {
    const cited = [...read(article).matchAll(/\]\(img\/([a-z0-9-]+)\.png\)/g)].map((m) => m[1]);
    expect(cited.length, `${article} cites no screenshot at all — is it really a feature article?`)
      .toBeGreaterThan(0);

    const unmanaged = cited.filter((id) => !ids.has(id));
    expect(
      unmanaged,
      `${article} cites images that no manifest entry in tools/doc-shots.mjs produces: ` +
        `${unmanaged.join(", ")}. A hand-placed screenshot cannot be regenerated and will ` +
        `age silently — add it to MANIFEST instead.`,
    ).toEqual([]);

    const absent = cited.filter((id) => !existsSync(`docs/features/img/${id}.png`));
    expect(
      absent,
      `${article} cites images that are not on disk: ${absent.join(", ")}. Run npm run docs:shots.`,
    ).toEqual([]);
  });
});
