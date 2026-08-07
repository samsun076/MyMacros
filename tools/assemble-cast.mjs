#!/usr/bin/env node
// tools/assemble-cast.mjs — turn a screencast recording into a phone-framed
// GIF (for the README) and MP4 (better quality, for anywhere that plays video).
//
//   node tools/assemble-cast.mjs --in shots/cast --out shots/demo
//
// Three jobs:
//
// 1. REBUILD TIMING. Screencast frames arrive only when the page changes, so
//    the frame list is not a fixed-rate video — a still second is one frame,
//    an animating one is sixty. ffmpeg's concat demuxer takes an explicit
//    duration per frame, so real timing is reconstructed from the recorded
//    timestamps rather than guessed from a frame count. Long gaps are clamped
//    (MAX_HOLD) so a slow Anthropic call doesn't leave the viewer staring at a
//    spinner; short ones are left alone.
//
// 2. FRAME IT. A 375px-wide viewport on its own reads as a cropped desktop
//    page, not a phone. Two PNGs are rendered in Chrome — the background with
//    the phone body, and a bezel ring that goes over the video to round off
//    its square corners — and the video is sandwiched between them. Chrome
//    rather than an image library because every tool here is zero-npm-dep
//    Node + Chrome, and CSS draws a rounded bezel better than either.
//
// 3. SHOW THE TAPS. Nothing in a screen recording says a finger arrived; the
//    UI just changes on its own. A ripple is drawn at each recorded tap.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { connect, launchChrome, openPage, settle } from "./cdp.mjs";

const run = promisify(execFile);

const argv = process.argv.slice(2);
let inDir = "shots/cast";
let outBase = "shots/demo";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--in") inDir = argv[++i];
  else if (argv[i] === "--out") outBase = argv[++i];
}

// ── geometry ─────────────────────────────────────────────────────────────
const SCREEN_W = 340; // app width in the finished image
const BEZEL = 11;
const MARGIN = 20;
const RADIUS = 30; // screen corner radius
const PAGE_BG = "#0d1117"; // GitHub's dark canvas — reads as a card on light
const BODY = "#05070a";
// Seconds any single frame may hold — a backstop for a pathological stall,
// not a pacing knob. After deduping, a static stretch is ONE frame, and the
// only static stretches left are the recorder's deliberate beats: the pause on
// Today, the viewfinder before the shutter, the sheet you're meant to read.
// Clamping those is clamping the pacing the recorder chose on purpose, which
// cost two rebuilds to work out — at 1.1s the demo lost 4 seconds of its
// beats and read as frantic. The genuinely slow part (waiting on Claude)
// animates a spinner, so it never looks static and never hits this cap; it is
// handled by ANALYZE_MAX instead.
const MAX_HOLD = 2.8;
const ANALYZE_MAX = 1.6; // seconds the "reading the photo" window may occupy
const TAIL = 1.8; // how long the final frame — the payoff — stays up
const FPS = 13;

const cast = JSON.parse(await readFile(join(inDir, "frames.json"), "utf8"));
const SCREEN_H = Math.round((SCREEN_W * cast.height) / cast.width / 2) * 2;
const PHONE_W = SCREEN_W + BEZEL * 2;
const PHONE_H = SCREEN_H + BEZEL * 2;
const CANVAS_W = PHONE_W + MARGIN * 2;
const CANVAS_H = PHONE_H + MARGIN * 2;
const SCREEN_X = MARGIN + BEZEL;
const SCREEN_Y = MARGIN + BEZEL;
const k = SCREEN_W / cast.width; // CSS px in the recording → px in the output

// ── 1. timing ────────────────────────────────────────────────────────────
// The recorder re-issues startScreencast on a timer (Chrome stops emitting
// after a route change), and each re-issue tends to resend the current frame.
// Those duplicates cost nothing visually but they do inflate the timeline,
// because each one claims its own slice of time. Drop byte-identical
// neighbours and let the frame before them hold that time instead.
const raw = cast.frames;
const seen = [];
for (const f of raw) {
  const bytes = await readFile(join(inDir, f.file));
  const prev = seen.at(-1);
  if (prev && prev.bytes.equals(bytes)) continue;
  seen.push({ ...f, bytes });
}
const fr = seen.map(({ bytes, ...f }) => f);
if (fr.length !== raw.length) {
  console.log(`deduped: ${raw.length} → ${fr.length} frames (${raw.length - fr.length} repeats)`);
}

