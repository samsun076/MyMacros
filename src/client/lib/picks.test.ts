import { describe, expect, it } from "vitest";
import type { Favorite, RecentMeal } from "../../shared/api";
import { PICKS_MAX, mergePicks } from "./picks";

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

  it("caps the list at 8, counting favourites and recents together", () => {
    const favs = [fav("f1"), fav("f2"), fav("f3"), fav("f4"), fav("f5")];
    const recents = [recent("r1"), recent("r2"), recent("r3"), recent("r4"), recent("r5")];
    // one assertion: the names carry the length, so a mutant that drops the
    // cap can't fail a `toHaveLength` and leave the ordering unreported
    expect(mergePicks(favs, recents).map((p) => p.meal.name)).toEqual([
      "f1",
      "f2",
      "f3",
      "f4",
      "f5",
      "r1",
      "r2",
      "r3",
    ]);
  });

  it("states the cap as 8", () => {
    expect(PICKS_MAX).toBe(8);
  });

  it("caps favourites alone when there are more than 8 of them", () => {
    const favs = Array.from({ length: 12 }, (_, i) => fav(`f${i + 1}`));
    const picks = mergePicks(favs, [recent("r1")]);
    expect(picks.map((p) => p.meal.name)).toEqual(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"]);
  });

  it("keeps every capped pick a favourite when favourites overflow", () => {
    const favs = Array.from({ length: 12 }, (_, i) => fav(`f${i + 1}`));
    expect(mergePicks(favs, [recent("r1")]).map((p) => p.favorite !== null)).toEqual(
      Array(8).fill(true),
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
