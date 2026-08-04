#!/usr/bin/env node
// Routing smoke test — guards the invariant that broke Google sign-in in B2.
//
//   node tools/verify-routing.mjs                        # localhost:5173
//   node tools/verify-routing.mjs https://fuel.debrief.run
//
// Cloudflare's asset router runs in front of the Worker. With
// not_found_handling: single-page-application it answers unmatched *HTML
// navigations* with index.html and never invokes the Worker — while fetch()
// calls (Accept: application/json) fall through and work fine. So the API can
// look completely healthy while every route a browser *navigates to* silently
// returns the SPA shell. That is what swallowed /api/auth/callback/google:
// better-auth never saw the code, and there was no error and no log line.
//
// assets.run_worker_first in wrangler.jsonc is what prevents it. This script
// fails loudly if that protection ever disappears.
//
// Why not curl: curl defaults to Accept: */*, which is exactly the case the
// asset router passes through. Every curl probe of the broken callback
// returned a correct 302 while the real browser got HTML. The checks below
// therefore send the headers a browser actually sends.

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:5173").replace(/\/$/, "");

// What a top-level browser navigation looks like on the wire.
const NAVIGATION = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
};

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
  return { status: res.status, type: res.headers.get("content-type") ?? "" };
}

console.log(`\nrouting checks against ${BASE}\n`);

// The regression itself: /api/* must reach the Worker even when the request
// arrives as a document navigation. A real browser hits the OAuth callback
// exactly this way.
console.log("api routes survive navigation (the B2 regression)");
for (const path of [
  "/api/health",
  "/api/auth-methods",
  "/api/auth/callback/google?code=probe&state=probe",
]) {
  const { status, type } = await get(path, NAVIGATION);
  // Anything but HTML means the Worker answered. The callback legitimately
  // redirects (302 to the error page for a bogus code) — what matters is that
  // it is not the SPA shell.
  check(path, !type.includes("text/html"), `${status} ${type || "(no type)"}`);
}

// The other half of the invariant: client-side routes must still fall back to
// index.html, or fixing the above would break deep links into the SPA.
console.log("\nspa routes still fall back to index.html");
for (const path of ["/", "/settings", "/trends", "/log", "/not-a-real-route"]) {
  const { status, type } = await get(path, NAVIGATION);
  check(path, status === 200 && type.includes("text/html"), `${status} ${type}`);
}

// Static assets keep their real content types — a mistyped asset path served
// as index.html is the quieter cousin of the same bug.
console.log("\nstatic assets serve with real content types");
for (const [path, expected] of [
  ["/manifest.webmanifest", "json"],
  ["/icons/icon-192.png", "image/png"],
]) {
  const { status, type } = await get(path);
  check(path, status === 200 && type.includes(expected), `${status} ${type}`);
}

// Unknown /api paths must answer as API, never as the SPA, so a mistyped fetch
// fails loudly instead of parsing HTML as JSON.
console.log("\nunknown api paths answer as api");
{
  const { status, type } = await get("/api/does-not-exist", NAVIGATION);
  check("/api/does-not-exist", !type.includes("text/html"), `${status} ${type}`);
}

console.log(
  failures === 0
    ? "\nall routing checks passed\n"
    : `\n${failures} routing check(s) failed — see CLAUDE.md "the asset router runs before the Worker"\n`,
);
process.exit(failures === 0 ? 0 : 1);
