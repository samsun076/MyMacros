// Minimal Chrome DevTools Protocol client — zero npm deps, Node ≥22 (native
// WebSocket) + a local Chrome. Shared by shot-matrix.mjs (design QA) and
// verify-auth.mjs (passkey ceremony).

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const waiters = [];
  // Standing subscriptions. `once` is enough for load events, but a screencast
  // emits Page.screencastFrame continuously and every frame has to be caught
  // and acked or Chrome stops sending them.
  const subs = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) {
          waiters.splice(i, 1);
          w.res(msg.params);
        }
      }
      for (const s of subs) {
        if (s.method === msg.method && (!s.sessionId || s.sessionId === msg.sessionId)) {
          s.fn(msg.params);
        }
      }
    }
  };
  return new Promise((res, rej) => {
    ws.onopen = () =>
      res({
        send: (method, params = {}, sessionId) =>
          new Promise((res2, rej2) => {
            const msgId = ++id;
            pending.set(msgId, { res: res2, rej: rej2 });
            ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
          }),
        once: (method, sessionId) =>
          new Promise((res2) => waiters.push({ method, sessionId, res: res2 })),
        /** Standing subscription; returns an unsubscribe function. */
        on: (method, fn, sessionId) => {
          const sub = { method, fn, sessionId };
          subs.push(sub);
          return () => {
            const i = subs.indexOf(sub);
            if (i >= 0) subs.splice(i, 1);
          };
        },
        close: () => ws.close(),
      });
    ws.onerror = rej;
  });
}

export async function launchChrome(profileDir, extraArgs = []) {
  const proc = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    ...extraArgs,
  ]);
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) res(m[1]);
    });
    proc.on("exit", () => rej(new Error("chrome exited before DevTools was ready")));
    setTimeout(() => rej(new Error("timed out waiting for chrome")), 15000);
  });
  return { proc, wsUrl };
}

/** `reduceMotion` defaults to true because every *screenshot* tool wants it —
 *  a still shot taken mid-transition is noise, not a design. Recording is the
 *  one caller that wants the opposite: motion is the subject, and forcing
 *  `reduce` there produces a video of an app that appears to teleport between
 *  states. That default is also why no PNG this project has produced has ever
 *  shown a transition, which is worth remembering when a bug report can't be
 *  reproduced from screenshots. */
export async function openPage(cdp, { reduceMotion = true } = {}) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  if (reduceMotion) {
    await cdp.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      sessionId,
    );
  }
  return {
    targetId,
    sessionId,
    navigate: async (u) => {
      // hash-only moves are same-document (no load event) — reset first
      let loaded = cdp.once("Page.loadEventFired", sessionId);
      await cdp.send("Page.navigate", { url: "about:blank" }, sessionId);
      await loaded;
      loaded = cdp.once("Page.loadEventFired", sessionId);
      await cdp.send("Page.navigate", { url: u }, sessionId);
      await loaded;
    },
  };
}

/** A software keyboard, fabricated (#120).
 *
 * **No check in this repo had ever seen one.** Headless Chrome has no software
 * keyboard, so every PNG this project has produced — on every screen, since the
 * beginning — is of an app with the keyboard down. That is a *different* blind
 * spot from `env(safe-area-inset-*)` reading 0, and a broader one: it covers
 * every text input in the app, and #59's pre-capture note shipped through it.
 *
 * The app measures the keyboard the only way it can be measured (`lib/
 * keyboard.ts`: the layout viewport less `window.visualViewport`), so what this
 * fabricates is that **input** rather than any output. `window.visualViewport`
 * is replaced before a line of app script runs; everything downstream — the
 * measurement, the clamps, the transform — is the real code path.
 *
 * `window.__keyboard.set(px)` raises and lowers it afterwards, which is how a
 * driver checks that something *reacts* rather than that it rendered once.
 *
 * **What it is not.** It is a rectangle of a chosen height. It has no accessory
 * bar, no predictive row, no animation, no language, and iOS's own
 * scroll-into-view does not happen — `offsetTop` stays 0 here and is exactly
 * the term a device exercises and this cannot. It answers "does the deck move,
 * by how much, and does anything overflow when it has" and nothing else.
 *
 * `paint` draws a labelled block over the fabricated area, so a screenshot
 * shows what the keyboard would be standing in front of instead of a band of
 * bare page. It is drawn by the tool, never by the app, and says so on itself.
 */
