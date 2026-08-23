import { useOnline } from "./sw";

/** What a screen says when a read fails, decided in one place (#24).
 *
 *  **The defect this exists for:** `Today.tsx` took `data` and `reload` off
 *  `useApi` and dropped `error` on the floor. Every section was gated on
 *  `{day && …}`, so a failed fetch rendered a header and permanent blankness —
 *  *a failed load and a slow load were the same picture*, and neither said
 *  anything or offered a way back.
 *
 *  **Here rather than in the screens** because nothing in this repo executes
 *  `Today.tsx`, `Trends.tsx` or `Log.tsx`: five mutations of component files
 *  this week came back green across the whole suite (#81, #59, #102, #112,
 *  #116). A rule left in a component has no oracle. What a screen keeps is the
 *  JSX; what moved here is the decision — *which failure is this, and what does
 *  it say* — which is a pure function of two inputs and is tested as one.
 *
 *  **`navigator.onLine` is a NEGATIVE signal and is used only to specialise.**
 *  False means definitely offline; true means "an interface is up", which a
 *  hotel wifi portal also satisfies (`lib/sw.ts` says the same beside the
 *  hook). So nothing here asks it whether the request failed — a real
 *  `ApiError` is the only thing that says that — it is asked only *which of
 *  two sentences* to print about a request that already failed. Invert that
 *  and a captive portal produces a screen claiming everything is fine.
 *
 *  **Never a cache.** `sw.js` refuses to store an API response on purpose
 *  (#54): a cached `/api/day` beside a live one is the register's own defect
 *  with a stale timestamp. The answer to a failed read is to say what happened
 *  and offer another go — never to show yesterday's numbers as though they were
 *  today's.
 */

export type FailureKind =
  /** The browser says there is no connection at all. */
  | "offline"
  /** The request never came back, and the browser thinks it is online. */
  | "unreachable"
  /** The server answered, and the answer was that it broke. */
  | "server"
  /** The server answered, and the answer was no. */
  | "refused";

export type LoadFailure = {
  kind: FailureKind;
  /** The headline: what happened, in the reader's terms. */
  title: string;
  /** The sentence under it. Reads as a continuation of "<subject> didn't load." */
  detail: string;
  /** The technical line, for the bug report that follows. Never the whole
   *  story, and never the thing a person has to read to know what to do. */
  mono: string;
  /** Whether "Try again" is offered — false when the identical request would
   *  get the identical answer, and a button that visibly does nothing is worse
   *  than copy that names the real way out. The tab bar is the other exit and
   *  it stays alive in both cases (the failure renders inside the route, and
   *  the bar lives in `AppShell` outside it). */
  retry: boolean;
};

/** The shape `ApiError` already has, structurally — so this module imports
 *  nothing from `lib/api.ts` and its test needs no browser, no better-auth and
 *  no `fetch`. `status` is 0 when the request never reached the server. */
export type FailedRequest = { status: number; code: string };

/** Which failure this is, and what it says. `null` means *say nothing* — and
 *  the two cases that produce it are different in kind, not in degree:
 *
 *  - **no error.** Nothing failed. The screen is loading, or loaded.
 *  - **401.** The session died, and the app already has one answer for that:
 *    `lib/api.ts` pokes better-auth's session store on every 401, `App.tsx`'s
 *    gate re-checks and swaps the whole tree for the sign-in screen. A screen
 *    that also printed "something went wrong our end" would be describing a
 *    working sign-out as a server fault, for the half-second before it
 *    unmounts. Screens never interpret a 401 (`lib/api.ts` says so); this is
 *    that rule, kept.
 */
export function describeLoadFailure(
  error: FailedRequest | null,
  online: boolean,
): LoadFailure | null {
  if (!error) return null;
  if (error.status === 401) return null;

  // Order matters: `online` is consulted only inside the branch where the
  // request produced no response at all. A 500 arrived, so the connection
  // demonstrably works and what the browser believes about it is irrelevant.
  if (error.status === 0) {
    return online
      ? {
          kind: "unreachable",
          title: "Couldn't reach the server",
          detail:
            "The request didn't get through. Your phone thinks it's online, so this is usually a weak signal or a wifi login page waiting for you.",
          mono: "NETWORK · NO RESPONSE",
          retry: true,
        }
      : {
          kind: "offline",
          title: "You're offline",
          detail:
            "Your phone says there's no connection. Nothing on this screen is cached — it reads live numbers or none — so there's nothing to show until you're back.",
          mono: "NETWORK · OFFLINE",
          retry: true,
        };
  }

  if (error.status >= 500) {
    return {
      kind: "server",
      title: "Something went wrong our end",
      detail:
        "The server couldn't answer. Nothing you did caused it, and it's often gone a moment later.",
      mono: httpLine(error),
      retry: true,
    };
  }

  return {
    kind: "refused",
    title: "The server turned that down",
    detail:
      "That isn't a request the server will answer, so trying it again gets the same reply. Reopening the app is the fix — this tab may be running an older build than the server.",
    mono: httpLine(error),
    retry: false,
  };
}

function httpLine(error: FailedRequest): string {
  return `HTTP ${error.status} · ${error.code.toUpperCase()}`;
}

/** DEV-only hash stages, mirroring `/trends#empty` (#22) and `/#editing` (#60):
 *  a state design QA structurally cannot reach, made addressable so
 *  `shot-matrix` and `verify:viewport` can hold it still.
 *
 *  **Pure over the hash**, so the mapping is unit-tested rather than trusted;
 *  the `import.meta.env.DEV` gate stays at the call site, where it is a
 *  build-time literal Vite compiles the whole branch out of production with.
 *
 *  It carries `online` as well as the error because the copy turns on it, and
 *  headless Chrome is always online — a `#offline` stage that read the real
 *  `navigator.onLine` would render the *unreachable* text and quietly shoot the
 *  wrong screen. The failure it produces is then classified by the same
 *  `describeLoadFailure` every real failure goes through, so a stage cannot
 *  drift into copy the app would never print.
 *
 *  What it is **not** is a test of the fetch path: it fabricates the error
 *  rather than blocking the request. `Network.setBlockedURLs` is what drives
 *  the real one, and that is what the issue's Verify section asks for.
 */
export function stagedFailure(hash: string): { error: FailedRequest; online: boolean } | null {
  if (hash === "#offline") return { error: { status: 0, code: "network" }, online: false };
  if (hash === "#failed") return { error: { status: 503, code: "server_error" }, online: true };
  return null;
}

/** The hook every screen uses: the live online flag, the DEV stage, and the
 *  classification above, in the one order they compose.
 *
 *  Call it once per *subject* (the day, the profile, the trends) rather than
 *  once per screen — what a screen blanks when a read fails is that read's own
 *  section, and a `/api/me` failure must not take a correctly-loaded day off
 *  the screen with it. Rendering is then one block for the first failure that
 *  exists; see `LoadFailureNote`.
 */
export function useLoadFailure(error: FailedRequest | null): LoadFailure | null {
  const online = useOnline();
  const stage = import.meta.env.DEV ? stagedFailure(window.location.hash) : null;
  return describeLoadFailure(stage?.error ?? error, stage ? stage.online : online);
}
