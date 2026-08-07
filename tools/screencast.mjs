#!/usr/bin/env node
// tools/screencast.mjs — record the log flow as a timed sequence of frames.
//
//   node tools/screencast.mjs --cookie better-auth.session_token=... \
//     --video /path/to/meal.y4m --out /path/to/frames
//
// Companion to shot-matrix.mjs, and the inverse of it in one important way:
// shot-matrix wants stillness (it forces prefers-reduced-motion so a PNG is
// never caught mid-transition), while this wants the motion — the whole point
// is the ~10 seconds between pointing the camera at a plate and seeing the
// meal land in the timeline. So it calls openPage with reduceMotion:false.
//
// The camera. `--use-fake-device-for-media-stream` alone gives Chrome's
// built-in synthetic source, which is a rolling colour-bar test pattern: fine
// for proving a viewfinder opened, useless for a demo of photographing food.
// `--use-file-for-fake-video-capture` replaces it with a real y4m, so the
// viewfinder shows an actual plate and the photo that reaches Claude is a
// photo of dinner. Photo mode asks getUserMedia for a square stream
// (CameraStage constraintsFor), so feed it a square y4m or it letterboxes.
//
// Output is frames/NNNN.jpg plus frames.json — every frame with the timestamp
// Chrome reported, and the taps, so the assembler can rebuild real timing and
// draw tap indicators. Screencast frames arrive only when something changes,
// so a static second produces one frame, not sixty; durations live in the
// manifest rather than in a frame count.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect, launchChrome, openPage, settle, evaluate, waitFor } from "./cdp.mjs";

const WIDTH = 375; // the reference width — build rule 6
const HEIGHT = 812;
const SCALE = 2; // retina, so the GIF can be downsampled and stay crisp

const argv = process.argv.slice(2);
let base = "http://localhost:5173";
let out = "shots/cast";
let video = null;
let at = null; // "19:20" — pretend it's this time of day
const cookies = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--base") base = argv[++i];
  else if (argv[i] === "--out") out = argv[++i];
  else if (argv[i] === "--video") video = argv[++i];
  else if (argv[i] === "--at") at = argv[++i];
  else if (argv[i] === "--cookie") {
    const raw = argv[++i];
    const eq = raw.indexOf("=");
    cookies.push({ name: raw.slice(0, eq), value: raw.slice(eq + 1) });
  }
}

const profileDir = await mkdtemp(join(tmpdir(), "mymacros-cast-"));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const { proc, wsUrl } = await launchChrome(profileDir, [
  "--use-fake-ui-for-media-stream", // auto-grant, no permission prompt
  "--use-fake-device-for-media-stream",
  ...(video ? [`--use-file-for-fake-video-capture=${video}`] : []),
  "--autoplay-policy=no-user-gesture-required",
]);
const cdp = await connect(wsUrl);

const frames = [];
const taps = [];
// Phase boundaries. The assembler needs these because one stretch of this
// recording is honest but unwatchable: waiting on Claude is several seconds of
// an animating spinner, which produces frames continuously and so cannot be
// compressed as "dead air". Marking where it starts and ends lets that window
// alone be sped up, without touching the beats that are meant to breathe.
const marks = [];
let t0 = null;

