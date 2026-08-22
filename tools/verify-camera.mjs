#!/usr/bin/env node
// One camera prompt per visit to the log flow (#94).
//
//   npm run verify:camera -- --cookie better-auth.session_token=...
//   npm run verify:camera -- --cookie ... https://fuel.debrief.run
//
// #94 was reported after a day of real use: the iOS camera permission sheet
// kept coming back. Measured before anything was changed, by patching
// `navigator.mediaDevices.getUserMedia` at document-start and driving the real
// screens — one visit to `/log` that took a photo, dismissed the sheet and
// toured the three modes made **seven** calls (five in a production build;
// three of the seven are StrictMode's double-invoke). On the *denied* path it
// asked six times, re-asking on every mode switch though the answer was
// already `NotAllowedError`. Every call is a chance for the platform to
// re-prompt, which is the bug as the user experiences it.
//
// **No check this project has could see that, and none would see it return.**
// The viewfinder renders identically at one call or seven, so every screenshot
// passes. `verify:viewport` measures boxes, so it passes. The unit tests cover
// `lib/camera.ts` in isolation — which is precisely the file a regression
// would route *around*, by going back to calling `getUserMedia` from a
// component effect. The defect lives in **how many times a side effect runs**,
// and nothing that inspects a finished page can see that number.
//
// **So the count is the oracle.** `getUserMedia` is wrapped before any app
// script runs (`Page.addScriptToEvaluateOnNewDocument` — a patch installed
// after load would miss the mount-time call, which is the one the issue is
// about), the real screens are driven in headless Chrome with a synthetic
// camera, and the counter is read at every step of a full visit. The expected
// answer is 1, at every step, forever. A number is a much better regression
// guard than a rendering, because it cannot be nearly right.
//
// Three sections, because the defect has three faces:
//
//   tour    the happy path end to end — mount, shutter, dismiss, and the mode
//           tour that used to re-acquire purely because PHOTO and BARCODE ask
//           for different frame sizes. Ends by leaving /log, where the camera
//           is supposed to actually go out: every track `ended`.
//   text    `/log#text` must never touch the camera at all. Zero, not one.
//   note    #59's field and #120's lift: 27 keystrokes and a keyboard going up
//           and down, all of them re-renders of a component holding a live
//           camera. Still 1.
//   denied  a refusal is an *answer*. Re-asking a user who said no is the
//           prompt-storm #94 reports, in its most visible form. Produced by
//           withholding `--use-fake-ui-for-media-stream`, so Chrome refuses
//           the grant instead of auto-approving it.
//
// Both vacuous passes are guarded: a screen that never rendered also makes
// zero calls, and a camera that was quietly granted also makes one. Each
// section asserts that the state it is counting in is the state it meant.
//
// **What would actually defeat this, established by trying to.** Putting the
// old `[live, mode]` dependency array back on the effect in `CameraStage`
// changes nothing — every count stays at 1. The session cache in
// `lib/camera.ts`, not the dependency list, is what makes the guarantee now,
// and an effect that re-runs against a memoised acquisition is not a defect.
// The regression this file exists to catch is therefore the one that routes
// *around* that file: an effect calling `navigator.mediaDevices.getUserMedia`
// itself again. Restore both — the direct call and the dependency array — and
// the tour climbs 1→8 while the denied path reaches 6, which is #94 exactly as
// it was reported. Assert the count, never the shape of the code that
// produces it: the count is what the platform reacts to.
//
// What this cannot prove: whether iOS re-prompts for any given call. Chrome's
// synthetic camera never prompts at all, and no headless browser can answer
// that. This pins the input to the platform's decision — how often we ask —
// which is the only half of #94 we control.

import { evaluate, fakeKeyboard, openPage, settle, waitFor, withChrome } from "./cdp.mjs";

// ── args ─────────────────────────────────────────────
const argv = process.argv.slice(2);
let base = "http://localhost:5173";
const cookies = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--cookie") {
    const raw = argv[++i];
    const eq = raw.indexOf("=");
    cookies.push({ name: raw.slice(0, eq), value: raw.slice(eq + 1) });
  } else base = a.replace(/\/$/, "");
}

// Signed out, `/log` is the sign-in screen — which opens no camera and would
// pass every count in this file for entirely the wrong reason.
if (!cookies.length) {
  console.error("\n/log is behind auth — pass --cookie better-auth.session_token=<token>\n");
  process.exit(1);
}

// The same two flags shot-matrix --camera uses: a rolling synthetic pattern as
// the video source, and the permission auto-granted. The denied section takes
// the first and not the second, which is the whole of how it is produced.
const FAKE_DEVICE = "--use-fake-device-for-media-stream";
const FAKE_UI = "--use-fake-ui-for-media-stream";

