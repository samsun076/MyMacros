import { describe, expect, it } from "vitest";
import type { Favorite, RecentMeal } from "../../shared/api";
import { FAVORITE_NAME_MAX } from "../../shared/meals";
import { favoriteDraft, favoriteNamed, mergePicks, relogItem } from "./picks";

/** #82's half of the fix. The merge was an untested `useMemo` inside Log.tsx
 *  and is now the single source both placements read — TEXT's inline list and
 *  the camera deck's panel — so the properties it has to hold are written down
 *  here rather than implied by one screen looking right.
 *
 *  No table loops on purpose: an assertion inside a loop whose earlier
 *  iteration threw reports nothing at all, and CLAUDE.md counts three cases in
 *  three days where that hid most of a check. Every case below stands alone. */

function fav(name: string, over: Partial<Favorite> = {}): Favorite {
  return {
    id: `fav-${name}`,
    user_id: "u1",
    name,
    kcal: 300,
    protein_g: 20,
    carbs_g: 30,
    fat_g: 10,
    photo_key: null,
    use_count: 1,
    last_used_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function recent(name: string): RecentMeal {
  return { name, kcal: 250, protein_g: 15, carbs_g: 25, fat_g: 8 };
}

describe("mergePicks", () => {
  it("puts favourites ahead of recents", () => {
    const picks = mergePicks([fav("Skyr bowl")], [recent("Pad thai")]);
    expect(picks.map((p) => p.meal.name)).toEqual(["Skyr bowl", "Pad thai"]);
  });

  // The star's own state, and what `relog` sends as `favorite_id`. Separate
  // from the ordering test because a mutant that drops the favourite handle
  // leaves the order intact, and vice versa — one test would report whichever
  // assertion happened to be written first.
  it("carries the favourite handle on a starred pick and null on a recent", () => {
    const picks = mergePicks([fav("Skyr bowl")], [recent("Pad thai")]);
    expect(picks.map((p) => p.favorite?.id ?? null)).toEqual(["fav-Skyr bowl", null]);
  });

  // The route sorts by use_count and this must not re-sort it: a client that
  // reorders is a second opinion about most-used, which is the one thing
  // favorites_user_use_idx exists to answer.
  it("preserves the order the favorites route gave, most-used first", () => {
    const picks = mergePicks(
      [
        fav("Chicken bowl", { use_count: 9 }),
        fav("Overnight oats", { use_count: 4 }),
        fav("Protein shake", { use_count: 1 }),
      ],
      [],
    );
    expect(picks.map((p) => p.meal.name)).toEqual([
      "Chicken bowl",
      "Overnight oats",
      "Protein shake",
    ]);
  });

  it("preserves the order the recents route gave, newest first", () => {
    const picks = mergePicks([], [recent("Third"), recent("Second"), recent("First")]);
    expect(picks.map((p) => p.meal.name)).toEqual(["Third", "Second", "First"]);
  });

  it("drops a recent that is already starred", () => {
    const picks = mergePicks([fav("Pad thai")], [recent("Pad thai"), recent("Katsu curry")]);
    expect(picks.map((p) => p.meal.name)).toEqual(["Pad thai", "Katsu curry"]);
  });

  // Three cases, three tests, on purpose. Written as one test with three
  // `expect`s it reported *one* of them under a broken source and stayed
  // silent about the other two — the exact shape CLAUDE.md counts three
  // instances of. Measured here, not assumed: the first break of this file
  // left the upper-star and mixed-case cases neither green nor red.
  it("matches case-insensitively when the star is lower and the recent upper", () => {
    const picks = mergePicks([fav("pad thai")], [recent("PAD THAI")]);
    expect(picks.map((p) => p.meal.name)).toEqual(["pad thai"]);
  });

  it("matches case-insensitively when the star is upper and the recent lower", () => {
    const picks = mergePicks([fav("PAD THAI")], [recent("pad thai")]);
    expect(picks.map((p) => p.meal.name)).toEqual(["PAD THAI"]);
  });

  it("matches case-insensitively on mixed case", () => {
    const picks = mergePicks([fav("Greek Yoghurt")], [recent("greek yoghurt")]);
    expect(picks.map((p) => p.meal.name)).toEqual(["Greek Yoghurt"]);
  });

  /* ── #115: nothing is dropped ──────────────────────────────────────────
   *
   *  These replace four tests that pinned `PICKS_MAX = 8` — and they are
   *  written as the exact inverse of them, because the old ones were correct
   *  about the code and wrong about the product: production held ten
   *  favourites and two of them rendered nowhere. Each names the number the
   *  old cap would have produced, so a re-introduced `.slice(0, 8)` fails on
   *  the *contents* rather than only on a length. */

  /** **The issue's own "done when", and the one to keep.** Twelve is well
   *  clear of the boundary that shipped, and every name is asserted rather
   *  than a count, so a slice at any position fails here. */
  it("keeps every favourite when there are more than the old cap held", () => {
    const favs = Array.from({ length: 12 }, (_, i) => fav(`f${i + 1}`));
    expect(mergePicks(favs, []).map((p) => p.meal.name)).toEqual([
      "f1",
      "f2",
      "f3",
      "f4",
      "f5",
      "f6",
      "f7",
      "f8",
      "f9",
      "f10",
      "f11",
      "f12",
    ]);
  });

  /** The favourite handle has to survive too: a starred row that lost it would
   *  render an empty star and re-log without bumping `use_count`. Separate
   *  from the names above for the reason the ordering pair is separate — a
   *  mutant that drops the handle leaves the names intact. */
  it("keeps the twelfth favourite's own handle, not just its name", () => {
    const favs = Array.from({ length: 12 }, (_, i) => fav(`f${i + 1}`));
    expect(mergePicks(favs, []).at(-1)?.favorite?.id).toBe("fav-f12");
  });

  /** **The recents' reserved slots.** Eight favourites used to consume the
   *  whole list, so the panel's recents half disappeared for anyone past that
   *  — silently, since a shorter list looks like a shorter history. */
  it("still shows the recents when favourites alone would have filled the old cap", () => {
    const favs = Array.from({ length: 8 }, (_, i) => fav(`f${i + 1}`));
    expect(
      mergePicks(favs, [recent("r1"), recent("r2"), recent("r3")])
        .filter((p) => p.favorite === null)
        .map((p) => p.meal.name),
    ).toEqual(["r1", "r2", "r3"]);
  });

  /** And the join is still a join: favourites first, recents after, with no
   *  boundary anywhere in between. Ten rows where the old cap gave eight. */
  it("returns favourites and recents whole, in that order", () => {
    const favs = [fav("f1"), fav("f2"), fav("f3"), fav("f4"), fav("f5")];
    const recents = [recent("r1"), recent("r2"), recent("r3"), recent("r4"), recent("r5")];
    expect(mergePicks(favs, recents).map((p) => p.meal.name)).toEqual([
      "f1",
      "f2",
      "f3",
      "f4",
      "f5",
      "r1",
      "r2",
      "r3",
      "r4",
      "r5",
    ]);
  });

  /** The recents' bound belongs to `GET /api/food-logs/recent`, which stops at
   *  eight distinct meals — see `food-logs.route.test.ts`, which pins it. This
   *  is the client half of that single source: hand it more than the route
   *  would ever send and it still hands all of them back, so nothing here can
   *  quietly become a second cap. */
  it("does not cap the recents either — the route owns that length", () => {
    const recents = Array.from({ length: 12 }, (_, i) => recent(`r${i + 1}`));
    expect(mergePicks([], recents).map((p) => p.meal.name)).toEqual(
      Array.from({ length: 12 }, (_, i) => `r${i + 1}`),
    );
  });

  // Both callers pass `data?.favorites` off an in-flight useApi, so undefined
  // is the *normal* first render, not an edge case.
  it("treats missing inputs as nothing to show", () => {
    expect(mergePicks(undefined, undefined)).toEqual([]);
  });

  it("treats null inputs as nothing to show", () => {
    expect(mergePicks(null, null)).toEqual([]);
  });

  it("treats empty inputs as nothing to show", () => {
    expect(mergePicks([], [])).toEqual([]);
  });

  it("renders recents when only the recents feed has landed", () => {
    expect(mergePicks(undefined, [recent("Pad thai")]).map((p) => p.meal.name)).toEqual([
      "Pad thai",
    ]);
  });

  it("renders favourites when only the favorites feed has landed", () => {
    expect(mergePicks([fav("Pad thai")], undefined).map((p) => p.meal.name)).toEqual(["Pad thai"]);
  });

  it("does not mutate the favourites it was given", () => {
    const favs = [fav("Pad thai")];
    mergePicks(favs, [recent("Pad thai"), recent("Katsu curry")]);
    expect(favs.map((f) => f.name)).toEqual(["Pad thai"]);
  });

  it("does not mutate the recents it was given", () => {
    const recents = [recent("Pad thai"), recent("Katsu curry")];
    mergePicks([fav("Pad thai")], recents);
    expect(recents.map((m) => m.name)).toEqual(["Pad thai", "Katsu curry"]);
  });
});

/** #103's half. The confirm sheet's star has to turn N read items into the one
 *  meal `favorites` stores, and the collapse it uses must be `foldMeals` — not
 *  a second join written for the sheet, which is exactly the two-things-that-
 *  should-be-one-thing the register is about. These pin the fold's own
 *  behaviour showing through (the ", ", the lowercased tail) as well as the two
 *  things the adapter adds: unnamed rows dropped, and the name handed back in
 *  the form the store will hold it in. */
const draftItem = (name: string, over: Partial<Record<"calories" | "protein_g" | "carbs_g" | "fat_g", number>> = {}) => ({
  name,
  calories: 100,
  protein_g: 10,
  carbs_g: 5,
  fat_g: 2,
  ...over,
});

describe("favoriteDraft", () => {
  /** The fold's signature: the first item keeps its case, the rest are
   *  lowercased, joined with ", ". This is the assertion that fails if anyone
   *  writes a second join on the client. */
  it("names a multi-item read the way foldMeals names it", () => {
    const draft = favoriteDraft([
      draftItem("Grilled chicken breast"),
      draftItem("Jasmine rice"),
      draftItem("Steamed broccoli"),
    ]);
    expect(draft?.name).toBe("Grilled chicken breast, jasmine rice, steamed broccoli");
  });

  it("sums the calories of every named row into one kcal figure", () => {
    const draft = favoriteDraft([
      draftItem("Grilled chicken breast", { calories: 280 }),
      draftItem("Jasmine rice", { calories: 210 }),
      draftItem("Steamed broccoli", { calories: 55 }),
    ]);
    expect(draft?.kcal).toBe(545);
  });

  it("sums the three macros", () => {
    const draft = favoriteDraft([
      draftItem("Grilled chicken breast", { protein_g: 52, carbs_g: 0, fat_g: 6 }),
      draftItem("Jasmine rice", { protein_g: 4, carbs_g: 45, fat_g: 0 }),
    ]);
    expect(draft).toMatchObject({ protein_g: 56, carbs_g: 45, fat_g: 6 });
  });

  /** Rounding is `POST /api/favorites`' job, the way it is the recents route's
   *  — a second rounding rule here is a second rounding rule. `toBe` on the
   *  exact float rather than `toBeCloseTo`, because `toBeCloseTo` passes
   *  against a client that rounded and so would prove nothing. */
  it("hands the sums over unrounded", () => {
    const draft = favoriteDraft([
      draftItem("Greek yogurt", { protein_g: 17.4 }),
      draftItem("Granola", { protein_g: 4.3 }),
    ]);
    expect(draft?.protein_g).toBe(17.4 + 4.3);
  });

  /** A barcode read is one item, and its name is the product's — the case that
   *  actually motivated the issue (a Barebells bar). Nothing about the fold
   *  should touch it. */
  it("leaves a single-item read's name exactly as it was read", () => {
    expect(favoriteDraft([draftItem("Barebells PROTEIN BAR Peanut Butter & Jelly")])?.name).toBe(
      "Barebells PROTEIN BAR Peanut Butter & Jelly",
    );
  });

  /** #16: the recovery sheet opens on a blank row, and the save button lets a
   *  meal through as long as ONE row is named. Fold the blank one in and the
   *  favourite is called "Chicken, ". */
  it("drops an unnamed row instead of folding it into the name", () => {
    expect(favoriteDraft([draftItem("Chicken"), draftItem("")])?.name).toBe("Chicken");
  });

  it("drops an unnamed row from the totals too", () => {
    expect(favoriteDraft([draftItem("Chicken", { calories: 300 }), draftItem("", { calories: 99 })])?.kcal).toBe(300);
  });

  it("has nothing to star when the only row is blank", () => {
    expect(favoriteDraft([draftItem("")])).toBeNull();
  });

  it("has nothing to star when a row holds only whitespace", () => {
    expect(favoriteDraft([draftItem("   ")])).toBeNull();
  });

  it("has nothing to star when there are no rows at all", () => {
    expect(favoriteDraft([])).toBeNull();
  });

  /** Per row, before the join — so the fold's ", " separators are the only
   *  spaces in the result and the stored name cannot depend on where the user
   *  happened to leave a space. */
  it("trims each row's name before joining them", () => {
    expect(favoriteDraft([draftItem("  Chicken  "), draftItem("  Rice  ")])?.name).toBe(
      "Chicken, rice",
    );
  });

  /** The one that matters for the star: the name comes back already in the
   *  form `POST /api/favorites` will store, so "already starred?" is a string
   *  comparison and not a guess. */
  it("caps a very long fold at the stored ceiling", () => {
    const items = Array.from({ length: 12 }, (_, i) => draftItem(`Ingredient number ${i + 1}`));
    expect(favoriteDraft(items)?.name).toHaveLength(FAVORITE_NAME_MAX);
  });

  it("still sums every row of a fold that was too long to name in full", () => {
    const items = Array.from({ length: 12 }, (_, i) => draftItem(`Ingredient number ${i + 1}`, { calories: 10 }));
    expect(favoriteDraft(items)?.kcal).toBe(120);
  });
});

describe("favoriteNamed", () => {
  it("finds the favourite a star of this meal would land on", () => {
    expect(favoriteNamed([fav("Pad thai"), fav("Skyr bowl")], "Skyr bowl")?.id).toBe("fav-Skyr bowl");
  });

  /** The route matches `where("name", "=", name)` against a column with no
   *  COLLATE NOCASE, so a differently-cased name is a *different* favourite.
   *  Drawing a filled star here would promise idempotency the route wouldn't
   *  honour — the tap would write a second row. Deliberately NOT mergePicks'
   *  rule, which is a display dedupe and lenient on purpose. */
  it("does not claim a differently-cased favourite as this meal's", () => {
    expect(favoriteNamed([fav("Pad thai")], "pad thai")).toBeNull();
  });

  /** The truncation case, from the client's side: a fold that ran past the
   *  ceiling was stored short, and the sheet still has the long one in hand. */
  it("finds a favourite the store had to truncate", () => {
    const long = "y".repeat(FAVORITE_NAME_MAX + 40);
    expect(favoriteNamed([fav("y".repeat(FAVORITE_NAME_MAX))], long)?.name).toHaveLength(
      FAVORITE_NAME_MAX,
    );
  });

  it("matches a name whose only difference is padding", () => {
    expect(favoriteNamed([fav("Oats")], "  Oats  ")?.id).toBe("fav-Oats");
  });

  it("says nothing is starred while /api/favorites is still in flight", () => {
    expect(favoriteNamed(undefined, "Skyr bowl")).toBeNull();
  });

  it("says nothing is starred when the list holds no such meal", () => {
    expect(favoriteNamed([fav("Pad thai")], "Skyr bowl")).toBeNull();
  });

  it("says nothing is starred for a meal with no name yet", () => {
    expect(favoriteNamed([fav("Pad thai")], "   ")).toBeNull();
  });
});

/* ── #118: the one-tap re-log's save item ────────────────────────────────────
 *
 * The regression these exist for: `mergePicks` puts the whole `Favorite` row in
 * as a pick's `meal`, `relog` spread it into the save item, and #81 had just
 * made `photo_key` a *statement* — so every starred meal 400'd on the app's
 * most-used shortcut. Found by a thumb, an hour after deploy, by nothing in
 * this suite.
 *
 * The assertion that matters is the NEGATIVE one. "It sends the right five
 * fields" was already true of the broken code — it sent those five and six
 * more. Only "it sends nothing else" separates the two implementations, which
 * is why the key-set test is first and the rest are regression guards. */
describe("relogItem (#118)", () => {
  const fav: Favorite = {
    id: "fav-1",
    user_id: "u-1",
    name: "Barebells CHOCOLATE DOUGH",
    kcal: 200,
    protein_g: 20,
    carbs_g: 21,
    fat_g: 6,
    photo_key: null,
    use_count: 3,
    last_used_at: "2026-08-21T00:00:00.000Z",
    created_at: "2026-08-20T00:00:00.000Z",
  };

  it("sends NOTHING but the seven fields a save item has", () => {
    expect(Object.keys(relogItem({ meal: fav, favorite: fav })).sort()).toEqual([
      "carbs_g",
      "confidence",
      "edited",
      "fat_g",
      "kcal",
      "name",
      "protein_g",
    ]);
  });

  it("never states photo_key, which is what #81 made load-bearing", () => {
    expect("photo_key" in relogItem({ meal: fav, favorite: fav })).toBe(false);
  });

  it("never leaks the favourite's own row id", () => {
    expect("id" in relogItem({ meal: fav, favorite: fav })).toBe(false);
  });

  it("carries the macros across unchanged", () => {
    expect(relogItem({ meal: fav, favorite: fav })).toMatchObject({
      name: "Barebells CHOCOLATE DOUGH",
      kcal: 200,
      protein_g: 20,
      carbs_g: 21,
      fat_g: 6,
    });
  });

  it("records that nothing read it", () => {
    expect(relogItem({ meal: fav, favorite: fav }).confidence).toBeNull();
  });

  it("is not an override of anything", () => {
    expect(relogItem({ meal: fav, favorite: fav }).edited).toBe(false);
  });

  it("works the same for an UNSTARRED pick, whose meal is already narrow", () => {
    const recent = { name: "Oats", kcal: 300, protein_g: 10, carbs_g: 50, fat_g: 5 };
    expect(relogItem({ meal: recent, favorite: null })).toEqual({
      name: "Oats",
      kcal: 300,
      protein_g: 10,
      carbs_g: 50,
      fat_g: 5,
      confidence: null,
      edited: false,
    });
  });
});
