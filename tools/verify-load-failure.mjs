#!/usr/bin/env node
// A failed read says what happened and offers the way back (issue #24).
//
//   npm run dev                       # in another terminal
//   node tools/verify-load-failure.mjs --cookie better-auth.session_token=...
//
// **Why this exists at all.** Nothing in this repo executes `Today.tsx` —
// mutations of component files have come back green across the whole suite
// five times this month (#81 twice, #59, #102, #116). `lib/load-failure.ts`
// holds the decision and is unit-tested; what no unit test can reach is
// whether the card is *rendered*, whether "Try again" is wired to `reload`
// rather than to nothing, and whether the tab bar survives a screen with no
// data on it. That is this file.
//
// **And design QA structurally cannot see any of it.** `cdp.mjs` forces
// `prefers-reduced-motion: reduce` and every PNG this project has produced is
// of a fully-loaded app; #51 lived entirely in the data-pending window and was
// invisible for exactly that reason. `Network.setBlockedURLs` and `Fetch` are
// how you get there, and they are the same two techniques CLAUDE.md names.
//
// **What is fabricated, and what is real.** The 503 case is a real response
// through the real code path — `Fetch.fulfillRequest` answers the app's own
// `fetch()`. The blocked cases are real failures too: the request genuinely
// does not complete. The one fabrication is `navigator.onLine`, replaced before
// app script runs in the offline case, because headless Chrome behind a working
// network cannot be made to believe otherwise while still serving the document.
// It is the same discipline as the fake keyboard (#120): replace the *input*
// the app measures, and let every line downstream of it be the real one.
//
// What it still cannot tell you: what any of this looks like on a phone, or
// whether a thumb finds the button. Those are the device.

import { mkdir, writeFile } from "node:fs/promises";
import { evaluate, openPage, settle, waitFor, withChrome } from "./cdp.mjs";

const argv = process.argv.slice(2);
let base = "http://localhost:5173";
const cookies = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--cookie") {
    const raw = argv[++i];
    const eq = raw.indexOf("=");
    cookies.push({ name: raw.slice(0, eq), value: raw.slice(eq + 1) });
  } else base = a.replace(/\/$/, "");
}
if (!cookies.length) {
  console.error("every screen is behind auth — pass --cookie <name>=<value>");
  process.exit(2);
}

const API = ["*/api/day/*", "*/api/me"];
const OUT = "shots";

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

/** A wait that reports and carries on rather than throwing.
 *
 *  Written after a mutation run, and it is the difference between a report and
 *  a bare exit code: with `waitFor` throwing, deleting the card from `Today`
 *  ended this file at its first assertion and the other twenty-seven checks
 *  **never ran** — neither green nor red, while the run's own output went on
 *  looking like a suite that had been executed. That is precisely the failure
 *  CLAUDE.md names (an assertion inside a loop whose earlier iteration threw
 *  reports nothing at all), and a driver is one long loop. Soft-waiting makes
 *  a broken build say *which* of the claims here stopped being true. */
async function soft(cdp, s, expr, label, timeout = 6000) {
  try {
    return await waitFor(cdp, s, expr, { timeout, label });
  } catch {
    check(`waited for ${label}`, false, `timed out after ${timeout}ms`);
    return null;
  }
}

/** What the failure card is saying, or null when there isn't one. */
const CARD = `(() => {
  const el = document.querySelector(".load-fail");
  if (!el) return null;
  return {
    role: el.getAttribute("role"),
    title: el.querySelector(".eyebrow")?.textContent ?? "",
    detail: el.querySelector("p")?.textContent ?? "",
    mono: el.querySelector(".mono")?.textContent ?? "",
    retry: el.querySelector("button")?.textContent ?? null,
  };
})()`;

/** The screen behind it: is the day drawn, is anything still pending, and can
 *  you still leave? */
const SCREEN = `(() => ({
  budget: !!document.querySelector(".budget"),
  busy: !!document.querySelector('[aria-busy="true"]'),
  tabs: [...document.querySelectorAll("nav.tabbar a")].map((a) => a.getAttribute("href")),
  offlineBanner: !!document.querySelector(".offline"),
}))()`;

await mkdir(OUT, { recursive: true }).catch(() => {});

console.log(`\nfailed-read checks against ${base}\n`);