// The one window that gets time-scaled rather than held: waiting on Claude.
// It's a spinner, so it animates and never looks like dead air, but it ran
// 3–5s in every recording and swallowed half the finished GIF. Real latency
// belongs in the caption, not in a hero image — the sheet still says how long
// the read actually took, so nothing is being hidden.
const mark = (l) => cast.marks?.find((m) => m.label === l)?.t;
const aStart = mark("analyzing-start");
const aEnd = mark("analyzing-end");
const analyzing = (t) => aStart != null && aEnd != null && t >= aStart && t < aEnd;
let squeeze = 1;
if (aStart != null && aEnd != null) {
  const real = (aEnd - aStart) / 1000;
  squeeze = real > ANALYZE_MAX ? ANALYZE_MAX / real : 1;
  console.log(`analyzing: ${real.toFixed(1)}s real → ${(real * squeeze).toFixed(1)}s on screen`);
}

let total = 0;
const durations = [];
const lines = [];
for (let i = 0; i < fr.length; i++) {
  // A frame's duration is the gap to the NEXT frame — which leaves the last
  // one with nothing to measure against. It is also the most important frame
  // in the demo: the recorder holds on the updated Today screen for the final
  // beat, that hold dedupes down to this single frame, and a small default
  // threw the payoff away in under half a second.
  const next = i + 1 < fr.length ? fr[i + 1].t : fr[i].t + TAIL * 1000;
  let d = Math.max(0.016, Math.min(MAX_HOLD, (next - fr[i].t) / 1000));
  if (analyzing(fr[i].t)) d *= squeeze;
  total += d;
  durations.push(d);
  lines.push(`file '${fr[i].file}'`, `duration ${d.toFixed(3)}`);
}
lines.push(`file '${fr.at(-1).file}'`);
await writeFile(join(inDir, "concat.txt"), lines.join("\n"));
console.log(`timeline: ${total.toFixed(1)}s from ${fr.length} frames`);

// ── 2. chrome-rendered furniture ─────────────────────────────────────────
const work = await mkdtemp(join(tmpdir(), "mymacros-assemble-"));

/** Screenshot one snippet of HTML on a transparent canvas. */
async function render(cdp, page, html, w, h, file) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: w, height: h, deviceScaleFactor: 1, mobile: false },
    page.sessionId,
  );
  await cdp.send(
    "Emulation.setDefaultBackgroundColorOverride",
    { color: { r: 0, g: 0, b: 0, a: 0 } },
    page.sessionId,
  );
  await cdp.send(
    "Page.navigate",
    { url: "data:text/html;charset=utf-8," + encodeURIComponent(html) },
    page.sessionId,
  );
  await cdp.once("Page.loadEventFired", page.sessionId);
  await settle(cdp, page.sessionId);
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    page.sessionId,
  );
  await writeFile(file, Buffer.from(data, "base64"));
}

const shell = (body) =>
  `<!doctype html><meta charset=utf-8><style>
   *{margin:0;padding:0;box-sizing:border-box}
   html,body{width:${CANVAS_W}px;height:${CANVAS_H}px;background:transparent;overflow:hidden}
   </style>${body}`;

const backHtml = shell(`<div style="
   position:absolute;inset:0;background:
     radial-gradient(120% 80% at 50% 0%, #141c27 0%, ${PAGE_BG} 62%);"></div>
 <div style="
   position:absolute;left:${MARGIN}px;top:${MARGIN}px;
   width:${PHONE_W}px;height:${PHONE_H}px;
   background:${BODY};border-radius:${RADIUS + BEZEL}px;
   box-shadow:0 18px 44px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07);"></div>`);

// Transparent inside the screen, phone-coloured for exactly the bezel width,
// transparent past that — so it can be laid over the video to round off its
// square corners without touching the background.
const frontHtml = shell(`<div style="
   position:absolute;left:${SCREEN_X}px;top:${SCREEN_Y}px;
   width:${SCREEN_W}px;height:${SCREEN_H}px;
   border-radius:${RADIUS}px;
   box-shadow:0 0 0 ${BEZEL}px ${BODY}, inset 0 0 0 1px rgba(255,255,255,.06);"></div>`);

const RIPPLE = 60;
const rippleHtml = `<!doctype html><meta charset=utf-8><style>
  *{margin:0;padding:0}html,body{width:${RIPPLE}px;height:${RIPPLE}px;background:transparent;overflow:hidden}
  </style><div style="width:${RIPPLE}px;height:${RIPPLE}px;border-radius:50%;
    background:radial-gradient(circle, rgba(255,255,255,.42) 0%, rgba(255,255,255,.20) 46%, rgba(255,255,255,0) 68%);
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.55);"></div>`;