/** Wraps getUserMedia and records every call, every stream it handed back, and
 *  every refusal. Installed on new document, so it is in place before React. */
const PATCH = `(() => {
  window.__gum = { calls: [], streams: [], errors: [] };
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const real = md.getUserMedia.bind(md);
  md.getUserMedia = (constraints) => {
    window.__gum.calls.push(JSON.parse(JSON.stringify(constraints || {})));
    return real(constraints).then(
      (s) => { window.__gum.streams.push(s); return s; },
      (e) => { window.__gum.errors.push(e.name); throw e; },
    );
  };
})();`;

/** The counter plus enough of the screen to prove which state it was counting
 *  in. Track state is read live off the streams, so "left /log" can assert the
 *  camera really went out rather than that nothing new was opened. */
const REPORT = `(() => {
  const g = window.__gum || { calls: [], streams: [], errors: [] };
  return {
    calls: g.calls.length,
    asked: g.calls.map((c) => (((c.video || {}).width || {}).ideal) || "?"),
    errors: g.errors,
    tracks: g.streams.flatMap((s) => s.getVideoTracks().map((t) => {
      const st = t.getSettings ? t.getSettings() : {};
      return t.readyState + (t.enabled ? "" : "/disabled") + " " + (st.width || "?") + "x" + (st.height || "?");
    })),
    mode: [...document.querySelectorAll(".modes [role=tab]")]
      .find((e) => e.getAttribute("aria-selected") === "true")?.textContent || null,
    note: document.querySelector(".cam-note-field")?.value ?? null,
    /* #120's lift, read off the rendered transform rather than off any state:
       the whole stage is translated up so the note clears the keyboard, and
       every step of that is a re-render of a component holding a live camera. */
    lift: (() => {
      const el = document.querySelector(".frame.cam");
      if (!el) return null;
      const t = getComputedStyle(el).transform;
      return t === "none" ? 0 : -new DOMMatrix(t).m42;
    })(),
    live: !!document.querySelector(".cam-video.on"),
    still: !!document.querySelector(".cam-still"),
    sheet: !!document.querySelector(".sheet"),
    fallback: !!document.querySelector(".cam-fallback"),
    textbox: !!document.querySelector("#describe"),
  };
})()`;

/** 27 characters, which is the number #59 measured by hand when it added the
 *  field: every one of them is a prop change on a component that owns a live
 *  camera, and the whole of that issue's risk was whether re-rendering the
 *  stage re-acquires. #120 adds a second source of the same re-render — a
 *  visual-viewport listener firing as the keyboard moves — so the measurement
 *  stops being an anecdote in an issue thread and becomes a step in here. */
const NOTE = "wife's plate, no ham on her";

/** Type it a character at a time, through the native value setter and a real
 *  `input` event, because a controlled React input ignores `el.value = x`.
 *  The existing text step sets the value directly on purpose — it only needs
 *  the focus — but here the *number of renders* is the subject. */
const TYPE_NOTE = `(() => {
  const el = document.querySelector(".cam-note-field");
  if (!el) return 0;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  el.focus();
  for (const ch of ${JSON.stringify(NOTE)}) {
    set.call(el, el.value + ch);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return el.value.length;
})()`;

const fail = [];
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(36)}${detail}`);
  if (!ok) fail.push(label);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read the counter and assert it. Everything else on the line is context for
 *  whoever reads a failure — `asked` especially: a regression prints the frame
 *  sizes of every extra acquisition, which names the mode switch that caused it. */
async function step(cdp, S, label, expect) {
  const r = await evaluate(cdp, S, REPORT);
  check(
    label,
    r.calls === expect,
    `getUserMedia=${r.calls} (expected ${expect})` +
      `  mode=${r.mode} live=${r.live} still=${r.still} sheet=${r.sheet}` +
      (r.asked.length ? `  asked=[${r.asked.join(",")}]` : "") +
      (r.tracks.length ? `  tracks=[${r.tracks.join(", ")}]` : "") +
      (r.errors.length ? `  errors=[${r.errors.join(",")}]` : ""),
  );
  return r;
}

const click = async (cdp, S, selector) => {
  const hit = await evaluate(
    cdp,
    S,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return false; el.click(); return true; })()`,
  );
  if (!hit) throw new Error(`nothing to click at ${selector}`);
};

