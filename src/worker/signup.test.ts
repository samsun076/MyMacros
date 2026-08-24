import { describe, expect, it } from "vitest";
import { decideSignup, emailAllowed, normalizeEmail, SIGNUP_REFUSAL_MESSAGE } from "./signup";

const LIST = "dave@example.com, Wife@Example.com";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Dave@Example.COM ")).toBe("dave@example.com");
  });

  it("refuses what could not be an address", () => {
    for (const raw of [null, undefined, "", "   ", "dave", "@example.com", "dave@", "a@b@c", "d ave@x.com"]) {
      expect(normalizeEmail(raw)).toBeNull();
    }
  });
});

describe("emailAllowed", () => {
  it("matches case-insensitively across the comma list", () => {
    expect(emailAllowed(LIST, "DAVE@example.com")).toBe(true);
    expect(emailAllowed(LIST, "wife@example.com")).toBe(true);
  });

  it("refuses everyone when the list is empty or unset", () => {
    // The whole safety argument for shipping passkey-first sign-up with no
    // other lock rests on this line. If it ever defaults to "allow", #126
    // becomes open sign-up on every deployment that forgot one secret.
    for (const list of [null, undefined, "", "   ", ",, ,"]) {
      expect(emailAllowed(list, "dave@example.com")).toBe(false);
    }
  });

  it("refuses an address that is not on the list", () => {
    expect(emailAllowed(LIST, "stranger@example.com")).toBe(false);
  });
});

describe("decideSignup", () => {
  const decide = (context: string | null, existing: { id: string; credentials: number } | null = null) =>
    decideSignup({ context, allowList: LIST, existing });

  it("creates an account for an allowlisted address nobody holds", () => {
    expect(decide("Dave@Example.com")).toEqual({ action: "create", email: "dave@example.com" });
  });

  it("refuses an empty field with the message that says what to do", () => {
    expect(decide(null)).toEqual({ action: "refuse", refusal: "no_email" });
    expect(decide("")).toEqual({ action: "refuse", refusal: "no_email" });
  });

  it("refuses an address that is not on the allowlist", () => {
    expect(decide("stranger@example.com")).toEqual({ action: "refuse", refusal: "not_allowed" });
  });

  it("refuses an account that already has any way in", () => {
    // One passkey, or one linked Google account, or both — any of them means
    // somebody is already this person and a session is the only route to
    // adding a device.
    for (const credentials of [1, 2, 7]) {
      expect(decide("dave@example.com", { id: "u1", credentials })).toEqual({
        action: "refuse",
        refusal: "already_claimed",
      });
    }
  });

  it("heals an abandoned ceremony rather than bricking the instance", () => {
    // generate-register-options creates the user row before the browser
    // prompts, so a cancelled Face ID leaves an account with nothing in it.
    expect(decide("dave@example.com", { id: "u1", credentials: 0 })).toEqual({
      action: "attach",
      email: "dave@example.com",
      userId: "u1",
    });
  });

  it("answers a non-allowlisted prober identically whether or not the account exists", () => {
    // The order of the two checks is the whole point: if existence were tested
    // first, `already_claimed` vs `not_allowed` would enumerate the users of
    // any instance.
    const absent = decide("stranger@example.com", null);
    const present = decide("stranger@example.com", { id: "u1", credentials: 3 });
    expect(absent).toEqual(present);
    expect(absent).toEqual({ action: "refuse", refusal: "not_allowed" });
  });

  it("refuses a malformed address before consulting the allowlist", () => {
    expect(decide("dave")).toEqual({ action: "refuse", refusal: "no_email" });
  });

  it("has a distinct message for every refusal", () => {
    const messages = Object.values(SIGNUP_REFUSAL_MESSAGE);
    expect(new Set(messages).size).toBe(messages.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
  });

  it("keeps the allowlist message free of the punctuation better-auth mangles", () => {
    // On the Google path this string becomes an `error` query param with
    // spaces joined by underscores; the hook in auth.ts throws the same
    // constant, so this pins both.
    expect(SIGNUP_REFUSAL_MESSAGE.not_allowed).toBe("This email is not allowed on this deployment");
  });
});
