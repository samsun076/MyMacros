import { describe, expect, it } from "vitest";
import { FORBIDDEN_LABELS, queries, render, windowFor } from "./reconcile-inputs.mjs";

/** #83's tool has exactly one property worth testing, and it is a negative
 *  one: **the block it prints must contain no figure a reconciler is supposed
 *  to work out for themselves.**
 *
 *  Rule 4b's whole value is that the recomputation is independent. Print the
 *  answer beside the inputs and the reconciler reads it first, confirms it,
 *  and RECONCILIATIONS.md becomes a log of the app agreeing with itself — the
 *  failure would be invisible, because every entry would still say "✓ matches".
 *  So the guard has to live here, where a future "helpful" addition trips it.
 *
 *  The fixture's numbers are chosen so that **no derived figure collides with
 *  a raw one**. That is what makes the absence assertions mean something: if
 *  the trend weight were also a weigh-in, "81.7 is absent" would be untestable.
 *  Change a number below and check that property still holds. */
const PROFILE = {
  sex: "male",
  birth_date: "1988-06-15",
  height_cm: 172,
  activity_level: "moderate",
  goal: "cut",
  deficit_kcal: 400,
  athlete_profile: "general",
  eat_back_pct: 50,
  protein_g_per_kg: 2,
  carb_ratio_pct: 58,
  focus_macro: "protein",
  start_weight_kg: 88,
  goal_weight_kg: 75,
  units: "imperial",
  timezone: "America/New_York",
  updated_at: "2026-08-10T10:00:00.000Z",
};

const WEIGHTS = [
  { measured_on: "2026-08-03", weight_kg: 82.4, body_fat_pct: 26.6, source: "garmin" },
  { measured_on: "2026-08-06", weight_kg: 81.6, body_fat_pct: null, source: "garmin" },
  { measured_on: "2026-08-09", weight_kg: 81.1, body_fat_pct: 26.4, source: "manual" },
];

const DAYS = [
  { logged_on: "2026-08-05", rows_n: 4, kcal: 1802, protein_g: 118.5, carbs_g: 171.3, fat_g: 62.7, edited_n: 1 },
  { logged_on: "2026-08-07", rows_n: 1, kcal: 1655, protein_g: 96.2, carbs_g: 164.9, fat_g: 55.8, edited_n: 0 },
  { logged_on: "2026-08-09", rows_n: 5, kcal: 1910, protein_g: 130.4, carbs_g: 182.6, fat_g: 66.1, edited_n: 2 },
];

const RUNS = [
  { ran_on: "2026-08-06", distance_m: 9200, duration_s: 3300, kcal: 500, tss: 42, source: "debrief" },
];

const SOURCES = [
  { source: "runs", last_success_at: "2026-08-09T11:04:00.000Z", last_item_count: 3 },
  { source: "weights", last_success_at: "2026-08-09T11:04:00.000Z", last_item_count: 1 },
];

const block = render({
  date: "2026-08-09",
  weeks: 1,
  ...windowFor("2026-08-09", 1),
  profile: PROFILE,
  weights: WEIGHTS,
  days: DAYS,
  runs: RUNS,
  sources: SOURCES,
});

/** What a reconciler is supposed to work out from the fixture above, by hand,
 *  the way RECONCILIATIONS.md's existing entries do. Every one of these must
 *  be ABSENT from the block. */
const DERIVED = {
  "trend weight — (82.4 + 81.6 + 81.1) / 3": "81.7",
  "age on 2026-08-11 from 1988-06-15": "38",
  "BMR — 10(81.7) + 6.25(172) − 5(38) + 5": "1707",
  "TDEE — 1707 × 1.55": "2646",
  "base target — 2645.85 − 400": "2246",
  "earned — 500 × 50%": "250",
  "week's intake — 1802 + 1655 + 1910": "5367",
};