const clickMode = async (cdp, S, mode) => {
  const hit = await evaluate(
    cdp,
    S,
    `(() => { const el = [...document.querySelectorAll(".modes [role=tab]")]
                .find((e) => e.textContent === ${JSON.stringify(mode)});
              if (!el) return false; el.click(); return true; })()`,
  );
  if (!hit) throw new Error(`no ${mode} tab`);
};

/** A page with the patch installed, the session cookie set, and the reference
 *  width (rule 6) — before anything navigates. */
async function stage(cdp, { block = [], keyboard = false } = {}) {
  const page = await openPage(cdp);
  const S = page.sessionId;
  await cdp.send("Network.enable", {}, S);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PATCH }, S);
  // Down at 0 to start with — the section that wants it raises it itself, so
  // what is measured is the *reaction* rather than a screen that mounted with
  // a keyboard already up (#120).
  if (keyboard) await fakeKeyboard(cdp, S, 0);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
    S,
  );
  for (const c of cookies) await cdp.send("Network.setCookie", { ...c, url: base, path: "/" }, S);
  if (block.length) await cdp.send("Network.setBlockedURLs", { urls: block }, S);
  return page;
}

console.log(`\ncamera acquisition checks against ${base}`);
console.log(`  375px · signed in · synthetic camera\n`);

