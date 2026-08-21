#!/usr/bin/env node
// Horizontal-overflow guard (issue #51).
//
//   node tools/verify-viewport.mjs --cookie better-auth.session_token=...
//   node tools/verify-viewport.mjs --cookie ... https://fuel.debrief.run
//   node tools/verify-viewport.mjs --widths 375 --routes /log#confirm
//   node tools/verify-viewport.mjs --camera --cookie ...   # live viewfinder
//
// #51: the standalone PWA rendered the 430px frame centred in a layout
// viewport far wider than the phone, with letterbox bars — the desktop
// behaviour, on a 390pt device. One way a page gets there is content that
// overflows horizontally: iOS may widen the layout viewport to contain it and
// then keep it. This script fails if any screen's content is wider than the
// viewport at any phone width.
//
// Why this can't be an eyeball check: shot-matrix renders at a *fixed* width,
// so a page whose content is 540px wide is simply cropped at 375 — it looks
// like a screenshot, not like a defect. Nothing in the design loop sees this
// class of bug, which is the same blind spot filed for #38.
//
// What this does NOT prove: headless Chrome always honours the width it is
// told, so it can never reproduce iOS's *reaction* (a widened layout viewport,
// letterboxing, per-site page zoom). It catches the cause, not the symptom.
// On a real device the equivalent assertion is
// `window.innerWidth === document.documentElement.clientWidth` in the remote
// inspector — if that fails while this passes, the viewport was widened by
// something other than the page's own content.

import { evaluate, openPage, settle, withChrome } from "./cdp.mjs";

// ── args ─────────────────────────────────────────────
const argv = process.argv.slice(2);
let widths = [375, 390, 428];
let routes = null;
let expand = ".item-hit";
let base = "http://localhost:5173";
// The camera stage (#13) is a new full-bleed surface, and its live layout is
// the one worth checking — a viewfinder that failed to open is a centred
// paragraph, which overflows nothing. Chrome gets a synthetic device.
let camera = false;
const cookies = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--widths") widths = argv[++i].split(",").map(Number);
  else if (a === "--camera") camera = true;
  else if (a === "--routes") routes = argv[++i].split(",");
  // click these before measuring — a plain navigation never reaches the
  // confirm sheet's per-item editor, which is where the four number inputs
  // named as #51's prime suspect actually render
  else if (a === "--expand") expand = argv[++i];
  else if (a === "--cookie") {
    const raw = argv[++i];
    const eq = raw.indexOf("=");
    cookies.push({ name: raw.slice(0, eq), value: raw.slice(eq + 1) });
  } else base = a.replace(/\/$/, "");
}

// Every screen is behind auth; without a cookie they all render the sign-in
// screen, so checking six of them would be checking one thing six times.
if (!routes) {
  routes = cookies.length
    ? [
        "/",
        "/log",
        "/log#barcode",
        "/log#text",
        // #82's panel. The picks list has always been checked here through
        // /log#text, but the panel is the placement with the pressure on it —
        // a bottom sheet over a live viewfinder, holding rows whose names are
        // long enough to have needed an ellipsis since #92.
        "/log#picks",
        "/log#confirm",
        // #95's stage. The portion row only renders for a barcode read, so
        // this is the only route that draws the three-column grid — and the
        // field the bug report names by name had nothing that could reach it.
        "/log#portion",
        // #81's basket: three captures, four foods, two sources. The tallest
        // the confirm sheet gets, and the only state where its footer holds
        // two controls side by side — "+ Add another" beside `Log N kcal`,
        // which is the row most likely to push past the edge at 375. Also the
        // only sheet whose rows carry mixed provenance, so each one draws its
        // own label under the name.
        "/log#basket",
        // #59's correction, open with a note typed into it. The one state in
        // the app where a textarea and two buttons sit *inside* the item list
        // rather than in a footer, so it is the sheet at its tallest with a
        // field in the middle of it — and `.correct-acts` is a second `auto 1fr`
        // row whose primary label ("Reading it again…") is longer than the
        // control it shares the row with.
        "/log#correct",
        "/#saved",
        // #52's revealed row. The only state in the app deliberately parked
        // past the right edge — the delete control sits outside `.swipe` and
        // is clipped by its overflow — so it is the one screen where the
        // clipping probe is checking a real risk rather than a hypothetical
        // one. Still true after #91 shrank the control to 32px: closed, it is
        // one own-width past the row's right edge, which at 375 is 10px past
        // the viewport.
        "/#swiped",
        // #60's edit sheet, opened on the day's LARGEST entry. It is the
        // tallest sheet the app draws — a three-item meal has three rows, a
        // totals line and a save button where the confirm sheet has the same
        // plus nothing above it — and the issue names this check by name: the
        // totals row and the save button have to survive at 375. It is also
        // the only sheet whose height comes from stored data rather than from
        // a fixture, so what it measures is whatever is actually logged.
        "/#editing",
        "/trends",
        // #22's staged empty states. They aren't cosmetic variants — each
        // swaps a chart for a paragraph, which is a different layout, and the
        // sparse one is the only route that renders a bar list with a
        // single-digit coverage label in it.
        "/trends#empty",
        "/trends#sparse",
        "/settings",
        // M4's task screens (#17, #18) — both are long forms, which is the
        // shape most likely to push a field past the edge at 375
        "/onboarding",
        "/weight",
      ]
    : ["/"];
}