const profileDir = await mkdtemp(join(tmpdir(), "mymacros-assemble-chrome-"));
const { proc, wsUrl } = await launchChrome(profileDir, []);
const cdp = await connect(wsUrl);
try {
  const page = await openPage(cdp);
  await render(cdp, page, backHtml, CANVAS_W, CANVAS_H, join(work, "back.png"));
  await render(cdp, page, frontHtml, CANVAS_W, CANVAS_H, join(work, "front.png"));
  await render(cdp, page, rippleHtml, RIPPLE, RIPPLE, join(work, "ripple.png"));
} finally {
  cdp.close();
  const exited = new Promise((res) => proc.on("exit", res));
  proc.kill();
  await exited;
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
console.log(`furniture: ${CANVAS_W}×${CANVAS_H}, screen ${SCREEN_W}×${SCREEN_H}`);

// ── 3. composite ─────────────────────────────────────────────────────────
// Recorded tap times are on the recording's clock; the concat pass compressed
// long holds, so map each tap through the same clamping to land on the frame
// it actually belongs to.
const remap = (t) => {
  let acc = 0;
  for (let i = 0; i < fr.length; i++) {
    if (fr[i].t >= t) return acc;
    acc += durations[i];
  }
  return acc;
};

// Render the app video on its own first, purely to learn how long it is.
// Bounding the composite is otherwise guesswork: the three pieces of
// furniture are `-loop 1` inputs that never end, and neither `-shortest` nor
// `overlay=shortest=1` stopped the encode (it reached 38MB and was still
// going). Deriving the length from my own duration sum was worse — it
// disagreed with ffmpeg's concat clock and cut the video off before the save.
// One cheap pass measures it instead of predicting it.
const appMp4 = join(work, "app.mp4");
await run("ffmpeg", [
  "-y", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", join(inDir, "concat.txt"),
  "-vf", `scale=${SCREEN_W}:${SCREEN_H}:flags=lanczos`,
  "-fps_mode", "cfr", "-r", String(FPS), "-pix_fmt", "yuv420p", "-crf", "18",
  appMp4,
]);
const appDur = Number(
  (
    await run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", appMp4,
    ])
  ).stdout.trim(),
);
// A short freeze on the payoff before the loop restarts — the looped stills
// hold the last app frame, so this costs one frame of content.
const OUT_DUR = appDur + 0.7;
console.log(`app video: ${appDur.toFixed(1)}s (+0.7s hold) → ${OUT_DUR.toFixed(1)}s`);

const chain = [
  `[1:v][0:v]overlay=${SCREEN_X}:${SCREEN_Y}[withapp]`,
  `[withapp][2:v]overlay=0:0[framed]`,
];
let last = "framed";
cast.taps.forEach((tap, i) => {
  const t = remap(tap.t);
  const x = Math.round(SCREEN_X + tap.x * k - RIPPLE / 2);
  const y = Math.round(SCREEN_Y + tap.y * k - RIPPLE / 2);
  const label = i === cast.taps.length - 1 ? "out" : `r${i}`;
  chain.push(
    `[${last}][3:v]overlay=${x}:${y}:enable='between(t,${t.toFixed(2)},${(t + 0.42).toFixed(2)})'[${label}]`,
  );
  last = label;
});
if (last !== "out") chain.push(`[${last}]null[out]`);

await mkdir(resolve(outBase, ".."), { recursive: true });
const mp4 = `${outBase}.mp4`;
await run("ffmpeg", [
  "-y", "-loglevel", "error",
  "-i", appMp4,
  "-loop", "1", "-i", join(work, "back.png"),
  "-loop", "1", "-i", join(work, "front.png"),
  "-loop", "1", "-i", join(work, "ripple.png"),
  "-filter_complex", chain.join(";"),
  "-map", "[out]",
  "-t", OUT_DUR.toFixed(2),
  "-fps_mode", "cfr", "-r", String(FPS),
  "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart",
  mp4,
]);

const gif = `${outBase}.gif`;
await run("ffmpeg", [
  "-y", "-loglevel", "error", "-i", mp4,
  "-filter_complex",
  `fps=${FPS},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
  gif,
]);

const size = async (f) => (await run("du", ["-h", f])).stdout.split("\t")[0].trim();
console.log(`\n✓ ${mp4}  ${await size(mp4)}`);
console.log(`✓ ${gif}  ${await size(gif)}`);
await rm(work, { recursive: true, force: true }).catch(() => {});