await withChrome(async (cdp) => {
  const page = await openPage(cdp);
  const s = page.sessionId;
  await cdp.send("Network.enable", {}, s);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
    s,
  );
  for (const c of cookies) {
    await cdp.send("Network.setCookie", { ...c, url: base, path: "/" }, s);
  }

  const shoot = async (name) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, s);
    await writeFile(`${OUT}/failure-${name}@375.png`, Buffer.from(data, "base64"));
  };

  // ── 1. offline ───────────────────────────────────────
  // The API blocked (a real failed request) plus the one input a working
  // network cannot fabricate for us.
  const offlineScript = await cdp.send(
    "Page.addScriptToEvaluateOnNewDocument",
    {
      source: `Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });`,
    },
    s,
  );
  await cdp.send("Network.setBlockedURLs", { urls: API }, s);
  await page.navigate(`${base}/`);
  await settle(cdp, s);
  const offline = (await soft(cdp, s, CARD, "the offline card")) ?? {};
  const offlineScreen = await evaluate(cdp, s, SCREEN);
  await shoot("offline");
  check("offline names the connection", offline.title === "You're offline", `“${offline.title}”`);
  check("offline offers a retry", offline.retry === "Try again");
  check("offline is announced", offline.role === "alert");
  check("the day is not drawn under it", offlineScreen.budget === false);
  check(
    "the tab bar is alive",
    offlineScreen.tabs.includes("/trends") && offlineScreen.tabs.includes("/settings"),
    offlineScreen.tabs.join(" "),
  );
  console.log(`        ↳ ${offline.detail}`);
  console.log(`        ↳ ${offline.mono}`);

  // The tab bar is not merely present — it still goes somewhere.
  await evaluate(cdp, s, `document.querySelector('nav.tabbar a[href="/trends"]').click()`);
  await new Promise((r) => setTimeout(r, 400));
  const wentToTrends = await evaluate(cdp, s, `location.pathname`);
  check("a failed Today is not a dead end", wentToTrends === "/trends", wentToTrends);
  const trendsCard = (await soft(cdp, s, CARD, "the trends card")) ?? {};
  check("Trends says it too", trendsCard.title === "You're offline", `“${trendsCard.title}”`);
  await shoot("offline-trends");

  /* Per subject, and this is the case that proves it: only `/api/me` is
     blocked here — `/api/trends` is not — so the charts below the card are
     drawn from data that arrived, and the card has to name the read that
     actually failed. It said "Your trends didn't load" over a rendered weight
     chart until this check was written, which is a screen contradicting
     itself. Found by driving it; no unit test could have. */
  const trendsScreen = await evaluate(
    cdp,
    s,
    `({ chart: !!document.querySelector(".wchart"), detail: document.querySelector(".load-fail p")?.textContent ?? "" })`,
  );
  check(
    "the card names the read that failed, not the screen it is on",
    trendsScreen.detail.startsWith("Your profile didn't load."),
    `“${trendsScreen.detail.slice(0, 34)}…”`,
  );
  check(
    "and the data that did arrive is still drawn",
    trendsScreen.chart === true,
  );

  // ── 2. unreachable ───────────────────────────────────
  // Same failed request, browser believes it is online. `navigator.onLine` is
  // a negative signal only: true means an interface is up, which a hotel wifi
  // portal also satisfies — so this must not claim the phone is offline.
  await cdp.send("Page.removeScriptToEvaluateOnNewDocument", offlineScript, s);
  await page.navigate(`${base}/`);
  await settle(cdp, s);
  const unreachable = (await soft(cdp, s, CARD, "the unreachable card")) ?? {};
  await shoot("unreachable");
  check(
    "a request that never lands while online is not called offline",
    unreachable.title === "Couldn't reach the server",
    `“${unreachable.title}”`,
  );
  check(
    "and it says something different from offline",
    unreachable.detail !== offline.detail,
  );
  console.log(`        ↳ ${unreachable.detail}`);

  // ── 3. the server broke ──────────────────────────────
  // A real 503 through the real code path, on /api/day only — so /api/me
  // succeeds and the header still carries the goal it came from. That is the
  // per-subject blanking: one failed read does not take the other's data off
  // the screen, it takes its own.
  await cdp.send("Network.setBlockedURLs", { urls: [] }, s);
  await cdp.send(
    "Fetch.enable",
    { patterns: [{ urlPattern: "*/api/day/*", requestStage: "Request" }] },
    s,
  );
  let serving503 = true;
  const held = [];
  const unsub = cdp.on(
    "Fetch.requestPaused",
    ({ requestId }) => {
      if (!serving503) return void held.push(requestId);
      void cdp.send(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: 503,
          responseHeaders: [{ name: "content-type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ error: "server_error" })).toString("base64"),
        },
        s,
      );
    },
    s,
  );
  await page.navigate(`${base}/`);
  await settle(cdp, s);
  const server = (await soft(cdp, s, CARD, "the server card")) ?? {};
  const serverScreen = await evaluate(cdp, s, SCREEN);
  await shoot("server");
  check(
    "a 503 is our end, not the phone's",
    server.title === "Something went wrong our end",
    `“${server.title}”`,
  );
  check("and it names the status for the bug report", server.mono === "HTTP 503 · SERVER_ERROR", server.mono);
  check("no offline banner over a working connection", serverScreen.offlineBanner === false);
  check("the day is not drawn under it", serverScreen.budget === false);
  console.log(`        ↳ ${server.detail}`);

  // ── 4. the retry actually re-fetches ─────────────────
  // Stop breaking it, tap the button the card drew, and the day must arrive —
  // with no navigation, which is the whole of "a retry, not a reload".
  serving503 = false;
  await cdp.send("Fetch.disable", {}, s);
  unsub();
  /* A sentinel on the window, and it took a mutation to arrive at it.
     The first version of this check compared
     `performance.getEntriesByType("navigation").length` before and after —
     which is **1 either way**, because a reload starts a new document whose
     navigation list has exactly one entry too. Mutating `onRetry` to
     `window.location.reload()` came back green on all 30 checks: the oracle for
     "a retry, not a reload" could not distinguish the two implementations it
     existed to distinguish (#59's decorative-oracle shape, one turn tighter
     than a green bystander). A global set before the tap is destroyed by a
     document swap and survives a re-render, which is exactly the question. */
  await evaluate(cdp, s, `(window.__sameDocument = 1)`);
  await evaluate(cdp, s, `document.querySelector(".load-fail button")?.click() ?? null`);
  const arrived = await soft(cdp, s, `document.querySelector(".budget") ? 1 : 0`, "the day after a retry");
  const afterRetry = await evaluate(cdp, s, SCREEN);
  await shoot("retried");
  check("Try again re-fetches and the day lands", arrived === 1);
  check("the card is gone", (await evaluate(cdp, s, CARD)) === null);
  check(
    "it re-fetched rather than reloading the page",
    (await evaluate(cdp, s, `window.__sameDocument ?? 0`)) === 1,
  );
  check("the tab bar never went anywhere", afterRetry.tabs.length >= 3);

  // ── 5. slow is not the same picture as failed ────────
  // The defect in one line: every section was gated on `{day && …}`, so a
  // fetch that failed and a fetch that had not answered yet drew the identical
  // screen. Hold /api/day open and never answer it.
  await cdp.send(
    "Fetch.enable",
    { patterns: [{ urlPattern: "*/api/day/*", requestStage: "Request" }] },
    s,
  );
  const paused = [];
  const unsub2 = cdp.on("Fetch.requestPaused", ({ requestId }) => void paused.push(requestId), s);
  await page.navigate(`${base}/`);
  await settle(cdp, s);
  await new Promise((r) => setTimeout(r, 1200));
  const slowCard = await evaluate(cdp, s, CARD);
  const slow = await evaluate(cdp, s, SCREEN);
  await shoot("slow");
  check("a slow load says nothing went wrong", slowCard === null);
  check("and it says it is still working", slow.busy === true);
  check("nothing is drawn yet either way", slow.budget === false);

  // …and it is still a *load*: let it through and the day arrives.
  for (const requestId of paused) await cdp.send("Fetch.continueRequest", { requestId }, s);
  const late = await soft(cdp, s, `document.querySelector(".budget") ? 1 : 0`, "the day, late");
  const loaded = await evaluate(cdp, s, SCREEN);
  check("a held request that finally lands draws the day", late === 1);
  check("and nothing is left claiming to be busy", loaded.busy === false);
  unsub2();
  await cdp.send("Fetch.disable", {}, s);

  // ── 6. a failed RE-read blanks what it failed to refresh ──
  // `useApi` keeps the last successful `data` when a later fetch fails, so
  // this is the case where "show the card above the numbers" and "blank the
  // numbers" actually differ — and it is reachable without writing anything,
  // because each range on Trends is its own path: load 12W, break the route,
  // tap 4W. Left alone, the screen would draw twelve weeks of chart under a
  // card saying it failed, with 4W lit above it. That is #54's cached-`/api/day`
  // defect in miniature: numbers that are no longer about what the screen says
  // they are about.
  await page.navigate(`${base}/trends`);
  await settle(cdp, s);
  await soft(cdp, s, `document.querySelector(".wchart") ? 1 : 0`, "the weight chart");
  await cdp.send(
    "Fetch.enable",
    { patterns: [{ urlPattern: "*/api/trends/*", requestStage: "Request" }] },
    s,
  );
  const unsub3 = cdp.on(
    "Fetch.requestPaused",
    ({ requestId }) =>
      void cdp.send(
        "Fetch.fulfillRequest",
        {
          requestId,
          responseCode: 503,
          responseHeaders: [{ name: "content-type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ error: "server_error" })).toString("base64"),
        },
        s,
      ),
    s,
  );
  await evaluate(
    cdp,
    s,
    `[...document.querySelectorAll(".range button")].find((b) => b.textContent === "4W").click()`,
  );
  const reread = (await soft(cdp, s, CARD, "the card after a failed re-read")) ?? {};
  const rereadScreen = await evaluate(
    cdp,
    s,
    `({ chart: !!document.querySelector(".wchart"), range: document.querySelector(".range button.on")?.textContent })`,
  );
  await shoot("stale-reread");
  check("a failed re-read is explained", reread.title === "Something went wrong our end");
  check(
    "and the numbers it failed to refresh are gone, not left standing",
    rereadScreen.chart === false,
    `range now ${rereadScreen.range}`,
  );
  unsub3();
  await cdp.send("Fetch.disable", {}, s);
});

console.log(
  `\n${failures ? `✗ ${failures} check(s) failed` : "✓ all checks passed"} · shots/failure-*@375.png\n`,
);
process.exit(failures ? 1 : 0);
