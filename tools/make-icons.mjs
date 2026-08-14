#!/usr/bin/env node
// PWA icon + manifest generator (issue #8) — `npm run icons`.
//
// The mark is the product: the macro stack with the focus macro in accent,
// its budget running past the base target into a hatched earned zone. Drawn
// from design/tokens.css so the icon can never drift from the theme.
//
// The manifest is generated for the same reason: a web manifest can't
// reference a CSS custom property, so its background/theme colors would be
// the one place in the app with hardcoded hex (build rule 2). Generating it
// keeps design/tokens.css the only source of truth.
//
// Writes public/icons/ and public/manifest.webmanifest. Both are committed,
// so a normal build needs no Chrome.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openPage, settle, withChrome } from "./cdp.mjs";

const OUT_DIR = "public/icons";

/** iOS launch images (#53), portrait only — the manifest locks orientation.
 *
 *  This is the ONLY lever that reaches the window before the HTML exists.
 *  Everything else #53 does — inlined CSS, the boot skeleton, self-hosted
 *  fonts — needs the document to have arrived; iOS paints this frame while it
 *  is still being fetched, and with no `apple-touch-startup-image` that frame
 *  is white. The manifest's `background_color` is the standards answer and
 *  iOS's support for it is the open half of #39, so this is belt and braces
 *  rather than a duplicate: they are read by different code paths.
 *
 *  CSS points × dpr = the exact pixel size iOS demands; a mismatch is silently
 *  ignored, which is why the media query and the render size come from one row
 *  here rather than being written out twice. Every current iPhone plus the two
 *  older sizes that still run iOS.
 */
