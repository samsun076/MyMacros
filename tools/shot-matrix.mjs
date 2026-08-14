#!/usr/bin/env node
// Design-QA screenshot matrix (issue #31).
//
// Renders mockup HTML files at iPhone widths via headless Chrome and writes:
//   shots/<name>@<width>.png          one full-page shot per width
//   shots/<name>-matrix.png           side-by-side sheet with fold lines
//
// Usage:
//   node tools/shot-matrix.mjs                          # every sketches/*.html
//   node tools/shot-matrix.mjs sketches/c2-night-athletic.html
//   node tools/shot-matrix.mjs "sketches/e-log-flow.html#confirm"   # hash = flow stage
//   node tools/shot-matrix.mjs --widths 375,390 file.html
//
// Live app screens (every one of them is behind auth, so pass a session
// cookie — `npm run dev` in another terminal):
//   node tools/shot-matrix.mjs --cookie better-auth.session_token=... \
//     http://localhost:5173/ http://localhost:5173/settings
//
// 375 (iPhone 13 mini) is the reference width — nothing is "done" until it
// passes here. The dashed line on the sheet marks that device's fold
// (logical viewport height). Zero npm deps: Node ≥22 (native WebSocket) + Chrome.
//
// The camera stage (#13) needs a camera, and headless Chrome has none — it
// falls back to the "no viewfinder" state, which is a real screen but not the
// primary one. --camera gives Chrome a synthetic video source and auto-grants
// the permission, so the live viewfinder is shootable too:
//   node tools/shot-matrix.mjs --camera --settle 900 --cookie ... http://localhost:5173/log
//
// --settle <ms> waits that long after fonts and two frames, for anything on
// its own clock that settle() cannot see — a camera stream coming up, a
// screen's own fetch landing.
//
// Limits: Chrome reports env(safe-area-inset-*) as 0 and can't reproduce iOS
// Safari's chrome tinting — verify those in the Xcode Simulator (tier 2 in #31).

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { glob } from "node:fs/promises";
import { connect, launchChrome, openPage, settle } from "./cdp.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

// width → logical viewport height of the matching device (fold line)
const DEVICES = { 375: 812, 390: 844, 428: 926 };
const OUT_DIR = "shots";

// ── args ─────────────────────────────────────────────
const argv = process.argv.slice(2);
let widths = Object.keys(DEVICES).map(Number);
const files = [];
const cookies = [];
let camera = false;
let videoFile = null;
// Extra wait after fonts+frames, for anything that settles on its own clock:
// a camera stream coming up, a fetch the screen fires itself. settle() can't
// see either — it waits for document.fonts.ready and two frames, both of
// which happen long before.
let settleMs = 0;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--widths") widths = argv[++i].split(",").map(Number);
  else if (argv[i] === "--camera") camera = true;
  else if (argv[i] === "--video") {
    videoFile = argv[++i];
    camera = true; // a feed with no camera is a contradiction
  }
  else if (argv[i] === "--settle") settleMs = Number(argv[++i]);
  else if (argv[i] === "--cookie") {
    const raw = argv[++i];
    const eq = raw.indexOf("=");
    cookies.push({ name: raw.slice(0, eq), value: raw.slice(eq + 1) });
  } else files.push(argv[i]);
}
if (files.length === 0) {
  for await (const f of glob("sketches/*.html")) {
    if (!/(^|\/)(index|compare)\.html$/.test(f)) files.push(f);
  }
  files.sort();
}
if (files.length === 0) {
  console.error("no input files");
  process.exit(1);
}

/** In-flight request count for a session, as a live number.
 *
 *  The honest "is this screen finished" signal, and the third one this file has
 *  needed: `settle()` sees fonts and two frames, `aria-busy` sees React mount,
 *  and neither sees the screen's own `/api/*` fetch — Today renders its header
 *  with `day === null` the instant it mounts, so a height measured then is a
 *  page with no budget, no macros and no timeline on it. Which is exactly what
 *  got shot: 812px, the viewport, header only.
 *
 *  A counter rather than CDP's `networkIdle` lifecycle event, because that
 *  event may have already fired by the time anything subscribes and then never
 *  comes again — a wait that hangs forever on the fast path. */
function trackInflight(cdp, sessionId) {
  const open = new Set();
  cdp.on("Network.requestWillBeSent", (p) => open.add(p.requestId), sessionId);
  for (const done of ["Network.loadingFinished", "Network.loadingFailed"]) {
    cdp.on(done, (p) => open.delete(p.requestId), sessionId);
  }
  return {
    count: () => open.size,
    // A navigation starts a new page; ids from the old one never resolve.
    reset: () => open.clear(),
  };
}

