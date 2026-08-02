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
// 375 (iPhone 13 mini) is the reference width — nothing is "done" until it
// passes here. The dashed line on the sheet marks that device's fold
// (logical viewport height). Zero npm deps: Node ≥22 (native WebSocket) + Chrome.
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
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--widths") widths = argv[++i].split(",").map(Number);
  else files.push(argv[i]);
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

async function fullPageShot(cdp, sessionId, width) {
  const setMetrics = (w, h) =>
    cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: w, height: h, deviceScaleFactor: 2, mobile: true },
      sessionId,
    );
  await setMetrics(width, DEVICES[width] ?? 844);
  await settle(cdp, sessionId);
  const { result } = await cdp.send(
    "Runtime.evaluate",
    { expression: "document.documentElement.scrollHeight", returnByValue: true },
    sessionId,
  );
  const pageH = Math.min(result.value, 6000);
  // grow the viewport to full content height so fixed chrome lands at the
  // true bottom — like the page seen end-to-end
  await setMetrics(width, pageH);
  await settle(cdp, sessionId);
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

// ── main ─────────────────────────────────────────────
await mkdir(OUT_DIR, { recursive: true });
const profileDir = await mkdtemp(join(tmpdir(), "shot-matrix-"));
const { proc, wsUrl } = await launchChrome(profileDir);
const cdp = await connect(wsUrl);

try {
  const page = await openPage(cdp);
  for (const file of files) {
    const [path, hash] = file.split("#");
    const name = basename(path, ".html") + (hash ? `-${hash}` : "");
    const url = `file://${resolve(path)}${hash ? "#" + hash : ""}`;
    const shots = [];
    for (const width of widths) {
      await page.navigate(url);
      const { png, height } = await fullPageShot(cdp, page.sessionId, width);
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
