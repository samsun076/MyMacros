import { describe, expect, it } from "vitest";
import { newPhotoKey, ownedPhotoKey } from "./photos";

/** These are not string-formatting tests. `ownedPhotoKey` IS the authorization
 *  check for meal photos — there is no `food_logs` row to fall back on,
 *  because the confirm sheet shows a photo before any row exists. If this
 *  function says yes to a key it shouldn't, one user reads another's photos
 *  and nothing else in the stack objects. */
describe("ownedPhotoKey", () => {
  const ALICE = "alice-user-id";
  const BOB = "bob-user-id";

  it("accepts a key it just minted for the same user", () => {
    const key = newPhotoKey(ALICE);
    expect(ownedPhotoKey(key, ALICE)).toBe(key);
  });

  it("mints `<userId>/<uuid>.jpg`", () => {
    expect(newPhotoKey(ALICE)).toMatch(
      /^alice-user-id\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
    );
  });

  it("gives every photo its own key", () => {
    expect(newPhotoKey(ALICE)).not.toBe(newPhotoKey(ALICE));
  });

  // the whole point: a well-formed key belonging to someone else
  it("refuses another user's key", () => {
    expect(ownedPhotoKey(newPhotoKey(BOB), ALICE)).toBeUndefined();
  });

  it("refuses a victim's prefix smuggled behind the caller's own", () => {
    const victim = newPhotoKey(BOB);
    expect(ownedPhotoKey(`${ALICE}/../${victim}`, ALICE)).toBeUndefined();
    expect(ownedPhotoKey(`${ALICE}/${victim}`, ALICE)).toBeUndefined();
  });

  it("refuses traversal out of the prefix", () => {
    const uuid = "00000000-0000-4000-8000-000000000000";
    expect(ownedPhotoKey(`../${uuid}.jpg`, ALICE)).toBeUndefined();
    expect(ownedPhotoKey(`${ALICE}/../${uuid}.jpg`, ALICE)).toBeUndefined();
  });

  it("refuses a name that isn't a uuid.jpg", () => {
    expect(ownedPhotoKey(`${ALICE}/secrets.jpg`, ALICE)).toBeUndefined();
    expect(ownedPhotoKey(`${ALICE}/00000000-0000-4000-8000-000000000000.png`, ALICE))
      .toBeUndefined();
    // uppercase hex is not what randomUUID emits, so it isn't a key we made
    expect(ownedPhotoKey(`${ALICE}/00000000-0000-4000-8000-00000000000A.jpg`, ALICE))
      .toBeUndefined();
  });

  it("refuses a bare prefix with no object", () => {
    expect(ownedPhotoKey(`${ALICE}/`, ALICE)).toBeUndefined();
    expect(ownedPhotoKey(ALICE, ALICE)).toBeUndefined();
  });

  it("refuses anything that isn't a string", () => {
    for (const v of [undefined, null, 42, {}, [], true]) {
      expect(ownedPhotoKey(v, ALICE)).toBeUndefined();
    }
  });

  it("refuses an empty owner", () => {
    const uuid = "00000000-0000-4000-8000-000000000000";
    expect(ownedPhotoKey(`/${uuid}.jpg`, "")).toBeUndefined();
  });
});