async function main() {
  await withChrome(async (cdp) => {
    // ── the tour ─────────────────────────────────────
    console.log("tour — mount, shutter, dismiss, PHOTO→BARCODE→PHOTO→TEXT→PHOTO, leave");
    {
      // Claude is never called: the photo read fails fast and Log opens its
      // #16 manual sheet, which reaches the same "a frame is frozen, then a
      // sheet is up" state for free — and without a network round trip whose
      // latency would make this file flaky.
      const page = await stage(cdp, { block: ["*analyze/photo*"] });
      const S = page.sessionId;

      await page.navigate(`${base}/log`);
      await settle(cdp, S);
      await waitFor(cdp, S, `!!document.querySelector(".cam-video.on")`, {
        label: "the viewfinder to go live",
      });
      await pause(400);
      await step(cdp, S, "1. /log mounted (PHOTO)", 1);

      await click(cdp, S, 'button[aria-label="Take photo"]');
      await waitFor(cdp, S, `!!document.querySelector(".cam-still")`, { label: "the frozen frame" });
      await pause(300);
      // The old code stopped the tracks here and re-acquired on the way back.
      await step(cdp, S, "2. shutter pressed, frame frozen", 1);

      await waitFor(cdp, S, `!!document.querySelector(".sheet")`, { label: "the confirm sheet" });
      await pause(200);
      await step(cdp, S, "3. read finished, sheet open", 1);

      await click(cdp, S, ".sheet-wrap");
      await waitFor(cdp, S, `!document.querySelector(".cam-still")`, { label: "the still to clear" });
      await pause(600);
      await step(cdp, S, "4. sheet dismissed, finder back", 1);

      // PHOTO and BARCODE ask for different frame sizes, which is why this
      // pair used to re-acquire on its own. It is `applyConstraints` now.
      await clickMode(cdp, S, "BARCODE");
      await pause(900);
      await step(cdp, S, "5. switched to BARCODE", 1);
      await clickMode(cdp, S, "PHOTO");
      await pause(900);
      await step(cdp, S, "6. back to PHOTO", 1);

      // TEXT unmounts the camera stage entirely — deliberately without
      // releasing, or coming back would be a second prompt for one visit.
      await clickMode(cdp, S, "TEXT");
      await pause(700);
      await step(cdp, S, "7. switched to TEXT", 1);
      await clickMode(cdp, S, "PHOTO");
      await pause(900);
      await step(cdp, S, "8. back to PHOTO", 1);

      await click(cdp, S, ".cam-x");
      await waitFor(cdp, S, `location.pathname === "/"`, { label: "Today" });
      await pause(600);
      const out = await step(cdp, S, "9. left /log (Today)", 1);
      // The other half of the deal: asking once is only correct if the camera
      // also goes out at the end. Release is deferred a tick, hence the pause.
      check(
        "   every track ended on the way out",
        out.tracks.length > 0 && out.tracks.every((t) => t.startsWith("ended")),
        `tracks=[${out.tracks.join(", ") || "none"}]`,
      );
    }

    // ── edge: the text path ──────────────────────────
    console.log("\ntext — /log#text never touches the camera");
    {
      const page = await stage(cdp);
      const S = page.sessionId;
      await page.navigate(`${base}/log#text`);
      await settle(cdp, S);
      await waitFor(cdp, S, `!!document.querySelector("#describe")`, { label: "the describe field" });
      await pause(600);
      const r = await step(cdp, S, "1. /log#text mounted", 0);
      // Zero is also what a screen that failed to render reports.
      check("   the text screen really rendered", r.textbox, `mode=${r.mode}`);

      await evaluate(
        cdp,
        S,
        `(() => { const el = document.querySelector("#describe");
                  el.focus(); el.value = "two eggs"; return true; })()`,
      );
      await pause(400);
      await step(cdp, S, "2. typed a description", 0);
    }

    // ── edge: the note, and the keyboard under it ────
    // #59 put a text field on the camera screen and #120 made the screen move
    // when the keyboard arrives. Both are re-renders of a mounted viewfinder —
    // 27 keystrokes and then a visual-viewport listener firing through a
    // keyboard going up and coming back down — which is exactly the shape #94
    // was: a side effect running more times than anyone counted.
    console.log("\nnote — a typed note and a moving keyboard re-acquire nothing");
    {
      const page = await stage(cdp, { keyboard: true });
      const S = page.sessionId;
      await page.navigate(`${base}/log`);
      await settle(cdp, S);
      await waitFor(cdp, S, `!!document.querySelector(".cam-video.on")`, {
        label: "the viewfinder to go live",
      });
      await pause(400);
      await step(cdp, S, "1. /log mounted (PHOTO)", 1);

      await click(cdp, S, ".cam-note .btn-text");
      await waitFor(cdp, S, `!!document.querySelector(".cam-note-field")`, {
        label: "the note field",
      });
      await pause(200);
      await step(cdp, S, "2. note field opened", 1);

      const typed = await evaluate(cdp, S, TYPE_NOTE);
      await pause(400);
      const r3 = await step(cdp, S, `3. typed ${typed} character(s)`, 1);
      // A field that never took the text is a screen that never re-rendered,
      // which would pass the count above for entirely the wrong reason.
      check(
        "   the note reached the field",
        r3.note === NOTE,
        `note=${JSON.stringify(r3.note)}`,
      );

      await evaluate(cdp, S, `window.__keyboard.set(336)`);
      await pause(500);
      const up = await step(cdp, S, "4. keyboard up (336px)", 1);
      // Same negative control one step over: a deck that did not move has not
      // exercised the listener this section exists to count through.
      check("   the deck lifted", up.lift > 0, `lift=${up.lift}px`);

      await evaluate(cdp, S, `window.__keyboard.set(0)`);
      await pause(500);
      const down = await step(cdp, S, "5. keyboard down again", 1);
      check("   the deck came back down", down.lift === 0, `lift=${down.lift}px`);
    }
  }, [FAKE_DEVICE, FAKE_UI]);

  // ── edge: the refusal ──────────────────────────────
  // A second browser, because the grant is decided by a launch flag. Withhold
  // --use-fake-ui-for-media-stream and Chrome refuses instead of auto-granting.
  console.log("\ndenied — a refusal is asked once, not once per mode switch");
  await withChrome(async (cdp) => {
    const page = await stage(cdp);
    const S = page.sessionId;
    await page.navigate(`${base}/log`);
    await settle(cdp, S);
    await waitFor(cdp, S, `!!document.querySelector(".cam-fallback")`, {
      label: "the no-camera fallback",
    });
    await pause(600);
    const r1 = await step(cdp, S, "1. /log mounted (PHOTO)", 1);
    // The negative control. One call is also what a *granted* camera makes,
    // so without this the whole section could pass having tested nothing.
    check(
      "   the grant really was refused",
      r1.errors.length > 0 && !r1.live && r1.fallback,
      `errors=[${r1.errors.join(",")}] fallback=${r1.fallback}`,
    );

    await clickMode(cdp, S, "BARCODE");
    await pause(900);
    await step(cdp, S, "2. switched to BARCODE", 1);
    await clickMode(cdp, S, "PHOTO");
    await pause(900);
    await step(cdp, S, "3. back to PHOTO", 1);
    await clickMode(cdp, S, "TEXT");
    await pause(600);
    await clickMode(cdp, S, "PHOTO");
    await pause(900);
    await step(cdp, S, "4. PHOTO → TEXT → PHOTO", 1);
  }, [FAKE_DEVICE]);
}

try {
  await main();
} catch (err) {
  // A thrown step is a failure, not a crash: the screens not reaching the
  // state being counted in is exactly as interesting as a wrong count.
  console.log(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
  fail.push("harness");
}

console.log(
  fail.length
    ? `\n${fail.length} check(s) failed — see the ✗ line(s) above (#94, #120)\n`
    : "\none getUserMedia call per visit, none on the text path, one on a refusal;\n" +
      "the note and the keyboard move the deck and acquire nothing\n",
);
process.exit(fail.length ? 1 : 0);
