#!/usr/bin/env node
/**
 * Assert that the built document paints the app on its own (#53).
 *
 *   npm run build && npm run verify:firstpaint
 *
 * The complaint this exists for is "tap the icon, get a white screen". The
 * fix has three parts — self-hosted fonts (#35), the stylesheet inlined into
 * index.html, and a boot skeleton inside #root — and **all three are invisible
 * to every other check this project has.** `shot-matrix` waits for
 * `document.fonts.ready` and the screens' own fetches, so every PNG the
 * project has ever produced is of a fully-booted app; `verify:viewport` is the
 * same. A regression here would look like nothing at all until someone
 * cold-launched a phone.
 *
 * So the test is the state those tools skip: **the app's own JavaScript is
 * blocked at the network layer**, and what is left has to be the dark frame
 * rather than a white page. Our own evaluate still runs, which is why this
 * blocks the bundle rather than disabling scripting outright — the assertions
 * need a live DOM to read.
 *
 * What it cannot see: iOS's launch screen, which is painted before the HTML
 * exists at all and is the other half of #53. That is `apple-touch-startup-
 * image`, and headless Chrome has no equivalent — a device is the only test.
 */
import { createReadStream, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { evaluate, openPage, settle, withChrome } from "./cdp.mjs";

const DIST = "dist/client";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
};

/** Serve the built client the way the assets binding does, minus the SPA
 *  fallback — a 404 here should be a loud missing asset, not a silent
 *  index.html with the wrong content-type (the trap CLAUDE.md names).
 *
 *  **The 307 on `/index.html` is not decoration — it is the whole reason this
 *  server exists in this shape (#87).** Cloudflare normalises `/index.html` to
 *  `/`, and the first version of this file served it as a plain 200. Every
 *  service-worker check below passed against that, and the worker shipped a
 *  cached-redirect that Safari refuses for navigations, bricking the installed
 *  app. A stand-in for production is only worth what it reproduces; anything
 *  learned about the real host's behaviour belongs here, in code, the same day.
 */
function serve(root) {
  const server = createServer(async (req, res) => {
    const pathname = req.url.split("?")[0];

    if (pathname === "/index.html") {
      res.writeHead(307, { location: "/" }).end();
      return;
    }

    const path = join(root, normalize(decodeURIComponent(pathname)));
    const file = existsSync(path) && (await stat(path)).isDirectory() ? join(path, "index.html") : path;
    if (!existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, port: server.address().port })));
}