try {
  const page = await openPage(cdp, { reduceMotion: false });
  const s = page.sessionId;

  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true },
    s,
  );
  await cdp.send("Network.enable", {}, s);
  for (const c of cookies) {
    await cdp.send("Network.setCookie", { ...c, url: new URL(base).origin, path: "/" }, s);
  }

  // Move the page's clock, and only the clock. Log.tsx picks the meal slot
  // from the hour and stamps the sheet's header with it, so a recording made
  // at 22:30 logs "SNACK · 10:29P" — a coherent demo of a day's eating wants
  // dinner at dinner time. The offset stays inside the same local day, so
  // `logged_on` is unaffected. Nothing else is staged: the photo is real, the
  // Anthropic call is real, and the macros are whatever the model returns.
  if (at) {
    const [hh, mm] = at.split(":").map(Number);
    const target = new Date();
    target.setHours(hh, mm, 0, 0);
    const offset = target.getTime() - Date.now();
    await cdp.send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `(() => {
          const OFFSET = ${offset};
          const Real = Date;
          class Shifted extends Real {
            constructor(...a) { a.length === 0 ? super(Real.now() + OFFSET) : super(...a); }
            static now() { return Real.now() + OFFSET; }
          }
          globalThis.Date = Shifted;
        })();`,
      },
      s,
    );
  }

  // ── helpers ────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Centre of an element, in CSS pixels. Null when it isn't there. */
  const centre = (sel) =>
    evaluate(
      cdp,
      s,
      `(() => { const e = document.querySelector(${JSON.stringify(sel)});
                if (!e) return null;
                const r = e.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );

  /** Tap an element and record where, so the assembler can draw the ripple.
   *  Mouse events rather than touch: every control here is a plain <button>
   *  with onClick, and mouse events are what React's synthetic handler sees
   *  without a full touch sequence. */
  async function tap(sel, label) {
    const p = await waitFor(cdp, s, `!!document.querySelector(${JSON.stringify(sel)})`, {
      timeout: 15000,
      label: label ?? sel,
    }).then(() => centre(sel));
    if (!p) throw new Error(`no element for ${sel}`);
    taps.push({ t: Date.now() - t0, x: p.x, y: p.y, label: label ?? sel });
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type, x: p.x, y: p.y, button: "left", clickCount: 1 },
        s,
      );
    }
    console.log(`  tap  ${label ?? sel}`);
  }

  // ── set the stage before recording starts ──────────────────────────────
  await page.navigate(base + "/");
  await settle(cdp, s);
  await waitFor(cdp, s, `!!document.querySelector('.tabbar')`, { label: "Today" });
  await sleep(600);

  // ── record ─────────────────────────────────────────────────────────────
  t0 = Date.now();
  cdp.on(
    "Page.screencastFrame",
    async (p) => {
      frames.push({ t: Date.now() - t0, data: p.data });
      // Unacked frames stop the stream dead — ack even while we're busy.
      await cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }, s).catch(() => {});
    },
    s,
  );
  await cdp.send(
    "Page.startScreencast",
    { format: "jpeg", quality: 92, maxWidth: WIDTH * SCALE, maxHeight: HEIGHT * SCALE },
    s,
  );

  // Chrome stops emitting screencast frames when the page swaps its layer
  // tree, which react-router's route change does — measured: both early
  // recordings ended 88ms after the save tap, mid-way through Today's loading
  // state, with the payoff never captured. Re-issuing startScreencast is
  // cheap and idempotent, so just do it on a timer and the stream heals
  // itself rather than needing to know which interactions kill it.
  const keepAlive = setInterval(() => {
    void cdp
      .send(
        "Page.startScreencast",
        { format: "jpeg", quality: 92, maxWidth: WIDTH * SCALE, maxHeight: HEIGHT * SCALE },
        s,
      )
      .catch(() => {});
  }, 400);

  console.log("recording…");
  await sleep(1400); // beat on Today: 1,030 of 1,810, dinner still open

  await tap('button[aria-label="Log food"]', "log button");
  await waitFor(cdp, s, `!!document.querySelector('video.cam-video.on')`, {
    timeout: 20000,
    label: "live viewfinder",
  });
  await sleep(1800); // let the viewfinder breathe — this is the shot that sells it

  await tap('button[aria-label="Take photo"]', "shutter");
  // The analyzing state: a real Anthropic call against the real photo.
  marks.push({ t: Date.now() - t0, label: "analyzing-start" });
  await waitFor(cdp, s, `!!document.querySelector('.sheet[role="dialog"]')`, {
    timeout: 60000,
    label: "confirm sheet",
  });
  marks.push({ t: Date.now() - t0, label: "analyzing-end" });
  await sleep(2600); // read the items, the confidence, the totals

  await tap("button.save", "save");
  // Waiting for "the sheet is gone" lands in Today's data-pending window — the
  // screen is a header and a toast with no budget, no macros and no timeline,
  // because /api/day hasn't answered yet. That empty frame was the last thing
  // in the first recording. Wait for the *fourth* timeline row instead: three
  // seeded meals plus the one just logged means the payoff is actually on
  // screen before the hold starts.
  await waitFor(cdp, s, `document.querySelectorAll('.tl .when').length >= 4`, {
    timeout: 20000,
    label: "the new meal in the timeline",
  });
  await sleep(2600); // the meter moves and the row lands — the payoff

  clearInterval(keepAlive);
  await cdp.send("Page.stopScreencast", {}, s);
  await sleep(250);

  // ── write ──────────────────────────────────────────────────────────────
  let i = 0;
  const manifest = [];
  for (const f of frames) {
    const name = `${String(i++).padStart(5, "0")}.jpg`;
    await writeFile(join(out, name), Buffer.from(f.data, "base64"));
    manifest.push({ file: name, t: f.t });
  }
  await writeFile(
    join(out, "frames.json"),
    JSON.stringify(
      { width: WIDTH, height: HEIGHT, scale: SCALE, frames: manifest, taps, marks },
      null,
      2,
    ),
  );

  const secs = ((frames.at(-1)?.t ?? 0) / 1000).toFixed(1);
  console.log(`\n✓ ${frames.length} frames over ${secs}s → ${out}`);
  console.log(`  taps: ${taps.map((t) => t.label).join(" → ")}`);
  const a = marks.find((m) => m.label === "analyzing-start");
  const b = marks.find((m) => m.label === "analyzing-end");
  if (a && b) console.log(`  Claude took ${((b.t - a.t) / 1000).toFixed(1)}s`);
} finally {
  cdp.close();
  const exited = new Promise((res) => proc.on("exit", res));
  proc.kill();
  await exited;
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
