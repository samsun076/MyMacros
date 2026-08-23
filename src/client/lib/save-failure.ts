/** What the confirm sheet says when a save is refused, decided in one place
 *  (#113).
 *
 *  **The defect this exists for.** `POST /api/food-logs` answered a portion
 *  that pushed a food past the calorie ceiling with `{"error":"invalid_item"}`,
 *  and the sheet answered *that* with "Couldn't save — check your connection
 *  and try again." Two wrong statements in a row: the connection was fine, and
 *  the field the person had touched a second earlier went unnamed. #95's
 *  finding is that a correction nobody can see is the reported bug wearing a
 *  different hat; a refusal nobody can attribute is the same shape one step
 *  over.
 *
 *  **The route names the field, not this module.** `FOOD_LIMITS.grams.max`
 *  (2,000) and `FOOD_LIMITS.kcal.max` (10,000) do not know each other exists,
 *  and the portion multiplies into the thing the second one bounds — so the
 *  effective portion ceiling is a *product*, around 1,850 g for Nutella at
 *  539 kcal/100 g. Only the Worker holds both bounds at once, so only the
 *  Worker can say which fired; `src/worker/item-refusal.ts` is where that is
 *  decided and why the band it describes must not be "fixed" by moving a
 *  number. This side does one thing: turn that answer into a sentence, and
 *  say which control to put it beside.
 *
 *  **Here rather than in `Log.tsx`** for `load-failure.ts`'s reason exactly —
 *  nothing in this repo executes that file, and a rule left in a component has
 *  no oracle.
 */

/** The shape `ApiError` already has, structurally — so this module imports
 *  nothing from `lib/api.ts` and its test needs no `fetch` and no
 *  better-auth. `status` is 0 when the request never reached the server. */
export type FailedRequest = { status: number; code: string };

export type SaveFailure = {
  /** The sentence the sheet prints. */
  message: string;
  /** Which control it belongs beside, or `null` for "the save as a whole".
   *  `"portion"` is the HOW MUCH field — the sheet's own grams row on a
   *  barcode read (#15), and the per-item portion control otherwise (#58). */
  at: "portion" | null;
};

/** Which refusal this is, and what it says.
 *
 *  **Only `item_over_limit` is attributed**, because it is the only answer the
 *  route gives that names a cause. Everything else keeps the generic sentence
 *  it had — an `invalid_item` with no portion behind it really is "something
 *  on this sheet is not a number the server will take", and inventing a field
 *  for it would be the same defect in the opposite direction.
 *
 *  **A network failure and a refusal must not read the same**, which is what
 *  the shipped copy got wrong: it blamed the connection for every non-2xx.
 *  A 400 arrived, so the connection demonstrably works — the same ordering
 *  `describeLoadFailure` keeps for its own reason.
 */
export function describeSaveFailure(error: FailedRequest | null): SaveFailure | null {
  if (!error) return null;

  if (error.code === "item_over_limit") {
    return {
      message:
        "That amount makes this food's numbers too big to be real, so it wasn't saved. Lower HOW MUCH, or type the figures in yourself.",
      at: "portion",
    };
  }

  // Status 0 is `lib/api.ts`'s "the request never reached the server", and it
  // is the only case where the connection is a fair thing to name.
  if (error.status === 0) return { message: "Couldn't save — check your connection and try again.", at: null };

  if (error.status >= 500) {
    return { message: "The server couldn't save that. Nothing you did caused it — try again.", at: null };
  }

  return {
    message: "The server turned that save down. Check the numbers on this sheet — one of them is out of range.",
    at: null,
  };
}

/** DEV-only hash stage, mirroring `stagedFailure` in `lib/load-failure.ts`.
 *
 *  A refused save is a state design QA structurally cannot reach: producing it
 *  for real needs a barcode in front of a camera headless Chrome does not
 *  have, and then a portion large enough to break the calorie ceiling. So
 *  `/log#refused` is the only way to see the one thing #113 is about — the
 *  sentence drawn against the field that caused it, rather than under a save
 *  button a tall sheet can scroll out of sight.
 *
 *  **It fabricates the request that failed, never the answer.** The refusal
 *  goes through the same `describeSaveFailure` every real one does, so a stage
 *  cannot drift into copy the app would never print — the discipline
 *  `/trends#empty` and `#offline` both follow. The `import.meta.env.DEV` gate
 *  stays at the call site, where Vite compiles the branch out of production. */
export function stagedSaveFailure(hash: string): FailedRequest | null {
  return hash === "#refused" ? { status: 400, code: "item_over_limit" } : null;
}
