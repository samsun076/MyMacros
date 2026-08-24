#!/usr/bin/env node
// Onboarding's typed fields (#37) — the two that a first-run stranger meets
// and that the owner of this deployment structurally cannot.
//
//   npm run dev            # in another terminal
//   npm run verify:onboarding
//
// NOTHING HERE RUNS IN CI, like every drive in this repo. `Onboarding.tsx` has
// no unit oracle at all — same as Log.tsx, Today.tsx and the rest, where eight
// deliberate mutations have come back green.
//
// The bug this exists for, measured before it was fixed:
//
//   start          an empty "Height in inches" box
//   type "7"       the box is DESTROYED and replaced by a FT+IN pair reading
//                  0 ft 3 in, with focus moved to Feet
//   type "0"       lands in FEET → "00"
//
// The field's *shape* branched on `imperial && ft`, and `ft` is derived from
// the value being typed — so the first keystroke changed the layout under the
// finger and a new imperial user could not enter their height at all. Invisible
// to the author because his profile already had a height, so he always got the
// pair. The shape now depends on `units` and nothing else.

import { evaluate, openPage, waitFor, withChrome } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5173";

let failures = 0;
const step = (name, detail = "") => console.log(`  ✓ ${name}${detail ? `  ${detail}` : ""}`);
function check(name, ok, detail = "") {
  if (ok) return step(name, detail);
  failures++;
  console.log(`  ✗ ${name}  ${detail}`);
}

/** Soft wait — a driver is one long loop, and #24's threw at its first
 *  assertion and left 27 later claims neither green nor red. */
async function soft(cdp, s, expr, label, timeout = 10000) {
  try {
    return await waitFor(cdp, s, expr, { timeout, label });
  } catch {
    check(`waited for ${label}`, false, `timed out after ${timeout}ms`);
    return null;
  }
}

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`no dev server at ${BASE} — run \`npm run dev\` first`);
  process.exit(1);
}

const FIELD = (label) => `document.querySelector('input[aria-label=${JSON.stringify(label)}]')`;

const SHAPE = `(() => {
  const q = l => document.querySelector('input[aria-label="' + l + '"]');
  const ft = q("Feet"), inch = q("Inches"), cm = q("Height in centimetres"), old = q("Height in inches");
  const a = document.activeElement;
  return {
    shape: ft ? "ft+in" : cm ? "cm" : old ? "legacy-inches" : "none",
    ft: ft?.value ?? null, in: inch?.value ?? null, cm: cm?.value ?? null,
    focused: a?.getAttribute?.("aria-label") ?? a?.tagName ?? null,
  };
})()`;