async function fullPageShot(cdp, sessionId, width, inflight) {
  const setMetrics = (w, h) =>
    cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: w, height: h, deviceScaleFactor: 2, mobile: true },
      sessionId,
    );
  await setMetrics(width, DEVICES[width] ?? 844);
  await settle(cdp, sessionId);
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));

  const evalIn = async (expression) => {
    const { result } = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sessionId,
    );
    return result.value;
  };
  const measure = async () => Math.min(await evalIn("document.documentElement.scrollHeight"), 6000);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  /* **Wait for the app, then for its data, then shoot** (#29, #80).
   *
   * This used to measure `scrollHeight` once and shoot at that height.
   * `settle()` waits for `document.fonts.ready` and two frames — both of which
   * happen long before React mounts, let alone before a screen's own `/api/*`
   * fetch lands — so whatever had not rendered yet was **silently cropped off
   * the bottom of the PNG**. Nothing failed; the design loop simply reviewed a
   * page with its end cut off, on whichever width lost the race.
   *
   * Two separate misses, and the first fix only caught the second:
   *
   *   - Settings at 375 came out 1932px and stopped mid-page while 390, shot
   *     second against a warm cache, was complete at 2248px. Late data.
   *   - Today came out 812px — exactly the viewport — because the *app* had
   *     not mounted at all. A grow-loop cannot see that: the height is stable,
   *     it is stable at the boot skeleton's.
   *
   * So the signal is the skeleton's own `aria-busy`, which index.html and
   * App.tsx both already set while the session is pending, followed by a
   * height that stops moving across a real delay rather than across two
   * frames. Neither is app code added for the tool's benefit — both already
   * existed and say exactly what is needed. */
  const mounted = await (async () => {
    for (let i = 0; i < 60; i++) {
      if (!(await evalIn(`!!document.querySelector('[aria-busy="true"]')`))) return true;
      await pause(100);
    }
    return false;
  })();
  if (!mounted) console.warn(`  ! ${width}px still aria-busy after 6s — shooting a loading state`);

  /* Then wait for the screen's own fetches. Idle means zero in flight and
     still zero a beat later, since one response commonly starts the next. */
  let quiet = 0;
  for (let i = 0; i < 80 && quiet < 3; i++) {
    quiet = inflight?.count() === 0 ? quiet + 1 : 0;
    await pause(60);
  }
  if (inflight && inflight.count() > 0) {
    console.warn(`  ! ${width}px still has ${inflight.count()} request(s) in flight`);
  }

  if (settleMs) await pause(settleMs);

  /* Belt to the above: height stable across a real delay, not across two
     frames. Three consecutive equal readings, because one equal pair is
     satisfied by any pause between two renders. */
  let pageH = await measure();
  let stable = 0;
  for (let i = 0; i < 30 && stable < 3; i++) {
    await pause(120);
    const again = await measure();
    stable = again === pageH ? stable + 1 : 0;
    pageH = again;
  }

  /* Grow the viewport to full content height so fixed chrome lands at the true
   * bottom — like the page seen end to end. That itself can change the height
   * (a `min-height: 100vh`, a sticky footer resolving against the new box), so
   * re-measure and repeat while it moves. */
  for (let i = 0; i < 5; i++) {
    await setMetrics(width, pageH);
    await settle(cdp, sessionId);
    const again = await measure();
    if (again <= pageH) break;
    pageH = again;
    if (i === 4) console.warn(`  ! ${width}px height still growing at ${pageH}px — shot may be clipped`);
  }

  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  return { png: Buffer.from(data, "base64"), height: pageH };
}

function sheetHtml(name, shots) {
  const cols = shots
    .map(
      ({ width, file, height }) => `
    <figure>
      <figcaption>${width}×${DEVICES[width] ?? "—"}${width === 375 ? " · REFERENCE" : ""}</figcaption>
      <div class="shot" style="width:${width * 2}px">
        <img src="${file}" width="${width * 2}">
        ${DEVICES[width] ? `<i class="fold" style="top:${DEVICES[width] * 2}px"></i>` : ""}
      </div>
    </figure>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #06090e; font: 600 22px/1 ui-monospace, monospace;
           color: #8a97ac; padding: 28px; }
    h1 { font-size: 26px; font-weight: 600; letter-spacing: .06em; margin: 0 0 22px; color: #dfe6ee; }
    main { display: flex; gap: 36px; align-items: flex-start; }
    figure { margin: 0; }
    figcaption { margin-bottom: 12px; letter-spacing: .08em; }
    .shot { position: relative; outline: 1px solid #2a3547; }
    img { display: block; }
    .fold { position: absolute; left: 0; right: 0; border-top: 3px dashed rgba(248,139,104,.55); }
    .fold::after { content: "FOLD"; position: absolute; right: 6px; top: 4px;
                   font: 700 18px ui-monospace, monospace; color: rgba(248,139,104,.8);
                   font-style: normal; }
  </style><h1>${name}</h1><main>${cols}</main>`;
}

const TIMEOUT_MS = Number(process.env.SHOT_TIMEOUT_MS || 30000);
function deadline(promise, what) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`timed out after ${TIMEOUT_MS}ms: ${what}`)), TIMEOUT_MS),
    ),
  ]);
}

