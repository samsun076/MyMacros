import { describe, expect, it } from "vitest";
import { STALE_AFTER_HOURS, feedStale } from "./sync";

const NOW = new Date("2026-08-09T14:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("feedStale", () => {
  it("trusts a feed that checked in recently", () => {
    expect(feedStale(hoursAgo(0.5), NOW)).toBe(false);
  });

  /** The reason this isn't 6 hours: a laptop shut overnight syncs nothing
   *  until it wakes, and the app gets opened on a phone at breakfast. */
  it("survives a night with the laptop shut", () => {
    expect(feedStale(hoursAgo(11), NOW)).toBe(false);
  });

  it("gives up after the threshold", () => {
    expect(feedStale(hoursAgo(STALE_AFTER_HOURS + 1), NOW)).toBe(true);
  });

  it("doesn't fire exactly on the boundary", () => {
    expect(feedStale(hoursAgo(STALE_AFTER_HOURS), NOW)).toBe(false);
  });

  /** A feed that was never set up isn't broken. Reporting stale here would
   *  invent a problem out of an absence, on every fresh install. */
  it("says nothing about a feed that has never checked in", () => {
    expect(feedStale(null, NOW)).toBe(false);
    expect(feedStale(undefined, NOW)).toBe(false);
  });

  /** Guessing "stale" would put a warning on screen that no amount of syncing
   *  could ever clear. */
  it("declines to judge a timestamp it can't parse", () => {
    expect(feedStale("not a date", NOW)).toBe(false);
  });
});
