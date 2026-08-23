import { describe, expect, it } from "vitest";
import { normalize, photoTurn, usable } from "./analyze";

/** Structured outputs guarantee the *shape* of what Claude returns and
 *  silently drop `minimum`/`maximum` from the schema that is sent (#45). So
 *  the JSON schema cannot promise a calorie count is positive, or that
 *  confidence is a probability — `normalize` is the only thing that does, on
 *  the way to a row that a budget will later be computed from. */
describe("normalize", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    name: "Chicken burrito",
    calories: 640,
    protein_g: 41.2,
    carbs_g: 62.8,
    fat_g: 22.4,
    confidence: 0.62,
    ...over,
  });

  it("passes a well-formed item through", () => {
    expect(normalize(item({ portion: { qty: 1, unit: "burrito" } }))).toEqual({
      name: "Chicken burrito",
      calories: 640,
      protein_g: 41.2,
      carbs_g: 62.8,
      fat_g: 22.4,
      confidence: 0.62,
      portion: { qty: 1, unit: "burrito" },
    });
  });

  /* #110. The three tests this replaces asserted the CLAMP — negatives floored
     to zero, absurd values pinned at the ceiling, junk substituted with zero —
     and each one is now the behaviour being refused rather than the behaviour
     being kept. Every case is its own `it`, for #109's reason: a table with
     four assertions in it tells a red run about the first line and nothing
     about the rest. */

  it("drops an item whose calories are over the ceiling (#110)", () => {
    expect(normalize(item({ calories: 999999 }))).toBeNull();
  });

  it("drops an item whose macro is over the ceiling, rather than pinning it", () => {
    // #110's own captured response, before the clamp got to it: `5000g of
    // white rice` returned ~1,400 g of carbohydrate and 6,450 kcal, and what
    // reached the sheet was `carbs_g: 1000` pinned at the ceiling beside an
    // UNCLAMPED 6,450 — a row contradicting itself, since 1,000 g of
    // carbohydrate is 4,000 kcal.
    expect(normalize(item({ calories: 6450, carbs_g: 1400 }))).toBeNull();
  });

  it("drops on any one of the four, not only calories", () => {
    expect(normalize(item({ protein_g: 1000.1 }))).toBeNull();
    expect(normalize(item({ carbs_g: 1000.1 }))).toBeNull();
    expect(normalize(item({ fat_g: 1000.1 }))).toBeNull();
  });

  it("accepts the ceilings themselves — the bound is not off by one", () => {
    expect(normalize(item({ calories: 10000 }))).toMatchObject({ calories: 10000 });
    expect(normalize(item({ protein_g: 1000, carbs_g: 1000, fat_g: 1000 }))).toMatchObject({
      protein_g: 1000,
      carbs_g: 1000,
      fat_g: 1000,
    });
  });

  it("drops a negative rather than flooring it to zero (#110)", () => {
    // The old name for this was "floors negatives at zero rather than logging a
    // meal that gives calories back". The fear was right and the remedy
    // invented a zero-calorie food to satisfy it; dropping keeps the negative
    // out of the day's total without claiming anything.
    expect(normalize(item({ calories: -200 }))).toBeNull();
    expect(normalize(item({ protein_g: -1 }))).toBeNull();
  });

  it("drops a figure that is not a number at all", () => {
    expect(normalize(item({ calories: NaN }))).toBeNull();
    expect(normalize(item({ calories: Infinity }))).toBeNull();
    expect(normalize(item({ protein_g: "41" }))).toBeNull();
    expect(normalize(item({ carbs_g: null }))).toBeNull();
    expect(normalize(item({ fat_g: undefined }))).toBeNull();
  });

  it("still clamps confidence — the one figure #110 deliberately left", () => {
    expect(normalize(item({ confidence: 42 }))?.confidence).toBe(1);
    expect(normalize(item({ confidence: -0.5 }))?.confidence).toBe(0);
    expect(normalize(item({ confidence: 0.876 }))?.confidence).toBe(0.88);
  });

  it("does not drop an item over a malformed confidence", () => {
    // It is a statement ABOUT the four numbers, not one of them, so it cannot
    // make a row contradict itself — and throwing the item away would cost
    // four usable macros to report a broken meta field.
    expect(normalize(item({ confidence: "high" }))).toMatchObject({ calories: 640, confidence: 0 });
  });

  it("rounds calories to whole and macros to one place", () => {
    expect(normalize(item({ calories: 640.6, protein_g: 41.26 }))).toMatchObject({
      calories: 641,
      protein_g: 41.3,
    });
  });

  /** Not the clamp coming back, and the same rule `portion()` keeps: whole
   *  kcal and 1dp are the resolutions these values are stored at, so a number
   *  that lands on a bound *through rounding* has been quantised, not
   *  rewritten. Tested at both ends. */
  it("rounds before testing the ceiling", () => {
    expect(normalize(item({ calories: 10000.4 }))).toMatchObject({ calories: 10000 });
    expect(normalize(item({ protein_g: 1000.04 }))).toMatchObject({ protein_g: 1000 });
  });

  it("rounds before testing the floor, and never reports -0", () => {
    const got = normalize(item({ protein_g: -0.04 }));
    expect(got).toMatchObject({ protein_g: 0 });
    expect(Object.is(got?.protein_g, -0)).toBe(false);
  });

  it("drops the whole item, not the offending figure", () => {
    // A macro has no null representation — `0` is a real answer — so nulling
    // the figure would make "unknown" and "none" read the same.
    expect(normalize(item({ calories: 999999 }))).toBeNull();
  });

  it("drops an item with no name — there is nothing to show on the sheet", () => {
    expect(normalize(item({ name: "" }))).toBeNull();
    expect(normalize(item({ name: "   " }))).toBeNull();
    expect(normalize(item({ name: 42 }))).toBeNull();
    expect(normalize(item({ name: undefined }))).toBeNull();
  });

  it("survives junk where an object should be", () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(undefined)).toBeNull();
    expect(normalize("burrito")).toBeNull();
  });

  it("trims and truncates the name", () => {
    expect(normalize(item({ name: "  Burrito  " }))?.name).toBe("Burrito");
    expect(normalize(item({ name: "x".repeat(500) }))?.name).toHaveLength(120);
  });

  /** #58. The schema states `portion` as `anyOf: [object, null]` and structured
   *  outputs strip `minimum`/`maximum` from it exactly as they do everywhere
   *  else (#45), so nothing about the qty is trusted off the wire.
   *
   *  The other half is that a *half* portion is refused rather than repaired.
   *  A unit with no usable qty is "1 of something", which is the invented
   *  serving #58 says never to show; a qty with no unit is a bare number the
   *  sheet cannot label. Both become null — the same answer "had lunch out"
   *  gets, and the row degrades to hand-editing. */
  describe("portion", () => {
    const p = (portion: unknown) => normalize(item({ portion }))?.portion;

    /* #109. Two changes, and they are separable — one about the number, one
       about what happens when the number is exceeded.

       Each case is its own `it` on purpose. The table these replace was a
       single test with two assertions in it, and a red run of that shape tells
       you about the first line and nothing about the second. */
    it("passes a weighed portion through — the bug (#109)", () => {
      expect(p({ qty: 200, unit: "g" })).toEqual({ qty: 200, unit: "g" });
    });

    it("takes the measured ceiling for a weight, not the counted one", () => {
      expect(p({ qty: 2000, unit: "g" })).toEqual({ qty: 2000, unit: "g" });
    });

    it("still has a ceiling for a weight", () => {
      expect(p({ qty: 2000.1, unit: "g" })).toBeNull();
    });

    /** Volume was the judgement call #109 left open — decided in, because
     *  "250ml of milk" is "200g of chicken" with a different label. */
    it("treats a volume as measured too", () => {
      expect(p({ qty: 250, unit: "ml" })).toEqual({ qty: 250, unit: "ml" });
    });

    it("reads the unit as a label, however it is spelled", () => {
      expect(p({ qty: 200, unit: "Grams" })).toEqual({ qty: 200, unit: "Grams" });
    });

    /** A cup is a standard volume and is still *counted* — you count scoops. */
    it("keeps the tight ceiling for a counted unit", () => {
      expect(p({ qty: 200, unit: "cups" })).toBeNull();
    });

    it("keeps the tight ceiling for a slipped thumb on slices", () => {
      expect(p({ qty: 5000, unit: "slices" })).toBeNull();
    });

    /** The behaviour change, stated on its own: this used to answer
     *  `{ qty: 100 }` — a portion the person never said, shown and stored with
     *  nothing anywhere saying it had been rewritten. */
    it("drops an over-range portion rather than clamping it (#109)", () => {
      expect(p({ qty: 100.4, unit: "slices" })).toBeNull();
    });

    it("accepts the counted ceiling itself", () => {
      expect(p({ qty: 100, unit: "slices" })).toEqual({ qty: 100, unit: "slices" });
    });

    /** Not the clamp coming back: 1dp is the resolution the field and the
     *  column both hold, so 100.04 and 100.0 are the same portion. The guard
     *  sits on the value that ships, at both ends. */
    it("rounds to 1dp before testing the ceiling, as it does the floor", () => {
      expect(p({ qty: 100.04, unit: "slices" })).toEqual({ qty: 100, unit: "slices" });
    });

    it("keeps a fractional qty at one decimal place", () => {
      expect(p({ qty: 1.5, unit: "cups" })).toEqual({ qty: 1.5, unit: "cups" });
      expect(p({ qty: 2.46, unit: "cups" })).toEqual({ qty: 2.5, unit: "cups" });
    });

    it("refuses a negative or zero qty rather than flooring it to something", () => {
      expect(p({ qty: -3, unit: "slices" })).toBeNull();
      expect(p({ qty: 0, unit: "slices" })).toBeNull();
      // positive, and still zero once it is rounded to what ships — the sheet
      // divides by this number
      expect(p({ qty: 0.04, unit: "slices" })).toBeNull();
    });

    it("refuses a qty that isn't a number", () => {
      expect(p({ qty: "4", unit: "slices" })).toBeNull();
      expect(p({ qty: null, unit: "slices" })).toBeNull();
      expect(p({ qty: Number.NaN, unit: "slices" })).toBeNull();
      expect(p({ qty: Number.POSITIVE_INFINITY, unit: "slices" })).toBeNull();
    });

    it("refuses half a portion — a unit with no qty, a qty with no unit", () => {
      expect(p({ unit: "slices" })).toBeNull();
      expect(p({ qty: 4 })).toBeNull();
      expect(p({ qty: 4, unit: "   " })).toBeNull();
      expect(p({ qty: 4, unit: 12 })).toBeNull();
    });

    it("is null when the model returns none — no invented serving", () => {
      expect(p(null)).toBeNull();
      expect(p(undefined)).toBeNull();
      expect(normalize({ ...item(), portion: undefined })?.portion).toBeNull();
    });

    it("survives junk where the portion object should be", () => {
      expect(p("four slices")).toBeNull();
      expect(p(42)).toBeNull();
      expect(p([{ qty: 4, unit: "slices" }])).toBeNull();
    });

    it("truncates an absurdly long unit rather than storing an essay", () => {
      expect(p({ qty: 1, unit: "x".repeat(500) })?.unit).toHaveLength(24);
      expect(p({ qty: 1, unit: "  slices  " })?.unit).toBe("slices");
    });
  });
});

