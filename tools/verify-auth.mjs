#!/usr/bin/env node
// Auth smoke test (issue #6) — drives the real passkey ceremony.
//
//   npm run dev            # in another terminal
//   node tools/verify-auth.mjs
//
// WebAuthn can't be tested with curl: registration and authentication are a
// browser ceremony against an authenticator. Chrome's CDP WebAuthn domain
// provides a *virtual* platform authenticator, so the whole round trip runs
// headless — sign in, register a passkey, sign out, sign back in with only
// that passkey, and confirm the session is per-user isolated.
//
// The dev email sign-in it starts from exists only in dev builds
// (`import.meta.env.DEV` in src/worker/auth.ts); production has Google.

import { evaluate, openPage, waitFor, withChrome } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5173";

let failures = 0;
const step = (name, detail = "") => console.log(`  ✓ ${name}${detail ? `  ${detail}` : ""}`);
function check(name, ok, detail = "") {
  if (ok) return step(name, detail);
  failures++;
  console.log(`  ✗ ${name}  ${detail}`);
}

// Click the first button whose visible text contains `text`.
const clickButton = (text) => `(() => {
  const b = [...document.querySelectorAll('button')]
    .find(el => el.textContent.toLowerCase().includes(${JSON.stringify(text)}.toLowerCase()));
  if (!b) return false;
  b.click();
  return true;
})()`;

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`no dev server at ${BASE} — run \`npm run dev\` first`);
  process.exit(1);
}
const { migration } = await health.json();
if (!migration) {
  console.error("database has no migrations applied — run `npm run db:migrate` first");
  process.exit(1);
}

await withChrome(async (cdp) => {
  const page = await openPage(cdp);
  const { sessionId } = page;

  // A virtual platform authenticator: resident keys + user verification, and
  // presence auto-confirmed so nothing waits on a system prompt.
  await cdp.send("WebAuthn.enable", { enableUI: false }, sessionId);
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        ctap2Version: "ctap2_1",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
    sessionId,
  );
  step("virtual platform authenticator attached", authenticatorId);

  await page.navigate(BASE);

  // ── 1. sign in (dev bootstrap; Google in production) ──────
  await waitFor(cdp, sessionId, `document.querySelector('.signin') !== null`, {
    label: "sign-in screen",
  });
  check("sign-in screen renders unauthenticated", true);

  const methods = await evaluate(cdp, sessionId, `fetch('/api/auth-methods').then(r=>r.json())`);
  check("google offered only when configured", methods.google === false, "(not configured yet)");

  if (!(await evaluate(cdp, sessionId, clickButton("dev sign-in")))) {
    throw new Error("no dev sign-in button — is the server running a dev build?");
  }
  await waitFor(cdp, sessionId, `document.querySelector('.passkeys') !== null`, {
    label: "signed-in view",
    timeout: 20000,
  });
  check("signed in", true);

  // ── 2. register a passkey ─────────────────────────────────
  await waitFor(cdp, sessionId, clickButton("add a passkey"), { label: "add-passkey button" });
  await waitFor(cdp, sessionId, `document.querySelectorAll('.passkey-list li').length === 1`, {
    label: "passkey to appear in the list",
    timeout: 20000,
  });
  const credentials = await cdp.send("WebAuthn.getCredentials", { authenticatorId }, sessionId);
  check(
    "passkey registered on the authenticator",
    credentials.credentials.length === 1,
    `rpId=${credentials.credentials[0]?.rpId}`,
  );
  check(
    "passkey is discoverable (usable with no username)",
    credentials.credentials[0]?.isResidentCredential === true,
  );

  // ── 3. sign out ───────────────────────────────────────────
  await waitFor(cdp, sessionId, clickButton("sign out"), { label: "sign-out button" });
  await waitFor(cdp, sessionId, `document.querySelector('.signin') !== null`, {
    label: "sign-in screen after sign-out",
    timeout: 20000,
  });
  const afterSignOut = await evaluate(
    cdp,
    sessionId,
    `fetch('/api/me').then(r => r.status)`,
  );
  check("session revoked — /api/me is 401", afterSignOut === 401, `got ${afterSignOut}`);

  // ── 4. sign back in with the passkey alone ────────────────
  await waitFor(cdp, sessionId, clickButton("sign in with a passkey"), {
    label: "passkey sign-in button",
  });
  await waitFor(cdp, sessionId, `document.querySelector('.passkeys') !== null`, {
    label: "signed-in view via passkey",
    timeout: 20000,
  });
  check("signed in with the passkey alone", true);

  // ── 5. the session is a real, isolated identity ───────────
  const me = await evaluate(cdp, sessionId, `fetch('/api/me').then(r=>r.json())`);
  check("/api/me returns the signed-in user", Boolean(me?.user?.id), me?.user?.email ?? "");
  check(
    "profile row exists with theme defaults",
    me?.profile?.theme === "night-athletic" && me?.profile?.focus_macro === "protein",
    `theme=${me?.profile?.theme} accent=${me?.profile?.accent} focus=${me?.profile?.focus_macro}`,
  );
  check(
    "profile belongs to the session user",
    me?.profile?.user_id === me?.user?.id,
  );

  const injected = await evaluate(
    cdp,
    sessionId,
    `fetch('/api/me/profile', {
       method: 'PATCH',
       headers: { 'content-type': 'application/json' },
       body: JSON.stringify({ user_id: 'attacker', theme: 'instrument' })
     }).then(r => r.json())`,
  );
  check(
    "a user_id in the body cannot retarget the write",
    injected.user_id === me.user.id && injected.theme === "instrument",
  );

  // put it back so a re-run starts clean
  await evaluate(
    cdp,
    sessionId,
    `fetch('/api/me/profile', { method:'PATCH', headers:{'content-type':'application/json'},
      body: JSON.stringify({ theme: 'night-athletic' }) })`,
  );
});

console.log(failures ? `\n${failures} check(s) failed` : "\nauth verified end to end");
process.exit(failures ? 1 : 0);
