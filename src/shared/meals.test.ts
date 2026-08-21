import { describe, expect, it } from "vitest";
import { FAVORITE_NAME_MAX, favoriteName, foldMeals, mealNameKey, type MealRow } from "./meals";

/** The fold used to exist twice — once on the Today timeline, once in
 *  GET /api/food-logs/recent — with the same key and the same name-joining
 *  written out separately on each side (#86). Nothing made them agree, and a
 *  drift wouldn't crash: it would make two screens quietly disagree about what
 *  counts as one meal. These pin the behaviour both sides now share. */
const row = (over: Partial<MealRow> = {}): MealRow => ({
  logged_at: "2026-08-10T12:38:00.000Z",
  meal_slot: "lunch",
  name: "Grilled chicken breast",
  kcal: 280,
  protein_g: 52,
  carbs_g: 0,
  fat_g: 6,
  ...over,
});

describe("foldMeals", () => {
  /** The sketch's combined breakfast row, and the reason there is no meal_id
   *  column: one save stamps one instant across every item it wrote. */
  it("folds rows sharing an instant into one meal and sums them", () => {
    const [meal, ...rest] = foldMeals([
      row({ name: "Greek yogurt", kcal: 140, protein_g: 17, carbs_g: 8, fat_g: 4 }),
      row({ name: "Blueberries", kcal: 60, protein_g: 1, carbs_g: 15, fat_g: 0 }),
      row({ name: "Granola", kcal: 190, protein_g: 4, carbs_g: 28, fat_g: 7 }),
    ]);

    expect(rest).toHaveLength(0);
    expect(meal?.name).toBe("Greek yogurt, blueberries, granola");
    expect(meal).toMatchObject({ kcal: 390, protein_g: 22, carbs_g: 51, fat_g: 11 });
    expect(meal?.rows).toHaveLength(3);
  });

  it("keeps separate saves separate, in the order they arrived", () => {
    const meals = foldMeals([
      row({ logged_at: "2026-08-10T08:02:00.000Z", meal_slot: "breakfast", name: "Oats" }),
      row({ logged_at: "2026-08-10T12:38:00.000Z", name: "Chicken" }),
      row({ logged_at: "2026-08-10T08:02:00.000Z", meal_slot: "breakfast", name: "Whey" }),
    ]);

    expect(meals.map((m) => m.name)).toEqual(["Oats, whey", "Chicken"]);
  });

  /** The slot is in the key because it is the one thing a user changes per
   *  save, and two saves can land in the same millisecond. */
  it("does not merge two slots that share an instant", () => {
    const meals = foldMeals([row({ meal_slot: "lunch" }), row({ meal_slot: "snack" })]);
    expect(meals).toHaveLength(2);
  });

  /** Rounding belongs to the caller — the timeline draws whole grams, the
   *  recents list draws tenths. Summing exactly is what lets both be right. */
  it("sums grams without rounding", () => {
    const [meal] = foldMeals([row({ protein_g: 17.4 }), row({ protein_g: 4.3 })]);
    expect(meal?.protein_g).toBeCloseTo(21.7, 10);
  });

  it("has nothing to say about an empty day", () => {
    expect(foldMeals([])).toEqual([]);
  });
});

/** The name rule `POST /api/favorites` stores by and the confirm sheet's star
 *  matches by (#103). It is one function precisely so those two cannot drift;
 *  the route's own agreement with it is pinned in favorites.route.test.ts,
 *  which is the half a unit test cannot reach. */
describe("favoriteName", () => {
  it("leaves an ordinary meal name alone", () => {
    expect(favoriteName("Greek yoghurt, blueberries, granola")).toBe(
      "Greek yoghurt, blueberries, granola",
    );
  });

  it("trims the ends, so a typed name and its padded twin are one favourite", () => {
    expect(favoriteName("  Chicken bowl \n")).toBe("Chicken bowl");
  });

  it("caps a fold that ran long at the ceiling", () => {
    expect(favoriteName("x".repeat(400))).toHaveLength(FAVORITE_NAME_MAX);
  });

  /** Trim before cap, not after: 130 characters of padding around a short name
   *  is a short name, and capping first would store 120 spaces. */
  it("trims before it caps", () => {
    expect(favoriteName(`${" ".repeat(200)}Oats${" ".repeat(200)}`)).toBe("Oats");
  });

  it("states the ceiling as 120", () => {
    expect(FAVORITE_NAME_MAX).toBe(120);
  });
});

/** #117 gave the route the same "already listed" rule the panel has had since
 *  #12, so the rule stopped being one function's private business and became a
 *  thing two sides of the wire have to agree on. These pin what it is — and,
 *  more usefully, what it is *not*: it is not `favoriteName`, which answers the
 *  store's question ("would starring this write a second row?") and is exact
 *  for that reason. */
describe("mealNameKey", () => {
  it("folds case, so a star under one spelling hides the meal under another", () => {
    expect(mealNameKey("Pad Thai")).toBe(mealNameKey("PAD THAI"));
  });

  /** Deliberately not `favoriteName`'s trim. A display dedupe that quietly
   *  normalised more than case would be a second, laxer definition of "the same
   *  meal" than the one the store uses — and #117 was a fix for the *order* of
   *  a cap and a filter, not licence to change what the filter matches. */
  it("leaves whitespace alone", () => {
    expect(mealNameKey(" Pad Thai ")).toBe(" pad thai ");
  });
});