/** #110's other half: the count that tells the sheet a food is missing.
 *
 *  A silent drop is the same defect as the silent clamp it replaces, one level
 *  up — a person who photographed a plate and got back fewer foods than are on
 *  it has been told nothing. These are the assertions that fail if the count
 *  stops being computed, or starts being computed off the wrong list. */
describe("usable", () => {
  const ok = (name: string) => ({
    name,
    calories: 200,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    confidence: 0.7,
  });

  it("reports zero when everything came back usable", () => {
    expect(usable([ok("Rice"), ok("Chicken")])).toEqual({
      items: [expect.objectContaining({ name: "Rice" }), expect.objectContaining({ name: "Chicken" })],
      dropped: 0,
    });
  });

  it("keeps the survivors of a read that lost one food", () => {
    const read = usable([ok("Rice"), { ...ok("White rice"), calories: 6450, carbs_g: 1400 }, ok("Chicken")]);
    expect(read.items.map((i) => i.name)).toEqual(["Rice", "Chicken"]);
  });

  it("counts the food it lost", () => {
    const read = usable([ok("Rice"), { ...ok("White rice"), calories: 6450, carbs_g: 1400 }, ok("Chicken")]);
    expect(read.dropped).toBe(1);
  });

  it("counts every unusable item, not only the out-of-range ones", () => {
    // A nameless item has been dropped silently since #9 and is the same
    // experience from the user's side: a food came back that we cannot show.
    expect(usable([ok("Rice"), { ...ok(""), name: "" }, "junk"]).dropped).toBe(2);
  });

  it("reports an all-dropped read as zero items and the full count", () => {
    expect(usable([{ ...ok("White rice"), carbs_g: 1000.1 }])).toEqual({ items: [], dropped: 1 });
  });

  it("survives a model that did not return an array at all", () => {
    expect(usable(undefined)).toEqual({ items: [], dropped: 0 });
    expect(usable({ items: [] })).toEqual({ items: [], dropped: 0 });
  });
});