// Runs in the page. Reports the document's overflow plus the elements whose
// box actually crosses the viewport edge — children of an overflowing parent
// all report, so the shortest paths listed first are the ones to look at.
const PROBE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const path = (el) => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += "#" + n.id;
      if (typeof n.className === "string" && n.className.trim()) {
        s += "." + n.className.trim().split(/\\s+/).join(".");
      }
      bits.unshift(s);
    }
    return bits.join(" > ");
  };
  /* An element parked past the edge INSIDE a clipping ancestor is not an
     overflow — it cannot be seen, scrolled to, or tapped. #52's swipe panel
     lives exactly there: it is parked one own-width beyond the row's right
     edge and slides in over the row when the gesture opens it (#91 — the row
     itself no longer moves), held back by an overflow-hidden .swipe. Six
     screens failed this check the day that landed, all of them correct.
     (No backticks in this comment — it lives inside a template literal.)

     The clip has to actually contain the element, so the ancestor's own right
     edge must be inside the viewport — otherwise a scroller that is ITSELF
     overflowing would hide everything inside it, which is the bug this file
     exists to find. The tab bar case still fails as before: it is fixed and has
     no clipping ancestor. */
  const clipped = (el, vw) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o !== "visible" && Math.round(n.getBoundingClientRect().right) <= vw + 1) return true;
    }
    return false;
  };
  const offenders = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    const past = Math.round(Math.max(r.right - vw, -r.left));
    if (past > 1 && !clipped(el, vw)) {
      offenders.push({ past, width: Math.round(r.width), path: path(el) });
    }
  }
  offenders.sort((a, b) => b.past - a.past || a.path.length - b.path.length);
  return { vw, scrollWidth: de.scrollWidth, offenders: offenders.slice(0, 8) };
})()`;

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
}

console.log(`\nhorizontal overflow checks against ${base}`);
console.log(`  widths ${widths.join("/")} · ${cookies.length ? "signed in" : "signed out"}\n`);

await withChrome(async (cdp) => {
  const page = await openPage(cdp);
  await cdp.send("Network.enable", {}, page.sessionId);
  for (const c of cookies) {
    await cdp.send("Network.setCookie", { ...c, url: base, path: "/" }, page.sessionId);
  }

  for (const width of widths) {
    for (const route of routes) {
      await page.navigate(base + route);
      await cdp.send(
        "Emulation.setDeviceMetricsOverride",
        { width, height: 844, deviceScaleFactor: 2, mobile: true },
        page.sessionId,
      );
      await settle(cdp, page.sessionId);
      // the screens fetch their own data; measuring mid-flight measures an
      // empty page, which never overflows and would pass vacuously
      await new Promise((r) => setTimeout(r, 700));
      if (expand) {
        const opened = await evaluate(
          cdp,
          page.sessionId,
          `(() => { const n = document.querySelectorAll(${JSON.stringify(expand)});
                    n.forEach((el) => el.click()); return n.length })()`,
        );
        if (opened) await new Promise((r) => setTimeout(r, 300));
      }
      const { vw, scrollWidth, offenders } = await evaluate(cdp, page.sessionId, PROBE);
      // Both halves matter. scrollWidth catches in-flow overflow; the offender
      // list catches the rest, because a position:fixed element that crosses
      // the edge does NOT move documentElement.scrollWidth — the tab bar is
      // fixed, so on scrollWidth alone it could overflow silently.
      check(
        `${String(width).padStart(3)} ${route}`,
        scrollWidth <= vw && offenders.length === 0,
        `content ${scrollWidth}px in ${vw}px`,
      );
      for (const o of offenders) console.log(`        ↳ ${o.past}px past the edge · ${o.path}`);
    }
  }
}, camera ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : []);

console.log(
  failures === 0
    ? "\nno screen overflows its viewport\n"
    : `\n${failures} screen(s) overflow horizontally — see #51\n`,
);
process.exit(failures === 0 ? 0 : 1);
