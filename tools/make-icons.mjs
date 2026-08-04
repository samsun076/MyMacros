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
});

await writeFile(
  "public/manifest.webmanifest",
  JSON.stringify(manifest(tokens), null, 2) + "\n",
);
console.log("  public/manifest.webmanifest");

console.log("✓ icons and manifest regenerated from design/tokens.css");