describe("reconcile-inputs renders the inputs", () => {
  /** The other half of the guard. Without this, `render()` returning an empty
   *  string would satisfy every absence assertion below and the suite would be
   *  green about a tool that prints nothing. */
  it.each([
    ["the profile's raw columns", ["172", "1988-06-15", "moderate", "400", "2", "58"]],
    ["every weigh-in, with its source", ["82.4", "81.6", "81.1", "garmin", "manual"]],
    ["each day's totals", ["1802", "1655", "1910", "118.5"]],
    ["the run as stored", ["9200", "3300", "500", "42"]],
    ["sync health", ["2026-08-09T11:04:00.000Z", "3"]],
  ])("prints %s", (_, values) => {
    for (const v of values) expect(block).toContain(v);
  });

  /** #74 was found by noticing a whole logged day was one entry. The count is
   *  the only editorial concession in the output, and it earns its place. */
  it("shows how many rows made up each day, not just the kcal", () => {
    expect(block).toContain("rows_n");
    expect(block).toMatch(/\| 2026-08-07 \| 1 \| 1655 \|/);
  });

  it("says how far back the weigh-in pull reaches, and why", () => {
    expect(block).toContain("2026-07-28");
    expect(block).toContain("six days before it");
  });

  /** Nothing-to-report must not look like failed-to-report (#69). */
  it("names an empty section instead of printing a blank one", () => {
    const empty = render({ date: "2026-08-09", weeks: 1, ...windowFor("2026-08-09", 1), profile: PROFILE, weights: [], days: [], runs: [], sources: [] });
    expect(empty).toContain("**no rows**");
    expect(empty).toContain("**no logged days**");
  });

  it("does not claim production when the pull was local", () => {
    const local = render({ date: "2026-08-09", weeks: 1, ...windowFor("2026-08-09", 1), profile: PROFILE, weights: WEIGHTS, days: DAYS, runs: RUNS, sources: SOURCES, local: true });
    expect(local).toContain("LOCAL D1 — not production");
    expect(local).not.toContain("production D1**");
  });
});

describe("reconcile-inputs prints no answer", () => {
  it.each(Object.entries(DERIVED))("withholds the %s", (_, value) => {
    // word boundaries, so 250 doesn't "appear" inside 1250 or a timestamp
    expect(block).not.toMatch(new RegExp(`\\b${value.replace(".", "\\.")}\\b`));
  });

  /** The label half. A derived figure has to be called something, and these
   *  are the names it would carry — so this trips on the addition itself
   *  rather than on whatever number it happened to produce for one fixture. */
  it.each(FORBIDDEN_LABELS)("never uses the word %s", (word) => {
    expect(block.toLowerCase()).not.toContain(word);
  });

  /** `profiles.target_kcal` is the commonest 4b answer and, since #85, a
   *  stale write-only cache — so it is not merely unprinted, it is never
   *  fetched. A column that doesn't arrive can't be leaked by a later edit. */
  it("never even asks the database for target_kcal", () => {
    const sql = Object.values(queries(windowFor("2026-08-09", 1))).join(" ");
    expect(sql).not.toContain("target_kcal");
    expect(sql.toLowerCase()).not.toContain("select *");
  });

  it("only reads", () => {
    for (const sql of Object.values(queries(windowFor("2026-08-09", 1)))) {
      expect(sql.trimStart().slice(0, 6).toUpperCase()).toBe("SELECT");
    }
  });
});

describe("windowFor", () => {
  it("ends on --date and runs back weeks × 7 days inclusive", () => {
    expect(windowFor("2026-08-10", 1)).toMatchObject({ from: "2026-08-04", to: "2026-08-10" });
    expect(windowFor("2026-08-10", 4).from).toBe("2026-07-14");
  });

  it("reaches six further days back for the smoothing window", () => {
    expect(windowFor("2026-08-10", 1).trendFrom).toBe("2026-07-29");
  });

  it("crosses a month boundary without drifting", () => {
    expect(windowFor("2026-03-02", 1).from).toBe("2026-02-24");
  });
});