// ── main ─────────────────────────────────────────────
await mkdir(OUT_DIR, { recursive: true });
const profileDir = await mkdtemp(join(tmpdir(), "shot-matrix-"));
const { proc, wsUrl } = await launchChrome(
  profileDir,
  // a rolling synthetic pattern as the camera, and the permission granted
  // without a prompt — headless Chrome has no real device to offer.
  // --video swaps that pattern for a real y4m, which is the difference
  // between a screenshot that proves the viewfinder opened and one that shows
  // the app doing its job. Photo mode asks for a square stream, so feed it a
  // square file (see tools/screencast.mjs).
  camera
    ? [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        ...(videoFile ? [`--use-file-for-fake-video-capture=${videoFile}`] : []),
      ]
    : [],
);
const cdp = await connect(wsUrl);

try {
  const page = await openPage(cdp);

  // Always on, not only when cookies are set: `fullPageShot` waits on the
  // in-flight count to know a screen has finished fetching (#52).
  await cdp.send("Network.enable", {}, page.sessionId);
  const inflight = trackInflight(cdp, page.sessionId);

  if (cookies.length) {
    for (const c of cookies) {
      // scoped to the first input's origin — these are all one dev server
      await cdp.send(
        "Network.setCookie",
        { ...c, url: new URL(files[0]).origin, path: "/" },
        page.sessionId,
      );
    }
    console.log(`  (${cookies.length} cookie(s) set — shooting as a signed-in user)`);
  }

  for (const file of files) {
    const [path, hash] = file.split("#");
    const isUrl = /^https?:\/\//.test(path);
    // a URL has no filename, so name it after its route: / → app-home
    // The hash has to be in the name for URLs too, not just files: the log
    // flow's modes are addressable as /log#photo, #barcode and #text, so
    // shooting all three in one run silently overwrote a single app-log.png
    // and left two of the modes unshot.
    const name = isUrl
      ? "app-" +
        (new URL(path).pathname.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "home") +
        (hash ? `-${hash}` : "")
      : basename(path, ".html") + (hash ? `-${hash}` : "");
    const url = isUrl ? file : `file://${resolve(path)}${hash ? "#" + hash : ""}`;
    const shots = [];
    for (const width of widths) {
      // a page that crashes on render never fires load or resolves fonts.ready
      // — fail with the URL rather than hanging the design loop
      inflight.reset();
      await deadline(page.navigate(url), `navigate ${url}`);
      const { png, height } = await deadline(
        fullPageShot(cdp, page.sessionId, width, inflight),
        `render ${name}@${width}`,
      );
      const out = join(OUT_DIR, `${name}@${width}.png`);
      await writeFile(out, png);
      shots.push({ width, height, file: `file://${resolve(out)}` });
      console.log(`  ${out}  (${width}×${height})`);
    }
    // composite sheet, rendered by the same chrome
    const sheetPath = join(profileDir, `${name}-sheet.html`);
    await writeFile(sheetPath, sheetHtml(name, shots));
    const sheetW = widths.reduce((a, w) => a + w * 2, 0) + 36 * (widths.length - 1) + 56;
    const sheetH = Math.max(...shots.map((s) => s.height)) * 2 + 130;
    await page.navigate(`file://${sheetPath}`);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: sheetW, height: Math.min(sheetH, 14000), deviceScaleFactor: 1, mobile: false },
      page.sessionId,
    );
    await settle(cdp, page.sessionId);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, page.sessionId);
    const matrixOut = join(OUT_DIR, `${name}-matrix.png`);
    await writeFile(matrixOut, Buffer.from(data, "base64"));
    console.log(`✓ ${matrixOut}`);
  }
} finally {
  cdp.close();
  const exited = new Promise((res) => proc.on("exit", res));
  proc.kill();
  await exited;
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