export function keyboardScript(px = 0, { paint = false } = {}) {
  return `(() => {
  let kb = ${Number(px) || 0};
  const bus = new EventTarget();
  const view = {
    get width() { return window.innerWidth; },
    get height() { return Math.max(0, window.innerHeight - kb); },
    get offsetLeft() { return 0; },
    get offsetTop() { return 0; },
    get pageLeft() { return window.scrollX; },
    get pageTop() { return window.scrollY; },
    get scale() { return 1; },
    onresize: null,
    onscroll: null,
    addEventListener: (...a) => bus.addEventListener(...a),
    removeEventListener: (...a) => bus.removeEventListener(...a),
    dispatchEvent: (e) => bus.dispatchEvent(e),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, get: () => view });
  // The device metrics change under a screenshot run; a real visual viewport
  // would report the new height with a resize, so this one does too.
  window.addEventListener("resize", () => bus.dispatchEvent(new Event("resize")));

  let plate = null;
  const draw = () => {
    if (!plate) return;
    plate.style.height = kb + "px";
    plate.style.display = kb > 0 ? "flex" : "none";
    plate.textContent = "SYNTHETIC · " + kb + "px · NOT AN iOS KEYBOARD";
  };
  if (${paint ? "true" : "false"}) {
    addEventListener("DOMContentLoaded", () => {
      plate = document.createElement("div");
      plate.setAttribute("data-fake-keyboard", "");
      plate.style.cssText =
        "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:none;" +
        "align-items:center;justify-content:center;box-sizing:border-box;" +
        "background:#0b0e13;border-top:1px solid #2a3547;color:#55627a;" +
        "font:600 11px/1 ui-monospace,monospace;letter-spacing:.1em;white-space:nowrap;" +
        "pointer-events:none;";
      document.body.appendChild(plate);
      draw();
    });
  }

  window.__keyboard = {
    get px() { return kb; },
    set(next) {
      kb = Math.max(0, next | 0);
      draw();
      bus.dispatchEvent(new Event("resize"));
      return kb;
    },
  };
})();`;
}

/** Install the fabricated keyboard for every subsequent navigation on this
 *  session. Returns a function that removes it again — the point of which is
 *  that a route list can check one screen with the keyboard up without every
 *  other screen in the same run being measured through it. */
export async function fakeKeyboard(cdp, sessionId, px, opts) {
  const { identifier } = await cdp.send(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: keyboardScript(px, opts) },
    sessionId,
  );
  return () =>
    cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId);
}

/** Wait for fonts + two frames, so a screenshot isn't mid-layout. */
export async function settle(cdp, sessionId) {
  await cdp.send(
    "Runtime.evaluate",
    {
      expression:
        "document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))",
      awaitPromise: true,
    },
    sessionId,
  );
}

/** Evaluate an expression in the page and return its value. */
export async function evaluate(cdp, sessionId, expression, { awaitPromise = true } = {}) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, awaitPromise, returnByValue: true },
    sessionId,
  );
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result.value;
}

/** Poll an expression until it's truthy. Returns its value; throws on timeout. */
export async function waitFor(cdp, sessionId, expression, { timeout = 10000, label } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await evaluate(cdp, sessionId, `(() => (${expression}))()`);
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label ?? expression}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function withChrome(fn, extraArgs = []) {
  const profileDir = await mkdtemp(join(tmpdir(), "mymacros-cdp-"));
  const { proc, wsUrl } = await launchChrome(profileDir, extraArgs);
  const cdp = await connect(wsUrl);
  try {
    return await fn(cdp, profileDir);
  } finally {
    cdp.close();
    const exited = new Promise((res) => proc.on("exit", res));
    proc.kill();
    await exited;
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
