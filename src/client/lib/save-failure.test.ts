import { describe, expect, it } from "vitest";
import { describeSaveFailure, stagedSaveFailure } from "./save-failure";

/** #113. The confirm sheet answered every failed save with "Couldn't save —
 *  check your connection and try again.", including a 400 that arrived
 *  perfectly well over a working connection because the portion typed into HOW
 *  MUCH had pushed the food past the calorie ceiling.
 *
 *  Two claims are tested here and they are separable: that a refusal is not
 *  described as a network problem, and that the one refusal the route can
 *  attribute is pointed at the field that caused it. */
describe("describeSaveFailure", () => {
  it("says nothing when nothing failed", () => {
    expect(describeSaveFailure(null)).toBeNull();
  });

  it("names the portion when the route says the portion did it", () => {
    const failure = describeSaveFailure({ status: 400, code: "item_over_limit" });
    expect(failure?.at).toBe("portion");
  });

  it("tells the person what to do about it", () => {
    const failure = describeSaveFailure({ status: 400, code: "item_over_limit" });
    expect(failure?.message).toContain("HOW MUCH");
  });

  it("does not blame the connection for a refusal", () => {
    // The shipped sentence for this case, verbatim, and the bug: a 400 arrived,
    // so the connection demonstrably works.
    const failure = describeSaveFailure({ status: 400, code: "item_over_limit" });
    expect(failure?.message).not.toContain("connection");
  });

  it("does not blame the connection for a generic refusal either", () => {
    const failure = describeSaveFailure({ status: 400, code: "invalid_item" });
    expect(failure?.message).not.toContain("connection");
  });

  it("points a generic refusal at nothing rather than guessing", () => {
    // `invalid_item` with no portion behind it really is "something on this
    // sheet is not a number the server will take". Inventing a field for it
    // would be the same defect in the opposite direction.
    expect(describeSaveFailure({ status: 400, code: "invalid_item" })?.at).toBeNull();
  });

  it("still blames the connection when the request never reached the server", () => {
    const failure = describeSaveFailure({ status: 0, code: "network" });
    expect(failure?.message).toContain("connection");
    expect(failure?.at).toBeNull();
  });

  it("separates a server fault from a refusal", () => {
    const server = describeSaveFailure({ status: 503, code: "server_error" });
    const refused = describeSaveFailure({ status: 400, code: "invalid_item" });
    expect(server?.message).not.toBe(refused?.message);
  });

  it("tells someone a 500 was not their fault", () => {
    expect(describeSaveFailure({ status: 500, code: "server_error" })?.message).toContain(
      "Nothing you did caused it",
    );
  });

  it("reads the code, not the status — a portion refusal is a 400 like any other", () => {
    // The oracle that separates the two implementations: classifying on status
    // alone cannot tell `item_over_limit` from `invalid_item`, and both arrive
    // as 400.
    const attributed = describeSaveFailure({ status: 400, code: "item_over_limit" });
    const generic = describeSaveFailure({ status: 400, code: "invalid_item" });
    expect(attributed?.at).toBe("portion");
    expect(generic?.at).toBeNull();
  });
});

/** The DEV stage, pure over the hash so the mapping is tested rather than
 *  trusted — the same shape `stagedFailure` has in `lib/load-failure.ts`. */
describe("stagedSaveFailure", () => {
  it("stages the refusal #113 is about", () => {
    expect(stagedSaveFailure("#refused")).toEqual({ status: 400, code: "item_over_limit" });
  });

  it("stages the code the real classifier reads, so the stage cannot drift from the app", () => {
    // Fabricate the request, never the answer: what the stage produces is fed
    // to the same `describeSaveFailure` a real refusal goes through.
    expect(describeSaveFailure(stagedSaveFailure("#refused"))?.at).toBe("portion");
  });

  it("stages nothing for every other hash", () => {
    expect(stagedSaveFailure("#portion")).toBeNull();
    expect(stagedSaveFailure("")).toBeNull();
    expect(stagedSaveFailure("#confirm")).toBeNull();
  });
});
