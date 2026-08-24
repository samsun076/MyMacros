import { describe, expect, it } from "vitest";
import { localeDefaults } from "./locale";

describe("localeDefaults", () => {
  it("takes the edge's timezone and infers units from its country", () => {
    expect(localeDefaults({ timezone: "Europe/Berlin", country: "DE" })).toEqual({
      timezone: "Europe/Berlin",
      units: "metric",
    });
    expect(localeDefaults({ timezone: "America/New_York", country: "US" })).toEqual({
      timezone: "America/New_York",
      units: "imperial",
    });
  });

  it("knows the three countries that are not metric", () => {
    for (const country of ["US", "LR", "MM", "us", "mm"]) {
      expect(localeDefaults({ country }).units).toBe("imperial");
    }
    for (const country of ["GB", "DE", "JP", "AU", "CA"]) {
      expect(localeDefaults({ country }).units).toBe("metric");
    }
  });

  it("says nothing when the edge said nothing", () => {
    // Local dev is this case — miniflare supplies no cf — and an empty object
    // is what lets the column defaults stand instead of asserting metric about
    // somebody the edge could not place.
    for (const cf of [undefined, null, {}, { timezone: undefined, country: undefined }]) {
      expect(localeDefaults(cf)).toEqual({});
    }
  });

  it("treats Cloudflare's unknown-country codes as no answer", () => {
    // T1 is Tor, XX is unknown. Both are strings and both would pass a naive
    // truthiness test straight into "metric".
    for (const country of ["XX", "T1", "xx", "t1", "USA", "U", ""]) {
      expect(localeDefaults({ country }).units).toBeUndefined();
    }
  });

  it("refuses a timezone that is not a real zone", () => {
    // This column is not editable anywhere in the app, so a junk value would
    // misfile every date the account ever writes with no way to correct it.
    for (const timezone of ["", "   ", "Mars/Olympus", "New York", "'; drop table", 42, null]) {
      expect(localeDefaults({ timezone }).timezone).toBeUndefined();
    }
  });

  it("accepts the zones that are real but unusual", () => {
    for (const timezone of ["UTC", "America/Argentina/Buenos_Aires", "Etc/GMT+5", "Asia/Ho_Chi_Minh"]) {
      expect(localeDefaults({ timezone }).timezone).toBe(timezone);
    }
  });

  it("trims, because a stray space would fail Intl and lose a real zone", () => {
    expect(localeDefaults({ timezone: " Europe/Warsaw " }).timezone).toBe("Europe/Warsaw");
  });

  it("answers each field independently", () => {
    // A country with no timezone, or a timezone with no country, must still
    // contribute what it knows rather than being all-or-nothing.
    expect(localeDefaults({ country: "DE" })).toEqual({ units: "metric" });
    expect(localeDefaults({ timezone: "Europe/Berlin" })).toEqual({ timezone: "Europe/Berlin" });
  });
});