const LAUNCH = [
  { pt: [320, 568], dpr: 2 }, // SE (1st gen)
  { pt: [375, 667], dpr: 2 }, // SE 2/3, 6–8
  { pt: [414, 736], dpr: 3 }, // 8 Plus
  { pt: [375, 812], dpr: 3 }, // X, XS, 11 Pro, 12/13 mini
  { pt: [414, 896], dpr: 2 }, // XR, 11
  { pt: [414, 896], dpr: 3 }, // XS Max, 11 Pro Max
  { pt: [390, 844], dpr: 3 }, // 12, 13, 14
  { pt: [428, 926], dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { pt: [393, 852], dpr: 3 }, // 14 Pro, 15, 16
  { pt: [430, 932], dpr: 3 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { pt: [402, 874], dpr: 3 }, // 16 Pro
  { pt: [440, 956], dpr: 3 }, // 16 Pro Max
];

// full-bleed: iOS masks apple-touch-icon itself, Android "any" icons too.
// maskable: Android can crop to a circle, so keep the art inside the safe
// zone (content within the centre 80%).
const ICONS = [
  { file: "icon-32.png", size: 32, scale: 1 },
  { file: "icon-180.png", size: 180, scale: 1 }, // apple-touch-icon
  { file: "icon-192.png", size: 192, scale: 1 },
  { file: "icon-512.png", size: 512, scale: 1 },
  { file: "icon-maskable-512.png", size: 512, scale: 0.72 },
];

/** Pull the values we draw with straight out of the token pack. */
async function readTokens() {
  const css = await readFile("design/tokens.css", "utf8");
  const pack = css.slice(css.indexOf('[data-theme="night-athletic"]'));
  const get = (name) => {
    const m = pack.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`token --${name} not found in design/tokens.css`);
    return m[1].trim();
  };
  return {
    canvas: get("canvas"),
    bgTop: get("bg-top"),
    bg: get("bg"),
    bgBottom: get("bg-bottom"),
    track: get("track"),
    markNeutral: get("mark-neutral"),
    accent: get("accent"),
    accentSoft: get("accent-soft"),
    accentGlow: get("accent-glow"),
  };
}

function manifest(t) {
  return {
    name: "MyMacros",
    short_name: "MyMacros",
    description:
      "Photograph your food, AI fills in the macros, and your daily calorie budget breathes with your running.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // background_color is the launch splash. theme_color is set to --bg-top
    // so the manifest can't disagree with the token pack — but what iOS does
    // with it in standalone is unverified (#39), and all three candidates are
    // the same colour today, so nothing here proves anything either way.
    background_color: t.canvas,
    theme_color: t.bgTop,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

/** The mark: the macro stack, focus macro in accent, its budget bar running
 *  past the base target into a hatched earned zone. Both of the app's
 *  conventions in one figure — focus-macro colour, and the extended budget. */
function tileHtml(size, scale, t) {
  // every dimension is a proportion of the tile, so all sizes render alike
  const w = size * scale * 0.62;
  const barH = w * 0.155;
  const gap = w * 0.135;
  const radius = barH * 0.32;
  const hatch = Math.max(1.6, barH * 0.42);
  const tick = Math.max(1.4, barH * 0.16);
  // 32px is favicon territory — one bar survives, three don't
  const minimal = size <= 48;

  const bar = (fill, color, extra = "") => `
    <div class="bar"><i style="width:${fill}%;background:${color}"></i>${extra}</div>`;

  const earned = `<span class="earned"></span>`;

  return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    body { width: ${size}px; height: ${size}px; overflow: hidden; }
    .tile {
      width: ${size}px; height: ${size}px;
      display: grid; place-items: center;
      background:
        radial-gradient(120% 60% at 50% 0%, ${t.accentGlow} 0%, rgba(0,0,0,0) 70%),
        linear-gradient(180deg, ${t.bgTop} 0%, ${t.bg} 45%, ${t.bgBottom} 100%);
    }
    .stack { display: flex; flex-direction: column; gap: ${gap}px; width: ${w}px; }
    .bar {
      position: relative;
      height: ${barH}px;
      border-radius: ${radius}px;
      background: ${t.track};
    }
    .bar i {
      position: absolute; inset: 0 auto 0 0;
      border-radius: ${radius}px;
    }
    /* the earned extension — hatched, opened by a solid accent tick */
    .earned {
      position: absolute; top: 0; bottom: 0; left: 58%; right: 0;
      border-radius: 0 ${radius}px ${radius}px 0;
      background: repeating-linear-gradient(135deg,
        ${t.accentSoft} 0 ${hatch}px, rgba(0,0,0,0) ${hatch}px ${hatch * 2.4}px);
      border-left: ${tick}px solid ${t.accent};
    }
  </style><div class="tile"><div class="stack">
    ${bar(58, t.accent, earned)}
    ${minimal ? "" : bar(44, t.markNeutral) + bar(28, t.markNeutral)}
  </div></div>`;
}

/** The launch image is the app's own first frame and nothing else — no mark,
 *  no wordmark. It is stitched to the boot skeleton: iOS shows this, then the
 *  document paints `.splash`, and if the two match the seam is invisible. So
 *  it renders `--page-surface` verbatim (the accent glow included, because the
 *  app draws it) over `--bg-top`, which is what the body carries at phone
 *  widths. Putting a logo here would guarantee a visible swap at handoff. */
function launchHtml(wPx, hPx, t) {
  return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; }
    body {
      width: ${wPx}px; height: ${hPx}px; overflow: hidden;
      background: ${t.bgTop};
    }
    .page {
      width: ${wPx}px; height: ${hPx}px;
      background:
        radial-gradient(130% 34% at 50% 0%, ${t.accentGlow} 0%, rgba(0,0,0,0) 62%),
        linear-gradient(180deg, ${t.bgTop} 0%, ${t.bg} 36%, ${t.bgBottom} 100%);
    }
  </style><div class="page"></div>`;
}

const launchFile = (wPx, hPx) => `launch-${wPx}x${hPx}.png`;

/** The `<link>` tags, regenerated into index.html between markers.
 *
 *  Generated rather than hand-written for the reason the manifest is: twelve
 *  rows of pixel dimensions repeated in two places (the file name and the
 *  media query) is a table that rots the first time a device is added, and the
 *  failure mode is silent — iOS ignores a mismatched entry and shows white. */
function launchLinks() {
  return LAUNCH.map(({ pt: [w, h], dpr }) => {
    const media =
      `(device-width: ${w}px) and (device-height: ${h}px) ` +
      `and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`;
    return `    <link rel="apple-touch-startup-image" media="${media}" href="/icons/${launchFile(w * dpr, h * dpr)}" />`;
  }).join("\n");
}

const tokens = await readTokens();
await mkdir(OUT_DIR, { recursive: true });

await withChrome(async (cdp) => {
  const page = await openPage(cdp);
  for (const { file, size, scale } of ICONS) {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: size, height: size, deviceScaleFactor: 1, mobile: false },
      page.sessionId,
    );
    const html = tileHtml(size, scale, tokens);
    await page.navigate(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await settle(cdp, page.sessionId);
    const { data } = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      page.sessionId,
    );
    await writeFile(join(OUT_DIR, file), Buffer.from(data, "base64"));
    console.log(`  ${join(OUT_DIR, file)}  (${size}×${size}${scale < 1 ? ", maskable safe zone" : ""})`);
  }

  let launchBytes = 0;
  for (const { pt: [w, h], dpr } of LAUNCH) {
    const [wPx, hPx] = [w * dpr, h * dpr];
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: wPx, height: hPx, deviceScaleFactor: 1, mobile: false },
      page.sessionId,
    );
    const html = launchHtml(wPx, hPx, tokens);
    await page.navigate(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await settle(cdp, page.sessionId);
    const { data } = await cdp.send(
      "Page.captureScreenshot",
      { format: "png", captureBeyondViewport: false },
      page.sessionId,
    );
    const buf = Buffer.from(data, "base64");
    launchBytes += buf.length;
    await writeFile(join(OUT_DIR, launchFile(wPx, hPx)), buf);
  }
  console.log(
    `  ${OUT_DIR}/launch-*.png  (${LAUNCH.length} sizes, ${(launchBytes / 1024).toFixed(0)} KB total)`,
  );
});

await writeFile(
  "public/manifest.webmanifest",
  JSON.stringify(manifest(tokens), null, 2) + "\n",
);
console.log("  public/manifest.webmanifest");

// index.html is hand-maintained apart from this block; the markers are what
// keep the twelve <link>s from being a hand-copied table (#53).
const START = "    <!-- launch-images:start — generated by tools/make-icons.mjs, do not edit -->";
const END = "    <!-- launch-images:end -->";
const indexHtml = await readFile("index.html", "utf8");
const before = indexHtml.indexOf(START);
const after = indexHtml.indexOf(END);
if (before === -1 || after === -1) {
  throw new Error("launch-images markers missing from index.html — add them back, don't inline the links");
}
await writeFile(
  "index.html",
  indexHtml.slice(0, before) + START + "\n" + launchLinks() + "\n" + indexHtml.slice(after),
);
console.log(`  index.html  (${LAUNCH.length} apple-touch-startup-image links)`);

console.log("✓ icons, launch images and manifest regenerated from design/tokens.css");
