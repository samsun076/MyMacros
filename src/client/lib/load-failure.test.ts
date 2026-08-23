import { expect, test } from "vitest";
import { describeLoadFailure, stagedFailure } from "./load-failure";

/** #24. **This is the whole oracle for what a failed screen says**, and it has
 *  to be: nothing in this repo executes `Today.tsx`, `Trends.tsx`, `Weight.tsx`
 *  or `Log.tsx`, and mutations of component files have come back green across
 *  the entire suite five times this month (#81 twice, #59, #102, #116). The
 *  decision — which failure is this, and what does it say — is therefore a pure
 *  function, and the components hold JSX and nothing else.
 *
 *  What it still cannot see: whether the card renders, whether the retry button
 *  is wired to `reload`, whether the tab bar survives a failed day. Those are
 *  the CDP drive, and `Network.setBlockedURLs` is the technique — the same one
 *  #51 went unseen for want of.
 *
 *  One assertion per test and no table walked in a loop: an assertion inside a
 *  loop whose earlier iteration threw reports nothing at all, while the test's
 *  name goes on suggesting coverage. */

// ── nothing failed ───────────────────────────────────

test("no error is not a failure", () => {
  expect(describeLoadFailure(null, true)).toBeNull();
});

/** The load-bearing half of the `navigator.onLine` rule: it may specialise a
 *  message about a request that already failed, and it may never decide that
 *  one did. A phone in a lift with every fetch already landed shows nothing. */
test("being offline is not itself a failure — only a failed request is", () => {
  expect(describeLoadFailure(null, false)).toBeNull();
});

// ── the network cases ────────────────────────────────

test("no response and no connection is offline", () => {
  expect(describeLoadFailure({ status: 0, code: "network" }, false)?.kind).toBe("offline");
});

/** `navigator.onLine` true means "an interface is up", which a hotel wifi
 *  portal also satisfies — so a request that never came back while the browser
 *  claims a connection gets its own sentence rather than being called offline
 *  on the browser's say-so. */
test("no response while the browser claims a connection is unreachable, not offline", () => {
  expect(describeLoadFailure({ status: 0, code: "network" }, true)?.kind).toBe("unreachable");
});

/** The issue's own requirement: "you're offline" is actionable and "something
 *  went wrong" is not, so the two must not print the same words. */
test("offline and unreachable say different things", () => {
  const offline = describeLoadFailure({ status: 0, code: "network" }, false);
  expect(describeLoadFailure({ status: 0, code: "network" }, true)?.title).not.toBe(offline?.title);
});

test("offline and a server error say different things", () => {
  const offline = describeLoadFailure({ status: 0, code: "network" }, false);
  expect(describeLoadFailure({ status: 500, code: "oops" }, false)?.title).not.toBe(offline?.title);
});

// ── the server answered ──────────────────────────────

test("a 500 is our end", () => {
  expect(describeLoadFailure({ status: 500, code: "internal" }, true)?.kind).toBe("server");
});

test("a 503 is our end too", () => {
  expect(describeLoadFailure({ status: 503, code: "unavailable" }, true)?.kind).toBe("server");
});

/** The asymmetry that keeps `navigator.onLine` honest. A 503 *arrived*, so the
 *  connection demonstrably works and what the browser believes about it is
 *  irrelevant — a stale `offline` flag must not relabel a server fault. */
test("a response that arrived is never called offline, whatever the browser thinks", () => {
  expect(describeLoadFailure({ status: 503, code: "unavailable" }, false)?.kind).toBe("server");
});

test("a 404 is a refusal, not a server fault", () => {
  expect(describeLoadFailure({ status: 404, code: "not_found" }, true)?.kind).toBe("refused");
});

test("a 400 is a refusal", () => {
  expect(describeLoadFailure({ status: 400, code: "invalid_fields" }, true)?.kind).toBe("refused");
});

// ── the session, which this must not touch ───────────

/** `lib/api.ts` pokes better-auth's session store on every 401 and `App.tsx`
 *  swaps the tree for the sign-in screen. A card reading "something went wrong
 *  our end" over a working sign-out would be describing the app's own answer as
 *  a fault, for the half-second before it unmounts. */
test("a 401 is the session layer's, and this says nothing", () => {
  expect(describeLoadFailure({ status: 401, code: "unauthorized" }, true)).toBeNull();
});

test("a 401 while offline is still the session layer's", () => {
  expect(describeLoadFailure({ status: 401, code: "unauthorized" }, false)).toBeNull();
});

// ── whether another go is offered ────────────────────

test("a dropped connection is worth retrying", () => {
  expect(describeLoadFailure({ status: 0, code: "network" }, false)?.retry).toBe(true);
});

test("a broken server is worth retrying", () => {
  expect(describeLoadFailure({ status: 500, code: "internal" }, true)?.retry).toBe(true);
});

/** The identical request would get the identical answer, and a button that
 *  visibly does nothing is worse than copy naming the real way out. */
test("a refusal offers no retry", () => {
  expect(describeLoadFailure({ status: 404, code: "not_found" }, true)?.retry).toBe(false);
});

// ── the technical line ───────────────────────────────

test("the mono line carries the status", () => {
  expect(describeLoadFailure({ status: 503, code: "unavailable" }, true)?.mono).toBe(
    "HTTP 503 · UNAVAILABLE",
  );
});

test("a request that never got a status says so instead of printing zero", () => {
  expect(describeLoadFailure({ status: 0, code: "network" }, false)?.mono).not.toContain("0");
});

// ── the DEV stages ───────────────────────────────────

/** The stages exist so `shot-matrix` and `verify:viewport` can hold a state
 *  they cannot otherwise reach. They are checked *through* `describeLoadFailure`
 *  on purpose — a stage that fabricated its own copy could drift into a screen
 *  the app never renders, which is the trap `/trends#empty` avoids by running
 *  the real `buildTrends`. */
test("#offline stages the offline screen", () => {
  const stage = stagedFailure("#offline")!;
  expect(describeLoadFailure(stage.error, stage.online)?.kind).toBe("offline");
});

/** Headless Chrome is always online, so the stage has to carry the flag as
 *  well as the error or `#offline` would quietly shoot the *unreachable*
 *  screen — right layout, wrong words, and no way to tell from the PNG. */
test("#offline stages an offline browser, not just a failed request", () => {
  expect(stagedFailure("#offline")?.online).toBe(false);
});

test("#failed stages a server error", () => {
  const stage = stagedFailure("#failed")!;
  expect(describeLoadFailure(stage.error, stage.online)?.kind).toBe("server");
});

test("an unrelated hash stages nothing", () => {
  expect(stagedFailure("#swiped")).toBeNull();
});

test("no hash stages nothing", () => {
  expect(stagedFailure("")).toBeNull();
});
