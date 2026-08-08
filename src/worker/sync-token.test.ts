import { describe, expect, it } from "vitest";
import { bearerFrom, hashSyncToken, newSyncToken } from "./sync-token";

describe("newSyncToken", () => {
  it("is prefixed so a leaked one is identifiable on sight", () => {
    expect(newSyncToken()).toMatch(/^mms_/);
  });

  it("is url- and shell-safe — it gets pasted into plists and curl commands", () => {
    for (let i = 0; i < 50; i++) expect(newSyncToken()).toMatch(/^mms_[A-Za-z0-9_-]+$/);
  });

  it("carries 256 bits of entropy", () => {
    // 32 bytes base64url with padding stripped = 43 chars
    expect(newSyncToken().slice(4)).toHaveLength(43);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => newSyncToken()));
    expect(seen.size).toBe(500);
  });
});

describe("hashSyncToken", () => {
  it("is stable lowercase hex sha-256", async () => {
    const hash = await hashSyncToken("mms_example");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashSyncToken("mms_example")).toBe(hash);
  });

  it("is a known-answer match for SHA-256", async () => {
    // the canonical digest of "abc"
    expect(await hashSyncToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("scrambles completely on a one-character change, so no prefix survives", async () => {
    const a = await hashSyncToken("mms_aaaaaaaa");
    const b = await hashSyncToken("mms_aaaaaaab");
    expect(a).not.toBe(b);
    // shared leading hex characters should be ~0; anything long would mean a
    // near-miss leaks how close it was
    let shared = 0;
    while (a[shared] === b[shared]) shared++;
    expect(shared).toBeLessThan(8);
  });
});

describe("bearerFrom", () => {
  it("reads the token out of the header", () => {
    expect(bearerFrom("Bearer mms_abc")).toBe("mms_abc");
  });

  it("accepts any casing of the scheme, per RFC 7235", () => {
    expect(bearerFrom("bearer mms_abc")).toBe("mms_abc");
    expect(bearerFrom("BEARER mms_abc")).toBe("mms_abc");
  });

  it("tolerates surrounding and extra internal whitespace", () => {
    expect(bearerFrom("  Bearer   mms_abc  ")).toBe("mms_abc");
  });

  it("refuses anything that isn't a bearer credential", () => {
    for (const h of [null, undefined, "", "mms_abc", "Basic abc", "Bearer", "Bearer  ", "Bearer a b"]) {
      expect(bearerFrom(h)).toBeNull();
    }
  });
});