/** #59's prompt fold. Two bounds and one preservation, and the preservation is
 *  the one that matters most: the first read is the app's most-used path and
 *  this issue is about the *second* one, so the shipped prompt is a thing to
 *  leave exactly alone.
 *
 *  The bounds are here rather than only in the route test because a bound
 *  reachable only by driving a route that calls a paid API is a bound nobody
 *  will exercise. `analyze.route.test.ts` drives the same two facts through
 *  real workerd and reads them off the wire — that one proves the route calls
 *  this, these prove it is right. */
describe("photoTurn", () => {
  it("is byte-identical to the shipped first-read sentence when there is nothing to add", () => {
    expect(photoTurn({ note: "", previous: [] })).toBe("Log what is in this photo.");
  });

  it("is byte-identical to the shipped note sentence when only a note is given", () => {
    expect(photoTurn({ note: "wife's plate", previous: [] })).toBe(
      "Log what is in this photo. The person added a note: wife's plate",
    );
  });

  it("trims a note to 300 characters", () => {
    const turn = photoTurn({ note: "x".repeat(500), previous: [] });
    expect(turn).toBe(`Log what is in this photo. The person added a note: ${"x".repeat(300)}`);
  });

  it("trims a note on the re-read path too", () => {
    const turn = photoTurn({ note: "x".repeat(500), previous: ["Toastie"] });
    expect(turn).toContain(`wrong: ${"x".repeat(300)}\n`);
  });

  it("tells the model what it previously said, so the correction has an antecedent", () => {
    expect(photoTurn({ note: "no ham", previous: ["Ham and cheese toastie", "Side salad"] })).toContain(
      "answered: Ham and cheese toastie; Side salad.",
    );
  });

  it("caps the previous answer at twenty foods", () => {
    const names = Array.from({ length: 40 }, (_, i) => `Food ${i}`);
    const turn = photoTurn({ note: "no ham", previous: names });
    expect(turn).toContain("answered: Food 0; Food 1;");
    // and the twenty-first is absent — asserted separately below, because an
    // assertion after a failed one never runs and reports nothing.
  });

  it("drops the twenty-first food rather than growing the prompt", () => {
    const names = Array.from({ length: 40 }, (_, i) => `Food ${i}`);
    expect(photoTurn({ note: "no ham", previous: names })).not.toContain("Food 20");
  });

  it("truncates one absurd name rather than storing an essay in the prompt", () => {
    const turn = photoTurn({ note: "no ham", previous: ["x".repeat(500)] });
    expect(turn).toContain(`answered: ${"x".repeat(120)}.`);
  });

  it("drops #16's blank row rather than telling the model it answered nothing", () => {
    // A failed read's capture holds one empty item. Sending it would make the
    // re-read a correction of a claim nobody made; dropping it makes the same
    // request a FIRST read with a note on it, which is what it is.
    expect(photoTurn({ note: "two slices of pizza", previous: [""] })).toBe(
      "Log what is in this photo. The person added a note: two slices of pizza",
    );
  });

  it("still names the previous answer when the note is empty", () => {
    // No client sends this — the button is disabled on an empty note — but a
    // re-read with no note is still a re-read, and the prompt must not silently
    // become a fresh first read of the same photo.
    expect(photoTurn({ note: "   ", previous: ["Toastie"] })).toContain(
      "The person says that answer was wrong.",
    );
  });
});