await withChrome(async (cdp) => {
  const page = await openPage(cdp);
  const { sessionId: s } = page;
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
    s,
  );

  const key = async (name, code, vk) => {
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.send(
        "Input.dispatchKeyEvent",
        { type, key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk },
        s,
      );
    }
    await new Promise((r) => setTimeout(r, 70));
  };
  const typeText = async (text) => {
    for (const ch of text) {
      await cdp.send("Input.insertText", { text: ch }, s);
      await new Promise((r) => setTimeout(r, 70));
    }
  };
  const backspace = () => key("Backspace", "Backspace", 8);
  const blur = async () => {
    await evaluate(cdp, s, `document.activeElement?.blur(), true`);
    await new Promise((r) => setTimeout(r, 200));
  };
  /** Focus a field, or report that it isn't there and carry on.
   *
   *  **Null-safe on purpose.** The first cut called `.focus()` on the result of
   *  a `querySelector` — so under the very mutation this file exists to catch,
   *  the field was gone, the driver THREW at its third line, and eleven later
   *  checks were neither green nor red while the run still printed like a
   *  suite that had executed. One red, and it was the wrong red. That is #24's
   *  incident exactly, reproduced here by the mutation rather than in
   *  production, which is the argument for running one. */
  const present = (label) => evaluate(cdp, s, `${FIELD(label)} !== null`);
  const focus = async (label) => {
    if (!(await present(label))) {
      check(`focus ${label}`, false, "the field is not on the screen");
      return false;
    }
    await evaluate(cdp, s, `${FIELD(label)}.focus(), true`);
    await new Promise((r) => setTimeout(r, 100));
    return true;
  };
  const clear = async (label) => {
    if (!(await focus(label))) return false;
    for (let i = 0; i < 8; i++) await backspace();
    return true;
  };
  const val = (label) => evaluate(cdp, s, `${FIELD(label)}?.value ?? null`);
  const note = () =>
    evaluate(
      cdp,
      s,
      `(() => {
         const el = document.activeElement?.closest('.numfield') ?? null;
         const all = [...document.querySelectorAll('.numfield-note')].map(n => n.textContent).filter(Boolean);
         return { near: el?.querySelector('.numfield-note')?.textContent ?? null, all };
       })()`,
    );
  const setUnits = async (units) => {
    await evaluate(
      cdp,
      s,
      `fetch('/api/me/profile', { method:'PATCH', headers:{'content-type':'application/json'},
         body: JSON.stringify({ units: ${JSON.stringify(units)} }) }).then(r => r.status)`,
    );
    await page.navigate(`${BASE}/onboarding`);
    await soft(cdp, s, `document.querySelector('.onboard input') !== null`, `the ${units} form`);
    await new Promise((r) => setTimeout(r, 500));
  };

  // ── sign in ───────────────────────────────────────────────
  await page.navigate(BASE);
  await soft(cdp, s, `document.querySelector('.signin') !== null`, "the sign-in screen");
  await evaluate(
    cdp,
    s,
    `[...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('dev sign-in')).click(), true`,
  );
  await soft(cdp, s, `document.querySelector('.tabbar') !== null`, "the app shell", 20000);

  // ── imperial ──────────────────────────────────────────────
  await setUnits("imperial");
  const before = await evaluate(cdp, s, SHAPE);
  check("imperial shows the FT+IN pair", before?.shape === "ft+in", JSON.stringify(before));

  await clear("Feet");
  await clear("Inches");
  const empty = await evaluate(cdp, s, SHAPE);
  check(
    "both halves clear to empty rather than snapping to 0",
    empty?.ft === "" && empty?.in === "",
    JSON.stringify(empty),
  );
  check("…and clearing did not change the field's shape", empty?.shape === "ft+in", empty?.shape);

  // The regression itself. Typing the first digit used to destroy the input.
  await focus("Feet");
  await typeText("5");
  const afterFirst = await evaluate(cdp, s, SHAPE);
  check(
    "the first keystroke does not replace the field being typed into",
    afterFirst?.shape === "ft+in" && afterFirst?.focused === "Feet" && afterFirst?.ft === "5",
    JSON.stringify(afterFirst),
  );

  await focus("Inches");
  await typeText("10");
  await blur();
  const heightNow = await evaluate(cdp, s, SHAPE);
  check(
    "5 ft 10 in round-trips back out of centimetres unchanged",
    heightNow?.ft === "5" && heightNow?.in === "10",
    JSON.stringify(heightNow),
  );

  // Out of range clamps AND says so. The old field had min/max attributes on a
  // controlled input, which are advisory and were never consulted — so an
  // absurd value was simply accepted.
  await clear("Feet");
  await typeText("70");
  const midTyping = await val("Feet");
  check(
    "an out-of-range value is left alone WHILE typing",
    midTyping === "70",
    `got ${JSON.stringify(midTyping)}`,
  );
  await blur();
  const clamped = await val("Feet");
  const clampNote = await note();
  check("…and clamps on blur", clamped === "8", `got ${JSON.stringify(clamped)}`);
  check(
    "…and says it clamped, rather than silently rewriting the number",
    (clampNote?.all ?? []).some((n) => /MAX 8/.test(n)),
    JSON.stringify(clampNote?.all),
  );

  // ── weight ────────────────────────────────────────────────
  const wLb = "Weight in pounds";
  await clear(wLb);
  const wEmpty = await val(wLb);
  check("weight clears to empty, not to 0", wEmpty === "", `got ${JSON.stringify(wEmpty)}`);

  await typeText("180.");
  const withPoint = await val(wLb);
  check(
    "a decimal point survives being typed",
    withPoint === "180.",
    `got ${JSON.stringify(withPoint)}`,
  );
  await typeText("5");
  await blur();
  check("…and 180.5 commits", (await val(wLb)) === "180.5", `got ${await val(wLb)}`);

  // The bound has to be the one for the unit on screen. A wrong-unit ceiling
  // is invisible at ordinary weights — 180 lb is inside both the pound range
  // and the kilogram one — so this picks a value that only the correct
  // ceiling can produce. 881 lb is 400 kg rounded inward; a kilogram ceiling
  // applied to a pound field would answer 400.
  await clear(wLb);
  await typeText("900");
  await blur();
  const overWeight = await val(wLb);
  const overNote = await note();
  check(
    "an absurd weight clamps against the POUND ceiling, not the kilogram one",
    overWeight === "881",
    `got ${JSON.stringify(overWeight)} — 400 means the kg range is being applied to a lb field`,
  );
  check(
    "…and names the ceiling it used",
    (overNote?.all ?? []).some((n) => /MAX 881/.test(n)),
    JSON.stringify(overNote?.all),
  );

  // Put a real weight back so the metric half starts from something sane.
  await clear(wLb);
  await typeText("180.5");
  await blur();

  check(
    "the weight field is text, so iOS can place a caret in it",
    (await evaluate(cdp, s, `${FIELD(wLb)}?.type ?? null`)) === "text",
  );

  // ── metric ────────────────────────────────────────────────
  await setUnits("metric");
  const metric = await evaluate(cdp, s, SHAPE);
  check("metric shows a single CM box", metric?.shape === "cm", JSON.stringify(metric));

  const hints = await evaluate(
    cdp,
    s,
    `[...document.querySelectorAll('.opt-hint, .field-hint, span')]
       .map(e => e.textContent).filter(t => t && /a week\\.?$/.test(t.trim()))`,
  );
  const rateHint = (hints ?? [])[0] ?? "";
  check(
    "the deficit hint speaks kilograms to a metric user",
    /\bkg\b/.test(rateHint) && !/\blb\b/.test(rateHint),
    JSON.stringify(rateHint),
  );

  check(
    "metric weight is labelled kilograms",
    (await evaluate(cdp, s, `${FIELD("Weight in kilograms")} !== null`)) === true,
  );

  // put it back so a re-run and every other tool start where they expect
  await setUnits("imperial");
});

console.log(failures ? `\n${failures} check(s) failed` : "\nonboarding's typed fields verified");
process.exit(failures ? 1 : 0);