const fail = [];
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) fail.push(label);
};

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error(`no ${DIST}/index.html — run \`npm run build\` first`);
    process.exit(1);
  }

  // ── static checks on the document itself ──────────────────────────────────
  const html = await readFile(join(DIST, "index.html"), "utf8");
  console.log("document");
  check(!/<link[^>]*rel="stylesheet"/.test(html), "no render-blocking stylesheet link");
  check(html.includes("<style>"), "stylesheet is inlined");
  check(!/googleapis|gstatic|jsdelivr|unpkg/.test(html), "no third-party host in <head>");
  /* Asserted here rather than trusted, because its whole job happens before
     any CSS is parsed and **Chrome cannot show it failing** — a screencast of
     the full load peaks at mean luminance 33/255 with or without it. It is
     the only defence for the frame between iOS dropping the launch image and
     our stylesheet applying, so losing it would be silent everywhere except
     on a phone. */
  check(/<meta name="color-scheme" content="dark"/.test(html), "color-scheme declared before any CSS");
  // Comments survive the build, so "the next character is a tag" is not the
  // question — "is there an element in there at all" is.
  const root = html.slice(html.indexOf('<div id="root">')).replace(/<!--[\s\S]*?-->/g, "");
  check(/<div id="root">\s*<[a-z]/.test(root), "#root is not empty before JS");

  /* iOS ignores a startup image whose pixel size doesn't match the device it
     claims, and says nothing — the symptom is the white frame this issue is
     about, on one device model, months later. Chrome can't test the behaviour,
     but it can test the two things that make it fail: a missing file, and a
     PNG whose real dimensions disagree with the media query. Dimensions come
     out of the IHDR chunk, which is the first 24 bytes of any PNG. */
  console.log("\nlaunch images");
  const links = [...html.matchAll(/<link rel="apple-touch-startup-image" media="([^"]+)" href="\/([^"]+)"/g)];
  check(links.length > 0, "apple-touch-startup-image links are present", `${links.length} devices`);

  const bad = [];
  for (const [, media, href] of links) {
    const file = join(DIST, href);
    if (!existsSync(file)) {
      bad.push(`${href} missing`);
      continue;
    }
    const head = (await readFile(file)).subarray(0, 24);
    const [w, h] = [head.readUInt32BE(16), head.readUInt32BE(20)];
    const dpr = Number(media.match(/pixel-ratio: (\d+)/)[1]);
    const want = [
      Number(media.match(/device-width: (\d+)/)[1]) * dpr,
      Number(media.match(/device-height: (\d+)/)[1]) * dpr,
    ];
    if (w !== want[0] || h !== want[1]) bad.push(`${href} is ${w}×${h}, media wants ${want.join("×")}`);
  }
  check(bad.length === 0, "every launch image exists at the exact size its media query claims", bad.join("; "));

  const { server, port } = await serve(DIST);

  console.log("\nfirst paint, app bundle blocked at the network layer");
  await withChrome(async (cdp) => {
    const { sessionId } = await openPage(cdp);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Network.setBlockedURLs", { urls: ["*/assets/*.js"] }, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
      sessionId,
    );
    await cdp.send("Page.navigate", { url: `http://localhost:${port}/` }, sessionId);
    await settle(cdp, sessionId);

    const raw = await evaluate(
      cdp,
      sessionId,
      `(() => {
        const skeleton = document.querySelector('#root > *');
        const box = skeleton && skeleton.getBoundingClientRect();
        const paints = performance.getEntriesByType('paint');
        return JSON.stringify({
          tag: skeleton && skeleton.tagName.toLowerCase(),
          cls: skeleton && skeleton.className,
          height: box && Math.round(box.height),
          width: box && Math.round(box.width),
          bundleRan: !!document.querySelector('#root .tabbar'),
          firstPaint: paints.some(e => e.name === 'first-paint'),
          fcp: paints.some(e => e.name === 'first-contentful-paint'),
        });
      })()`,
    );
    const r = JSON.parse(raw);

    check(
      r.tag === "main" && r.cls.includes("splash"),
      "skeleton is the same element App renders",
      `<${r.tag} class="${r.cls}">`,
    );
    check(!r.bundleRan, "the app bundle really was blocked", "no tab bar in the DOM");
    check(r.height >= 700, "skeleton fills the viewport", `${r.width}×${r.height}`);
    check(r.width <= 430, "skeleton respects the phone column", `${r.width}px`);
    /* Not asserted. Headless Chrome reports no `paint` timing entries here at
       all — not first-paint either — and chasing why would be measuring the
       harness rather than the app. The screenshot below is strictly better
       evidence anyway: it proves what was painted, not merely that something
       was. Printed because a value appearing one day is worth noticing. */
    console.log(`  · paint timing entries: ${r.firstPaint ? "first-paint" : "none"} (informational)`);

    /* Deliberately asserted as ABSENT. `--page-surface` is a gradient, so the
       skeleton has no background-*color* at all — reading one returns
       rgba(0,0,0,0) and a structural "is it dark" check passes or fails for
       reasons unrelated to what the user sees. The complaint is about pixels,
       so sample pixels: screenshot, hand it back to Chrome to decode, and
       assert every sample is dark.

       first-contentful-paint is absent for the same honest reason and it is
       worth knowing: the skeleton has no text, image or SVG in it, so it is a
       first *paint* and not a first *contentful* paint. #53 proposes FCP as
       the number to move, and FCP cannot move until React renders — the metric
       that reflects this fix is first-paint. */
    check(!r.fcp, "no first-contentful-paint yet (the skeleton has no content)");

    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
    const pixels = await evaluate(
      cdp,
      sessionId,
      `new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.width; c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const at = (fx, fy) => {
            const [r, g, b] = ctx.getImageData(
              Math.floor(fx * (img.width - 1)), Math.floor(fy * (img.height - 1)), 1, 1).data;
            return { at: fx + ',' + fy, lum: Math.round(0.2126*r + 0.7152*g + 0.0722*b) };
          };
          const samples = [[0.5,0.02],[0.5,0.25],[0.5,0.5],[0.5,0.75],[0.5,0.98],[0.04,0.5],[0.96,0.5]]
            .map(([x,y]) => at(x,y));
          resolve(JSON.stringify({ samples, brightest: Math.max(...samples.map(s => s.lum)) }));
        };
        img.src = 'data:image/png;base64,${data}';
      })`,
    );
    const px = JSON.parse(pixels);

    /* A white screen is ~255. The pack's lightest boot surface is --bg-top at
       #1a2230, luminance ~33. 90 leaves room for a future lighter dark pack
       while still failing loudly on anything a person would call "white".

       Measured while proving this file can fail: with the stylesheet linked
       again rather than inlined, these samples still come back dark, because
       localhost serves the CSS with no latency worth the name. **The pixel
       check proves the composed page is dark; it cannot prove the page is dark
       *early*.** That is what the two document checks above are for, and it is
       why they are assertions rather than notes. Deleting them because "the
       screenshot covers it" would leave the render-blocking regression silent
       on every machine except a phone on a bad connection. */
    check(px.brightest < 90, "every sampled pixel is dark, not white", `brightest ${px.brightest}/255`);
  });

  /* #54. A precache is one of those things that looks finished the moment the
     file exists — the manifest is right, the tests are green, and the only
     question that matters ("does the app open with no connection?") is
     answered by nothing so far. So: register the real worker, wait for it to
     activate, cut the network at the CDP layer, and navigate again. */
  console.log("\nservice worker, with the network cut");
  await withChrome(async (cdp) => {
    const { sessionId } = await openPage(cdp);
    await cdp.send("Network.enable", {}, sessionId);
    await cdp.send("Page.navigate", { url: `http://localhost:${port}/` }, sessionId);
    await settle(cdp, sessionId);

    // `ready` resolves as soon as there IS an active worker, which is a moment
    // before that worker finishes activating — clients.claim() is inside
    // waitUntil. Reading .state at that instant races and reports "activating".
    const ready = await evaluate(
      cdp,
      sessionId,
      `navigator.serviceWorker.ready.then(r => new Promise(res => {
        const w = r.active;
        if (!w) return res('none');
        if (w.state === 'activated') return res('activated');
        w.addEventListener('statechange', () => w.state === 'activated' && res('activated'));
      }))`,
    );
    check(ready === "activated", "the worker installs and activates", `state: ${ready}`);

    // waitUntil(addAll) gates activation, so an activated worker has a
    // complete cache by construction — but assert the contents anyway, since
    // "activated with an empty cache" is exactly what a silently-failing
    // addAll would look like from the outside.
    const cached = await evaluate(
      cdp,
      sessionId,
      `caches.keys()
        .then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys()))))
        .then(all => JSON.stringify({
          generations: all.length,
          urls: all.flat().map(r => new URL(r.url).pathname).sort(),
        }))`,
    );
    const c = JSON.parse(cached);
    check(c.generations === 1, "exactly one cache generation", `${c.generations}`);
    check(c.urls.includes("/"), "the shell is cached", c.urls.filter((u) => !u.startsWith("/assets")).join(" "));

    /* #87 in one assertion. A redirected response cannot answer a navigation,
       and Safari's reaction is to refuse the page — so this is the difference
       between an app and an error screen, and nothing else here would notice:
       the entry is present, the URL is right, the bytes are right. */
    const shellRedirected = await evaluate(
      cdp,
      sessionId,
      `caches.keys()
        .then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.match("/")))))
        .then(rs => rs.find(Boolean))
        .then(r => r ? String(r.redirected) : "missing")`,
    );
    check(shellRedirected === "false", "the cached shell is not a redirect", `redirected: ${shellRedirected}`);
    check(
      c.urls.filter((u) => u.endsWith(".woff2")).length === 7,
      "all seven fonts are cached",
      `${c.urls.filter((u) => u.endsWith(".woff2")).length}`,
    );
    check(!c.urls.some((u) => u.endsWith(".wasm")), "the 991 KB wasm is not cached");
    check(!c.urls.some((u) => u.startsWith("/api")), "no API response is cached");

    /* The network is cut by **stopping the server**, not by CDP's offline
       emulation. `Network.emulateNetworkConditions` applies to the page's
       session, and once a service worker controls the page the actual requests
       originate from the worker's own session — so the emulation did nothing,
       the server quietly kept answering, and every check below passed for the
       wrong reason. Found by the negative control, which reported
       `reached:200` on a URL that was supposed to be unreachable. A dead
       socket cannot be argued with. */
    server.close();
    server.closeAllConnections?.();
    await cdp.send("Page.navigate", { url: `http://localhost:${port}/trends` }, sessionId);
    await settle(cdp, sessionId);

    const offline = JSON.parse(
      await evaluate(
        cdp,
        sessionId,
        `(async () => JSON.stringify({
          // Guarded rather than read directly: when the navigation fails the
          // browser shows its own error page, where navigator.serviceWorker is
          // undefined — and an uncaught TypeError there reports "the harness
          // crashed" for what is actually "the app would not open", which is
          // the single most important thing this file can tell you. #87 was
          // first seen here as a stack trace.
          controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          title: document.title,
          styled: !!document.querySelector('style'),
          js: performance.getEntriesByType('resource')
            .filter(r => r.name.includes('/assets/') && r.name.endsWith('.js')).length,
          uncached: await fetch('/icons/icon-512.png', { cache: 'no-store' })
            .then(r => 'reached:' + r.status).catch(() => 'failed'),
        }))()`,
      ),
    );

    /* The negative control, and the check the rest of this section is worthless
       without. `navigator.onLine` was the obvious thing to assert and it stayed
       `true` under CDP's offline emulation — so trusting it would have reported
       "loaded from cache" for a page the server was quietly still answering.
       Ask the network instead: /icons/icon-512.png is deliberately NOT
       precached, so it must fail at the same moment the shell succeeds. */
    check(offline.uncached === "failed", "an un-precached URL really cannot be reached", offline.uncached);
    // /trends rather than / on purpose: a deep link is the case a plain HTTP
    // cache cannot serve offline, so this separates "the worker is working"
    // from "the browser had it lying around".
    check(offline.title === "MyMacros", "a deep link still returns the app shell", offline.title);
    check(offline.controlled, "the page is served by the worker");
    check(offline.styled, "the inlined stylesheet came with it");
    check(offline.js > 0, "the JS bundle loaded from cache", `${offline.js} chunk(s)`);
  });

  console.log(
    fail.length ? `\n${fail.length} check(s) failed` : "\nfirst paint is the app's own frame, and it survives losing the network",
  );
  process.exit(fail.length ? 1 : 0);
}

await main();
