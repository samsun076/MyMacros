#!/usr/bin/env node
// Passkey-first sign-UP (#126) — drives the real WebAuthn ceremony with no
// session and no Google, then proves the account cannot be taken twice.
//
//   npm run dev            # in another terminal
//   npm run verify:signup
//
// verify-auth.mjs covers the returning user: sign in, add a passkey from
// Settings, sign out, sign back in. This covers the case that has no session
// to start from — the one a stranger deploying this repo actually hits, and
// the one that was impossible before #126.
//
// NOTHING HERE RUNS IN CI. `npm test` cannot see SignIn.tsx at all: every
// mutation this project has tried on a screen component came back green.
// Eight of them, across #81, #59, #120, #116, #24 and #102. This file is the
// only oracle the screen has, and it has to be run by hand.
//
// Each check asserts the REASON, never just the outcome. The spike in #126 had
// two assertions that passed on the wrong mechanism producing the right-looking
// answer — "a stranger is refused" went green on `Unauthorized` (session
// required) rather than on the allowlist — so a refusal here is only counted
// when its message is the one that branch is supposed to produce.

import { execFileSync } from "node:child_process";
import { globSync, readFileSync, statSync } from "node:fs";
import { evaluate, openPage, waitFor, withChrome } from "./cdp.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5173";

// The address the "create an account" path is driven with. It must be on
// ALLOWED_EMAILS or the run proves only that the allowlist works, and it must
// NOT be dev@mymacros.local — that account carries the seeded demo data every
// other tool signs in as, and this run deletes whatever it targets.
const CLAIM_EMAIL = "signup-check@mymacros.local";
const STRANGER_EMAIL = "stranger@nowhere.invalid";

// The fabricated Google login of step 5, with a fixed id so the reset can find
// it even if a run dies between inserting it and finishing.
const FAKE_ACCOUNT_ID = "verify-signup-fake";

// The exact strings src/worker/signup.ts produces. Restated here on purpose:
// this file is a check, and a check that imports the thing it is checking can
// only prove the code agrees with itself.
const MSG = {
  not_allowed: "This email is not allowed on this deployment",
  already_claimed: "That account already has a way in",
};

let failures = 0;
const step = (name, detail = "") => console.log(`  ✓ ${name}${detail ? `  ${detail}` : ""}`);
function check(name, ok, detail = "") {
  if (ok) return step(name, detail);
  failures++;
  console.log(`  ✗ ${name}  ${detail}`);
}

/** waitFor that reports a timeout as a failed check and carries on.
 *  A driver is one long loop: #24's threw at its first wait and left 27 later
 *  claims neither green nor red while still printing like a suite that ran. */
async function soft(cdp, s, expr, label, timeout = 8000) {
  try {
    return await waitFor(cdp, s, expr, { timeout, label });
  } catch {
    check(`waited for ${label}`, false, `timed out after ${timeout}ms`);
    return null;
  }
}

// ── preflight ────────────────────────────────────────────────

if (!BASE.startsWith("http://localhost")) {
  console.error(`refusing to run against ${BASE} — this deletes a user row, local dev only`);
  process.exit(1);
}

const allowList = (() => {
  try {
    const line = readFileSync(".dev.vars", "utf8")
      .split("\n")
      .find((l) => l.startsWith("ALLOWED_EMAILS="));
    return (line ?? "").split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
})();

if (!allowList.toLowerCase().includes(CLAIM_EMAIL)) {
  console.error(
    `.dev.vars ALLOWED_EMAILS must include ${CLAIM_EMAIL} for this check.\n` +
      `It is currently: ${allowList || "(unset)"}\n\n` +
      `Add it, keeping the existing entries:\n` +
      `  ALLOWED_EMAILS="${allowList ? allowList + "," : ""}${CLAIM_EMAIL}"\n\n` +
      `then restart \`npm run dev\`.`,
  );
  process.exit(1);
}

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`no dev server at ${BASE} — run \`npm run dev\` first`);
  process.exit(1);
}
if (!(await health.json()).migration) {
  console.error("database has no migrations applied — run `npm run db:migrate` first");
  process.exit(1);
}

/** The local D1 file wrangler and the Vite plugin actually share.
 *
 *  NOT `find … | head -1`, which is #106: that returns whichever file the
 *  filesystem offers first, and on this machine that has been a database
 *  frozen at migration 0005 since 4 August. Newest write wins instead. */
