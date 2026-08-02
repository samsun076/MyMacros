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

export async function openPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  // deterministic shots: skip entrance animations
  await cdp.send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    sessionId,
  );
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