function localD1() {
  const files = globSync(".wrangler/state/v3/d1/**/*.sqlite");
  if (!files.length) throw new Error("no local D1 file — run `npm run db:migrate`");
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** sqlite3 with foreign keys ON.
 *
 *  The CLI defaults them OFF, per connection, which means `ON DELETE CASCADE`
 *  is silently inert — the reset below looked clean because it counted users,
 *  while an orphaned `accounts` row from the previous run survived and made
 *  the next run die on a UNIQUE constraint. Found while mutation-testing this
 *  file, which is the argument for mutation-testing it. */
function sql(statement) {
  return execFileSync("sqlite3", [localD1(), `PRAGMA foreign_keys = ON; ${statement}`], {
    encoding: "utf8",
  }).trim();
}

const countUsers = (email) =>
  Number(sql(`select count(*) from users where lower(email) = '${email}';`));

// Reset: the claim path can only be driven against an address nobody holds,
// and the run before this one held it. ON DELETE CASCADE takes the profile,
// the passkey and the sessions with it.
sql(`delete from users where lower(email) = '${CLAIM_EMAIL}';`);
sql(`delete from accounts where id = '${FAKE_ACCOUNT_ID}';`);
check(
  "reset — the claim address holds no account and no leftovers",
  countUsers(CLAIM_EMAIL) === 0 &&
    Number(sql(`select count(*) from accounts where id = '${FAKE_ACCOUNT_ID}';`)) === 0,
);

await withChrome(async (cdp) => {
  const page = await openPage(cdp);
  const { sessionId } = page;

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

  const credentialCount = async () =>
    (await cdp.send("WebAuthn.getCredentials", { authenticatorId }, sessionId)).credentials.length;

  const click = (text) => `(() => {
    const el = [...document.querySelectorAll('button, a')]
      .find(el => el.textContent.toLowerCase().includes(${JSON.stringify(text)}.toLowerCase()));
    if (!el) return false;
    el.click();
    return true;
  })()`;

  /** Fill the email field and submit the enrolment form, then return whatever
   *  the screen ends up saying — the error text, or null once signed in. */
  async function enrol(email) {
    // `.signup-open`, never the label. The button reads "Create your account"
    // on a deployment nobody has claimed and "First time here? Set up this
    // device" on one somebody has — so a text match passed on this machine
    // (which has a dev user) and failed against a genuinely fresh clone, which
    // is the only state #126 is about. Found by cloning the repo and running
    // this against it.
    await soft(cdp, sessionId, `(() => {
      const b = document.querySelector('.signup-open');
      if (!b) return false;
      b.click();
      return true;
    })()`, "the sign-up button");

    const ready = await soft(
      cdp,
      sessionId,
      `document.querySelector('.signin-enrol input') !== null`,
      "the email field",
    );
    // Null-safe, for verify-onboarding's reason: without it a missing field
    // THROWS here and every later check is neither green nor red while the run
    // still prints like a suite that executed (#24).
    if (!ready) return null;

    await evaluate(
      cdp,
      sessionId,
      `(() => {
         const input = document.querySelector('.signin-enrol input');
         const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
         setter.call(input, ${JSON.stringify(email)});
         input.dispatchEvent(new Event('input', { bubbles: true }));
         document.querySelector('.signin-enrol').requestSubmit();
         return true;
       })()`,
    );
    return soft(
      cdp,
      sessionId,
      `(() => {
         if (document.querySelector('.tabbar')) return { signedIn: true };
         const err = document.querySelector('.signin-error');
         return err ? { error: err.textContent } : null;
       })()`,
      `the screen to answer the ${email} enrolment`,
      25000,
    );
  }

  await page.navigate(BASE);
  await soft(cdp, sessionId, `document.querySelector('.signin') !== null`, "the sign-in screen");

  // ── 1. the screen offers sign-up at all ───────────────────
  // Before #126 this button did not exist and there was no route to an
  // account without Google. Its absence is the whole bug.
  const signupButton = await evaluate(
    cdp,
    sessionId,
    `(() => { const b = document.querySelector('.signup-open');
              return b ? { text: b.textContent, accent: b.classList.contains('btn-accent') } : null; })()`,
  );
  check(
    "the sign-in screen offers a way to create an account",
    signupButton !== null,
    JSON.stringify(signupButton),
  );

  const methods = await evaluate(cdp, sessionId, `fetch('/api/auth-methods').then(r=>r.json())`);
  step("auth methods", `google=${methods.google} passkey=${methods.passkey}`);

  const before = await evaluate(cdp, sessionId, `fetch('/api/me').then(r => r.status)`);
  check("starts with no session — /api/me is 401", before === 401, `got ${before}`);

  // ── 2. a non-allowlisted address is refused, FOR THE RIGHT REASON ──
  const refused = await enrol(STRANGER_EMAIL);
  check(
    "a non-allowlisted address is refused by the allowlist",
    typeof refused?.error === "string" && refused.error.includes(MSG.not_allowed),
    // The failure this wording guards against: `Unauthorized` would also be a
    // refusal, and would mean requireSession never came off.
    JSON.stringify(refused?.error ?? refused),
  );
  check("…and no credential was created for it", (await credentialCount()) === 0);
  check("…and no user row was left behind", countUsers(STRANGER_EMAIL) === 0);

  await evaluate(cdp, sessionId, click("back"));  // the Back button exists in both states

  // ── 3. an allowlisted address claims the instance ─────────
  const claimed = await enrol(CLAIM_EMAIL);
  check(
    "an allowlisted address signs up with a passkey alone — no session, no Google",
    claimed?.signedIn === true,
    JSON.stringify(claimed?.error ?? ""),
  );
  const creds = (await cdp.send("WebAuthn.getCredentials", { authenticatorId }, sessionId)).credentials;
  check("the credential is on the authenticator", creds.length === 1, `rpId=${creds[0]?.rpId}`);
  check("it is discoverable (usable with no username)", creds[0]?.isResidentCredential === true);

  const me = await evaluate(cdp, sessionId, `fetch('/api/me').then(r=>r.json())`);
  check("a real user row exists", Boolean(me?.user?.id), me?.user?.email ?? "");
  check("with the email that was typed", me?.user?.email === CLAIM_EMAIL, me?.user?.email ?? "");
  check(
    "the after-hook wrote a profile — the internalAdapter path was taken",
    // This is the assertion that catches a raw D1 insert. No profile means no
    // databaseHooks, which means ALLOWED_EMAILS never ran either.
    me?.profile?.theme === "night-athletic" && me?.profile?.focus_macro === "protein",
    `theme=${me?.profile?.theme} focus=${me?.profile?.focus_macro}`,
  );
  check(
    "and it belongs to that user",
    // Compared against a value proven non-null above: in the spike's control
    // run this passed comparing undefined to undefined.
    Boolean(me?.user?.id) && me?.profile?.user_id === me?.user?.id,
    `${me?.profile?.user_id} vs ${me?.user?.id}`,
  );

  // ── 4. sign out, then the account cannot be taken twice ───
  await soft(cdp, sessionId, click("settings"), "the Settings tab");
  await soft(cdp, sessionId, click("sign out"), "the sign-out button");
  await soft(cdp, sessionId, `document.querySelector('.signin') !== null`, "the sign-in screen again");

  // A brand-new authenticator: this is the attacker's phone, not the owner's.
  // Without one, the ceremony would be excluded by excludeCredentials and the
  // refusal would come from WebAuthn rather than from the claim rule.
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }, sessionId);
  const { authenticatorId: attacker } = await cdp.send(
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

  const second = await enrol(CLAIM_EMAIL);
  check(
    "a second sessionless enrolment for a claimed address is refused as claimed",
    typeof second?.error === "string" && second.error.includes(MSG.already_claimed),
    JSON.stringify(second?.error ?? second),
  );
  check(
    "…and knowing the address bought no credential on the second device",
    (await cdp.send("WebAuthn.getCredentials", { authenticatorId: attacker }, sessionId)).credentials
      .length === 0,
  );
  check("…and did not mint a session", (await evaluate(cdp, sessionId, `fetch('/api/me').then(r=>r.status)`)) === 401);

  // ── 5. an account held by GOOGLE alone is claimed too ─────
  //
  // This branch has no other oracle and it is the most security-relevant line
  // in the change. Counting only passkey rows would leave every Google-created
  // account — which by definition has none — claimable by anyone who knows the
  // address, and that describes the production owner's account before he
  // enrols a device. A mutation dropping `accounts.length` from the count came
  // back green on every check above until this one existed.
  //
  // The account row is fabricated rather than driven, because a real Google
  // consent screen is not reachable headlessly. The row is the *input*; the
  // real decision code runs over it, which is the same discipline
  // /trends#empty follows.
  const claimUserId = sql(`select id from users where lower(email) = '${CLAIM_EMAIL}';`);
  sql(`delete from passkeys where userId = '${claimUserId}';`);
  sql(
    `insert into accounts (id, accountId, providerId, userId, createdAt, updatedAt)
     values ('${FAKE_ACCOUNT_ID}', 'g-123', 'google', '${claimUserId}', '2026-01-01', '2026-01-01');`,
  );
  check(
    "setup — the account now has a Google login and no passkey",
    Number(sql(`select count(*) from passkeys where userId = '${claimUserId}';`)) === 0 &&
      Number(sql(`select count(*) from accounts where userId = '${claimUserId}';`)) === 1,
  );

  await evaluate(cdp, sessionId, click("back"));  // the Back button exists in both states
  const overGoogle = await enrol(CLAIM_EMAIL);
  check(
    "an account held by Google alone cannot be claimed with a passkey",
    typeof overGoogle?.error === "string" && overGoogle.error.includes(MSG.already_claimed),
    JSON.stringify(overGoogle?.error ?? overGoogle),
  );
});

console.log(
  failures ? `\n${failures} check(s) failed` : "\npasskey-first sign-up verified end to end",
);
process.exit(failures ? 1 : 0);
