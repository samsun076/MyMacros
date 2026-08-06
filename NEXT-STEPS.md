# Next steps — session playbook

State as of 2026-08-06: plan locked (PLAN.md), **M0–M3 done**, the app live at
https://fuel.debrief.run. All three input modes log a meal end to end — photograph it,
scan its barcode, or describe it — each feeding one `AnalyzeResponse` into one editable
confirm sheet, one save route and one toast. Session E closed #13–#16 and settled the
last two M3 decisions with Dave. **Next up: Session F builds M4, the budget engine
(#47 first, then #17–#21)** — where the daily target starts breathing with the running.
This file is the runway: what to run next, on which model, with paste-ready starter
prompts.

## Model guidance (Claude Code sessions)

- **Opus 5 @ xhigh** — daily driver for building issues. Best fit for well-specified agentic
  coding, which is exactly what the issue bodies are. Half Fable's price.
- **Fable @ high** — reserve for judgment-heavy work where the premium is visible: design and
  polish rounds, milestone-scale autonomous runs (e.g. "do all of M2 overnight"),
  cross-cutting debugging that makes Opus spin.
- Fanned-out subagent work multiplies whichever tier you're on — the split matters most when
  spawning agents (design agents ran ~100–120k tokens each).

## Session A — finish M0, freeze the design (Fable @ high) — ✅ done 2026-08-02

1. **#31** — build the screenshot-matrix tooling first (375/390/428 renders of any sketch),
   so everything after is verified at 375px (iPhone 13 mini = reference width).
2. **Tweak list** (comment on #2) applied to `sketches/c2-night-athletic.html`:
   Safari chrome blend via surface token · 375px timeline fix (narrower time rail, splits on
   their own full-width row) · focus-macro treatment (accent = targeted macro, default protein).
3. **#2** — semantic token schema (CSS custom properties + `data-theme`) + full Night Athletic
   pack incl. coral/gold/mint accent variants; document the motif slots.
4. **#3** — log-flow mockup (+ → camera → editable confirm sheet → saved) in Night Athletic,
   verified at 375.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros, github.com/samsun076/MyMacros). Read
PLAN.md fully first — especially the Theming section and Build rules. Work is
tracked in GitHub issues; this session finishes milestone M0.

Do in order:
1. Issue #31 — build the design-QA screenshot tooling: render any sketches/*.html
   at 375/390/428px widths via headless Chrome into side-by-side PNGs. 375
   (iPhone 13 mini) is the reference width for everything after this.
2. Apply the tweak list (comment on issue #2) to sketches/c2-night-athletic.html:
   Safari chrome blend via the surface token, fix the 375px timeline scrunch
   (narrower time rail, mile splits on their own full-width row), and the
   focus-macro treatment (accent = targeted macro, default protein). Verify at
   375 with the new tooling.
3. Issue #2 — extract the semantic design-token schema (CSS custom properties +
   data-theme) and the full Night Athletic pack including the coral/gold/mint
   accent variants; document the motif slots.
4. Issue #3 — mock the log flow (+ button → camera → editable confirm sheet →
   saved) in Night Athletic, verified at 375.

Load the frontend-design and dataviz skills before any design work. The quality
bar is world-class, no AI slop — the v2 mockups set the standard; don't regress
them. Commit per issue with "closes #N", push when done.
```

## Session B1 — M1 scaffold, autonomous half (Opus 5 @ xhigh) — ✅ done 2026-08-02

Everything in M1 that needs zero credentials — run it unattended. Issues **#4, #5, #8**
plus the code side of **#6**:

- Project `CLAUDE.md` first (build rules from PLAN.md incl. the field-tested chrome-blend
  mechanics, dev commands, conventions) so every future session self-orients.
- #4 Workers project (Vite + React + Hono), local dev working end to end.
- #5 D1 schema + migrations (incl. theme, accent, focus_macro columns in profiles) —
  applied to the *local* D1 (miniflare sqlite); remote apply waits for B2.
- #6 better-auth wiring (Google + passkeys) in code, with Google client ID/secret as env
  placeholders — passkeys need no external setup, Google creds land in B2.
- #8 PWA shell — tab bar per the frozen theme conventions (opaque --chrome, body bg =
  --bg-top on phone widths), manifest, tokens.css imported, verified at 375 via
  tools/shot-matrix.mjs.

Last act: rewrite the Session B2 checklist below with the exact pending items and any
values/URLs Dave will need, so B2 is a paint-by-numbers pairing session.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros). Read PLAN.md, NEXT-STEPS.md and
design/TOKENS.md, then run Session B1: the autonomous half of M1. Start by
writing the project CLAUDE.md. Then issues #4, #5 (local D1 only), the code
side of #6 (better-auth with Google creds as env placeholders; passkeys
fully), and #8 (PWA shell per the frozen theme conventions, verified at 375
with tools/shot-matrix.mjs). Do NOT block on anything needing my accounts —
stub it, and finish by updating the Session B2 checklist in NEXT-STEPS.md
with exactly what's pending. Commit per issue ("closes #N" only where the
issue is fully done — #6 stays open for B2), push when done.
```

## Session B2 — M1 credentials & deploy — ✅ done 2026-08-03/04

**Landed:** #6, #7, #34 closed; step 0 of #33 (the `ALLOWED_EMAILS` guard). The app is live
on the custom domain, migrated, and signed into with Google plus an enrolled passkey.

What differed from the checklist below, worth carrying forward:

- **`wrangler login` wasn't needed** — already authenticated, and that OAuth token *can*
  read zones, so `debrief.run` was confirmed on the account by API rather than by eye.
  It cannot read DNS records or the Builds API, so those stayed manual.
- **No `workers.dev` subdomain existed**, so the first deploy failed for want of any route
  at all. Rather than register one to then disable it, the custom domain is declared in
  `wrangler.jsonc` as `routes: [{ pattern: "fuel.debrief.run", custom_domain: true }]` with
  `workers_dev: false` — so Workers Builds reapplies it instead of drifting.
- **R2 is not enabled on the account**, so `mymacros-photos` was not created. Nothing reads
  it until M3; enable it with the code that uses it (#13).
- **Google OAuth lives in its own Cloud project** (`mymacros-504422`, published), not the
  shared `n8n automations` one. The first client created there was deleted.
- **The OAuth callback was silently swallowed** by the SPA asset router — see the gotchas in
  CLAUDE.md, `assets.run_worker_first`, and `npm run verify:routing`. This cost most of the
  session and is the single most reusable thing learned.
- **Secret pushes lag by up to a minute.** Old isolates keep serving the previous env, so a
  freshly-pushed secret intermittently isn't there. Redeploy to recycle, then re-check
  several times before believing it.

Left open, and **moved out of M1 so the milestone could close** (rationale is on each issue):

- **#38 → M5** — the tab bar doesn't cover the bottom safe area in standalone; it
  self-corrects after the first scroll. Not M1's job: #8 delivered as far as its tooling
  reached, and headless Chrome reports `env(safe-area-inset-*)` as 0, so it cannot see this
  class of defect at all. Needs a device or the iOS Simulator, alongside M5's render check.
- **#39 → M5** — what `theme-color` actually does in standalone; three contrast runs were
  defeated by iOS manifest caching. Parked with #38 so one device session settles both. It
  only starts to matter in M5: today `theme_color`, `--bg-top` and the body background are
  all `#1a2230`, and the light packs (#30) are where those values first diverge.
- **#33 → M6** — the urgent half (`ALLOWED_EMAILS`) shipped here; what remains is the claim
  route and session-less passkey registration, which exist to serve self-hosters (#26).

<details>
<summary>The original B2 checklist, kept for reference</summary>

## Session B2 — M1 credentials & deploy, together (Opus 5 @ xhigh, Dave present)

The half that needs Dave's accounts — do it paired; ~20–30 min. Finishes **#6** and **#7**
and closes M1. Everything below is blocked on a login or a console only Dave can reach;
nothing here is code that could have been written in B1.

**The URL is already decided: `https://fuel.debrief.run`** (#34). That's a change from the
earlier plan of deploying to `workers.dev` first and learning the URL — everything identity-
related is now known up front, so `APP_URL` and `PASSKEY_RP_ID` are already committed in
`wrangler.jsonc` and the Google console can be filled in before the first deploy rather than
after. `.dev.vars` overrides both locally, so local dev keeps pointing at `localhost:5173`.

**Passkeys bind to `debrief.run`, not `fuel.debrief.run`** — deliberate, so one credential
covers every `*.debrief.run` app as they appear. It cannot be changed after anyone enrols
without forcing them all to re-enrol.

### 0. The one code change: shut the open door (#33)
Do this first, so the app is never publicly reachable without it. Everything else in B2 is
console work; this is the only code.

A `databaseHooks.user.create.before` in `src/worker/auth.ts` that refuses any user whose
email isn't in an `ALLOWED_EMAILS` var, plus that var set to Dave's Google address. Without
it, any Google account that finds the URL gets an account — and from M2, spends the
deployment's `ANTHROPIC_API_KEY`. Roughly fifteen lines. The fuller claim mechanism for
self-hosters (#33's second half) is not needed today and shouldn't be built here.

### 0.5. Doppler — ✅ already done, nothing to do in the session
Secrets live in Doppler and are *pushed* to Cloudflare — Doppler is never consulted at
runtime. The app reads plain `env` bindings and has no idea Doppler exists, which is what
keeps a self-hoster on `wrangler secret put` with no extra account.

The **`mymacros` project exists**, separate from `program-cf` (which holds tokens that can
edit DNS and buy domains — different blast radius, different rotation). Populated:

- `dev` — `APP_URL=http://localhost:5173`, `PASSKEY_RP_ID=localhost`, a throwaway
  `BETTER_AUTH_SECRET`, and empty `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
  `ANTHROPIC_API_KEY` waiting to be filled.
- `prd` — a real `BETTER_AUTH_SECRET`, generated. Nothing else yet.

`.dev.vars` is now generated rather than hand-edited, and local dev is verified working from
it (passkey ceremony green):
```
doppler secrets download -p mymacros -c dev --no-file --format env | grep -v '^DOPPLER_' > .dev.vars
```

**Always filter `DOPPLER_*`.** Doppler injects `DOPPLER_PROJECT`, `DOPPLER_CONFIG` and
`DOPPLER_ENVIRONMENT` into every config. Unfiltered they become bindings in
`worker-configuration.d.ts` locally, and real Worker secrets in production.

**Never put `APP_URL` or `PASSKEY_RP_ID` in `prd`.** Those are `vars` in `wrangler.jsonc`;
pushing them as secrets too would leave two sources for one name.

### 1. Log in — `! npx wrangler login`
Browser OAuth click-through.

**The existing `program-cf` token can't be reused — checked.** It's valid and active, but it
returns `Authentication error` on both Workers Scripts and D1, and can enumerate no zones or
accounts, so it's DNS-scoped. If a non-interactive login is wanted later (useful for CI),
mint a new token with *Workers Scripts:Edit*, *D1:Edit*, *Workers R2 Storage:Edit* and
*Account Settings:Read*, and store it in the `mymacros` Doppler project — then
`doppler run -- npx wrangler deploy` needs no browser at all.

### 1b. Confirm `debrief.run` is a zone on this Cloudflare account
The custom domain needs Cloudflare-managed DNS. **This could not be verified via API** — the
`program-cf` token lacks `Zone:Read`, so it lists zero zones whether or not they exist.
Check the dashboard by eye. Dave believes it's already there (debrief.run is live), in which
case there's nothing to do.

If it isn't: dashboard → Add a site → change nameservers at the registrar → wait for active.
That's the only step here with unbounded latency, so confirm it before starting.

### 2. Create the real D1
```
npx wrangler d1 create mymacros-db
```
Paste the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id`,
replacing `"local-dev-placeholder"`. **`wrangler deploy` fails until this is a real id.**

Optionally also `npx wrangler r2 bucket create mymacros-photos` — nothing reads it until
M3, and the binding gets written in #13 alongside the code that uses it, so creating the
bucket early only saves a trip back to the CLI.

### 3. Push the secrets Doppler already holds
`BETTER_AUTH_SECRET` is **already generated** in `mymacros/prd` — better-auth signs session
cookies with it. Local dev has its own throwaway value; the two are unrelated.

Push everything Doppler holds into the Worker in one shot (repeat this after any secret
changes — Workers Builds deploys from Cloudflare's CI and will never run `doppler`):
```
doppler secrets download -p mymacros -c prd --format json --no-file \
  | jq 'with_entries(select(.key | startswith("DOPPLER_") | not))' \
  | npx wrangler secret bulk
```

### 4. Deploy, then attach the custom domain
```
npm run deploy
```
Then dashboard → Workers & Pages → **mymacros** → Settings → Domains & Routes → **Add
custom domain** → `fuel.debrief.run`. Cloudflare creates the DNS record and issues the
certificate itself; give it a minute, then `curl https://fuel.debrief.run/api/health`.

The `workers.dev` URL keeps working alongside it. Worth disabling it in Settings once the
custom domain is live — **because of this deployment's rpID specifically**, not because
`workers.dev` is unsuitable in general. A passkey's rpID must be the hostname or a parent of
it; we claim `debrief.run`, which is not a parent of `*.workers.dev`, so passkeys refuse
there. A self-hoster who sets no `PASSKEY_RP_ID` gets the hostname as its own rpID and
passkeys work on `workers.dev` fine, with no domain at all.

### 5. Apply the migrations remotely
```
npm run db:migrate:remote
```
One migration, `0001_schema_v1.sql`, 21 statements. Confirm with
`curl https://fuel.debrief.run/api/health` → `{"ok":true,"db":true,"migration":"0001_schema_v1.sql"}`.

### 6. Google OAuth client (finishes the credential half of #6)
Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client
ID → Web application**. Name it "MyMacros". Then:

| Field | Value |
|---|---|
| Authorised JavaScript origins | `https://fuel.debrief.run` **and** `http://localhost:5173` |
| Authorised redirect URIs | `https://fuel.debrief.run/api/auth/callback/google` **and** `http://localhost:5173/api/auth/callback/google` |

The `/api/auth/callback/google` path is better-auth's convention (`basePath` + provider) —
it is not configurable in our setup, so it must be typed exactly. Include the localhost
entries or Google sign-in only ever works in production. If the consent screen isn't set up
yet, Google prompts for it first: External, app name "MyMacros", Dave's email for support
and developer contact, no scopes beyond the defaults. Then **click Publish app**: we only
request email/profile/openid, which are non-sensitive, so publishing needs no Google review
and removes Testing mode's 100-test-user cap and weekly refresh-token expiry.

Then, with the client ID and secret it hands back — into Doppler, then pushed to Cloudflare:
```
doppler secrets set GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET -p mymacros -c prd
doppler secrets download -p mymacros -c prd --format json --no-file \
  | jq 'with_entries(select(.key | startswith("DOPPLER_") | not))' | npx wrangler secret bulk
npm run deploy
```
Put the same pair in the `dev` config too and regenerate `.dev.vars` to get Google sign-in
working locally.
`GET /api/auth-methods` should flip to `{"google":true,...}` and the sign-in screen grows a
"Continue with Google" button. It hides itself while the credentials are missing, so that
response is the check that this step actually worked.

Optionally paste the same pair into `.dev.vars` to get Google sign-in locally too.

### 7. Connect the repo to Workers Builds (#7)
Cloudflare dashboard → **Workers & Pages → mymacros → Settings → Builds → Connect** →
GitHub OAuth grant → pick `samsun076/MyMacros`, branch `main`. Build command `npm run
build`, deploy command `npx wrangler deploy`. Then push an empty commit and watch it build,
so push-to-deploy is proven rather than assumed.

### 8. `ANTHROPIC_API_KEY`
`doppler secrets set ANTHROPIC_API_KEY -p mymacros -c prd`, then the same `secret bulk`
push. Can slip to M2 — nothing in M1 calls Claude — but it's the only secret that costs
money, so it's the one most worth having a single home for.

### 9. Smoke test on the phone

> Assumes step 0's allowlist is in place. If it was skipped, don't share the URL — any
> Google account that reaches `fuel.debrief.run` can create an account, and from M2 those
> accounts spend the deployment's `ANTHROPIC_API_KEY`.

1. Open `https://fuel.debrief.run` in iOS Safari → **Continue with Google** → lands on Today.
2. **Settings → Add a passkey** → Face ID → the key appears in the list.
3. Sign out → **Sign in with a passkey** → back in, no Google round-trip.
4. Share → **Add to Home Screen**, check the icon, launch it standalone.
5. Check the chrome blend in both modes: in Safari the top chrome should match the page top
   and the bottom bar should meet the tab bar with no seam; in standalone, note whether
   `theme-color` is honoured — **this answers the open Memex question about theme-color in
   PWA mode**, so write down what it actually does.

### Settled: the domain and the passkey scope — **#34**
`fuel.debrief.run`, with passkeys bound to `debrief.run` so one credential covers every
`*.debrief.run` app as they appear — MyMacros already consumes debrief's run data, and a
shared login is the obvious next step. Both values live in `wrangler.jsonc`; `.dev.vars`
overrides them locally. Neither can change after anyone enrols without forcing a re-enrol,
which is why it was settled before the first production passkey rather than after.

### Left open on purpose, found during B1

All of these are filed — this list is a pointer, not the record. Anything that only lives
in this file is one rewrite away from being lost, since each session replaces its own
runway section.

- **#33 — nothing restricts who can create an account.** Reframed and moved to M1: this
  stops being hypothetical the moment the domain is live. See the warning in step 9.
- **#34 — settled:** `fuel.debrief.run`, passkey rpID `debrief.run`. Closes once the custom
  domain is actually attached in B2 step 4.
- **#35 — self-host the fonts** instead of the Google Fonts CDN.
- **Tab bar at 375: "TRENDS SETTINGS" sit tight together.** Raised on the #2 thread with a
  side-by-side crop showing the app matches the frozen sketch exactly — inherited from the
  design, not a port bug, so any fix is a deliberate change to it.
- **No service worker** — deliberately not filed. Not needed for iOS Add-to-Home-Screen,
  which is all #8 promised, and offline caching isn't scoped anywhere yet; an open issue
  with no milestone is just noise. Revisit if offline becomes a goal.

### Starter prompt (paste verbatim, with Dave at the keyboard)

```
Working on MyMacros (~/Projects/MyMacros). Read CLAUDE.md and NEXT-STEPS.md —
we're doing Session B2 together: the credential/deploy half of M1. It closes
#6, #7 and #34, and lands step 0 of #33. I'm here to click OAuth prompts and
paste secrets; you drive.

Work the B2 checklist in order, one step at a time. Tell me exactly what to
do when it's my turn (use `! <command>` for anything interactive), and verify
each step actually landed before moving on — don't take a command exiting 0
as proof. Deploy target is https://fuel.debrief.run; passkeys are scoped to
debrief.run on purpose, so don't "fix" that.

End with the smoke test on my phone, and write down what theme-color does in
standalone mode — that's an open question we've never answered. Commit per
issue with "closes #N" only where the issue is genuinely finished, push when
done, and update the Then section of NEXT-STEPS.md for M2.
```

</details>


## Sessions C1 + C2 — the two reviews — ✅ done 2026-08-04

| | Session | Model | Verdict |
|---|---|---|---|
| **C1** | Audit | Opus 5 @ xhigh | Filed #40–#46; fixed #40/#41/#42; #43/#44 settled with Dave; Dave filed #47 (test infra, M4) after |
| **C2** | Judgment | Fable @ high | **Design fidelity: faithful.** Verified by eye at 375/390/428 — tab bar pixel-identical to the sketch, header type verbatim (both 27px), sign-in/settings coherent with the system; no drift found beyond what's filed (#46). **Architecture: build on it.** One decision filed as #48 (client data layer + `GET /api/day/:date`), to land at the start of D. Motif registry signed off on #43 — not reopened. `db.ts` hand-mirror and hand-rolled validators judged fine to live with at this scale |

What C2 checked and how, so nobody re-does it: rendered the signed-in app locally
(recipe preserved in the D prompt below), opened the PNGs and compared against
`sketches/c2-night-athletic.html` crops side by side — chrome, header, buttons, type.
`npm run check` and `npm run verify:routing -- https://fuel.debrief.run` both green.

## Session D — build M2, the core loop — ✅ done 2026-08-04

**Landed:** #9, #10, #11, #12, #48 closed by commit; #45 closed with a summary; motif
registry stood up per #43's settled shape; migration 0002 (`profiles.target_kcal`)
applied locally and remotely. `npm run check` green, `verify:routing` green against
production, every screen shot-matrixed at 375/390/428 and eyeballed against the frozen
sketches. Measured: text quick-add round-trips Claude in ~4.6s (PLAN.md promises <10s).

What D settled or discovered, worth carrying forward:

- **One save = one meal = one shared `logged_at` instant.** The confirm sheet writes one
  `food_logs` row per item, all stamped with the same instant, and both the Today timeline
  and `/api/food-logs/recent` fold rows sharing that instant back into a single meal entry.
  That is how the sketch's combined breakfast row ("Greek yogurt, blueberries, granola")
  falls out of per-item rows without a meal_id column. An edit route, when one lands, must
  preserve `logged_at` for the same reason it must preserve `logged_on`.
- **The slot chip is the slot picker.** Derived from the clock, displayed as
  "Lunch · 12:38", and tapping the chip cycles breakfast→lunch→dinner→snack. No picker
  control was invented — the sketch designs none (#44).
- **Zero-earned meter rendering:** the `.earned` layer renders at zero width with its
  boundary tick suppressed, and the scale shows `0 … BASE 1,810 ▸` with no separate
  adjusted-total label (base == adjusted until M4 fills `run`). M4 restores the sketch's
  three-label scale by supplying data, not by re-laying-out the hero.
- **DEV-only hash stages** mirror the sketch convention for shot-matrix: `/log#confirm`
  opens the sheet pre-filled with the sketch's demo meal, `/#saved` shows the toast.
  Both are gated on `import.meta.env.DEV` (build-time literal, compiled out of prod).
- **shot-matrix hash gotcha:** hash stages of the same path also overwrite each other
  (`/log` and `/log#confirm` both write `app-log@*.png`) — same copy-aside rule as the
  auth-state gotcha.
- **Local D1 has a stale twin.** `find .wrangler/state/v3/d1 -name '*.sqlite' | head -1`
  can grab the pre-B2 database (old `database_id`, has its own dev user, stops at
  migration 0001). When touching the sqlite file directly, pick the one whose
  `d1_migrations` is current.
- **Today still fetches `/api/me` alongside `/api/day/:date`** — the day bundle carries
  `target_kcal` but not the macro split or focus macro. Fine at two parallel requests;
  if M4's day payload grows anyway (#19/#21 fill `run`), consider folding the profile
  fields the screen needs into it then.
- **Production quick-add: verified 2026-08-05** (browser-harness against Dave's real
  session, morning after the deploy): black coffee → confirm sheet → saved, toast and
  fresh entry rendered, budget moved exactly +2 kcal. The test surfaced two issues:
  **#49** (analyze took 33s in prod vs 4.6s local — suspect SDK retry backoff) and,
  from Dave's phone, **#51** (standalone PWA letterboxes a ~430px column — layout
  viewport wider than the device; hypotheses and a device recipe on the issue).

## Pre-E session — 2026-08-05 evening ✅ done

Ran before Session E to clear the two open defects and settle M3's decisions.

- **#51 fixed and closed.** Not the bug it was filed as. `#root` is `<body>`'s only flex
  item, so it shrink-to-fits its content; `.frame`'s `width:100%` resolved against it and
  the app drew a *growing column* on every load — 44px at the empty splash, 261px once the
  header rendered, full width only after the day's data arrived. Present since M1. The
  issue is rewritten as the record, including the list of what it *wasn't* (page zoom,
  desktop-site mode, stale install, the fonts, the iOS launch animation) so nobody
  re-treads them. Fix is four lines on `#root`.
- **`npm run verify:viewport`** (`tools/verify-viewport.mjs`) — the regression guard.
  Checks scrollWidth **and** per-element boxes, because the tab bar is `position:fixed`
  and a fixed element crossing the edge doesn't move `scrollWidth`.
- **#49 measured, still open.** 33s not reproduced across 11 production + 17 control
  samples; **zero retries**. Production is indistinguishable from calling the API off a
  laptop, so the Worker adds nothing. The finding for #16: the slowest call of the whole
  exercise (11.3s) was a *single un-retried attempt*, so `maxRetries: 0` would not have
  prevented it — a wall-clock budget is the lever, not an attempt cap. Instrumentation
  is live and will catch the next one.
- **#53 / #54 filed** — cold-launch white screen (inline the 4.2 KB CSS, fonts off the
  critical path, static app shell, `apple-touch-startup-image`) and service-worker
  precache. Both M5. #35 is a subtask of #53.
- **CLAUDE.md gotchas added** — production's session cookie is `__Secure-`-prefixed, and
  design QA structurally cannot see loading states.

## Session E — build M3, photo & barcode — ✅ done 2026-08-06

**Landed:** #13, #14, #15, #16 all closed by commit. M3 is complete and live. The Log
screen's three modes all work: PHOTO (live viewfinder → Sonnet 5 vision), BARCODE
(scan → OpenFoodFacts), TEXT (M2's quick-add), each feeding the same `AnalyzeResponse`
into the same confirm sheet, save route and toast. `npm run check`, `verify:viewport`
(now 8 routes × 3 widths, with a live camera) and `verify:routing` against production
all green; deploy confirmed live by matching production's asset hash against a local
build of HEAD.

Decisions 4 and 5 were settled with Dave mid-session and are **recorded as comments on
#15 and #16** — that's the record, this is the pointer.

### What E settled or discovered, worth carrying forward

- **Three input modes, one contract.** `AnalyzeResponse` grew `photo_key`, `barcode` and
  `grams`, and nothing else changed: the sheet, the save route and the toast still don't
  know which mode produced the items. A fourth reader plugs in the same way.
- **R2 keys are `<userId>/<uuid>.jpg`, and the prefix IS the authorization.** Not a
  convention — it's the check, for both `GET /api/photos` and a `photo_key` arriving on a
  save. A row can't be consulted instead: the sheet shows the photo before any row
  exists. Verified: a foreign prefix 404s on read and is refused on save.
- **The Worker writes R2 before it calls Claude**, so `photo_key` comes back on the
  *error* bodies too. That single ordering is what makes #16's "never lose the photo"
  structural. Proven by failing the analyze call at the network layer and driving the
  recovery to a saved row — the timeline thumbnail was the photo.
- **A wall-clock deadline must be an `AbortSignal`, not the SDK's `timeout`.** The SDK
  *retries* timeouts, so a 20s `timeout` with `maxRetries: 2` is a 60s worst case. An
  abort is terminal. This is #49's finding turned into code: an attempt cap was never the
  lever, since the slowest measured call was a single un-retried attempt.
- **OpenFoodFacts, measured not read:** an unknown product is **HTTP 200 with
  `status: 0`** (checking the status code reports every unknown barcode as a success),
  and **`serving_size` is null even for Nutella** — the reliable fields are the per-100g
  nutriments, which is why the sheet grew a grams field instead of a serving picker.
- **The barcode polyfill fetches its wasm from jsdelivr by default.** Aliased in
  `vite.config.ts` and emitted as one of our own hashed assets instead. Verified the
  hard way — blocking `*jsdelivr*`, `*unpkg*` and `*cdn.*` at the network layer, and
  confirming a scan still decodes. Worth re-checking after any `@sec-ant/*` upgrade.
- **The design tooling can see more than it could.** `shot-matrix` gained `--camera`
  (synthetic device, permission auto-granted) and `--settle <ms>`; without them the
  primary state of the camera screen is literally unshootable, because headless Chrome
  has no camera and `getUserMedia` resolves long after `document.fonts.ready`.
  `verify:viewport` gained `--camera` and covers `/log#barcode` and `/log#text`.
- **`/log#photo`, `/log#barcode`, `/log#text`** address the modes for shot-matrix, the
  way the frozen sketch addresses its own stages. Unlike `#confirm` they inject no demo
  data, so they aren't DEV-gated.
- **A bug only driving the real UI could find:** the shutter armed when `getUserMedia`
  resolved, but a `<video>` has no frame until `loadeddata` — tapping immediately
  captured a blank. It now arms on the first decoded frame. Reading the code would not
  have found this; clicking the real shutter did.

### ⚠️ What Session E did NOT verify

Everything below is honest gap, not oversight. Nothing here blocks M4.

- **Meal (plate) estimation quality.** The label half is verified exactly — a rendered
  nutrition panel came back 240 kcal · 15P · 22C · 11F against known ground truth, at
  confidence 0.95 in 4.3s. Judging a portion from a real plate needs a real photo off a
  real sensor. **The one-line check: photograph a meal on the phone and see whether the
  numbers and the confidence are sane.** If label reads ever come back lossy, the lever
  is raising the long edge for that mode only (Sonnet 5 takes 2576px; we send 1568 as a
  deliberate cost choice) — no schema or contract change needed.
- **Real capture on device** — the iOS permission prompt, standalone PWA behaviour, and
  whether the viewfinder fills the frame the way the synthetic stream does.
- **Scanning a real barcode on a real package** — curvature, gloss and focus are exactly
  what a generated flat EAN-13 doesn't test.
- **The analyze deadline firing.** Never hit in practice; the instrumentation logs
  `outcome: "deadline"` if it ever does.

## Session F — build M4, the budget engine (Opus 5 @ xhigh)

Issues **#17–#21**, plus **#47** first. This is where the app stops being a food diary
and starts being the thing PLAN.md describes: a budget that breathes with the running.

### Order of work (dependencies, not preference)

1. **#47 — test infrastructure, before the budget math.** Filed by Dave after C1 and
   explicitly scheduled "before M4's budget math lands". M3 is the argument for it: the
   money-costing routes and the file upload now exist and were verified by hand-rolled
   CDP drivers in a scratch directory. Those drivers proved real bugs (the `loadeddata`
   race, the CDN default) and then evaporated. TDEE arithmetic is the first thing in this
   codebase where a wrong number is silently wrong rather than visibly broken — it earns
   real tests, and M3's routes are the first customers.
2. **#17 — onboarding: TDEE (Mifflin-St Jeor) + deficit + macro split.** `profiles`
   already carries every input (`sex`, `birth_date`, `height_cm`, `activity_level`,
   `goal`, `deficit_kcal`, the three `*_pct` columns). M2 shipped `target_kcal` as a
   static column in migration 0002 — M4 changes how it is *calculated*, not where it
   lives.
3. **#18 — weight log: manual entry + 7-day smoothed trend.** `weights` exists with a
   unique index on `(user_id, measured_on)`, which is what makes the smoothing
   well-defined and lets a sync re-POST the same day forever.
4. **#19 — sync endpoint + the debrief `runs.db` push script.** `runs` exists with a
   unique `(user_id, external_id)`; NULLs stay distinct in SQLite so manual runs don't
   collide while synced ones stay idempotent.
5. **#20 — Garmin Connect weight sync** via `python-garminconnect` in the same local
   pipeline. Needs Dave's credentials — pair on it.
6. **#21 — eat-back: a configurable share of run calories adjusts today's budget.**

### The two things M4 turns on that are already built waiting

- **`DayResponse.run` is `null` by construction and typed that way on purpose** (#48).
  #19/#21 fill it; the Today screen's arithmetic is already written against
  `base + earned`.
- **The budget meter's `.earned` layer already renders**, at zero width with its boundary
  tick suppressed, and the scale already shows `0 … BASE 1,810 ▸`. M4 restores the
  sketch's three-label scale **by supplying data, not by re-laying-out the hero.** If you
  find yourself editing `BudgetMeter`'s layout, stop and check whether the data is what's
  missing.

### Worth deciding early

- **Today fetches `/api/me` alongside `/api/day/:date`** because the day bundle carries
  `target_kcal` but not the macro split or focus macro. D flagged that if M4's day
  payload grows anyway — and #19/#21 grow it — that's the moment to fold the profile
  fields the screen needs into it and drop to one request.
- **`#37` (deployment-neutral defaults) is M6, but M4 is where the schema stops being
  neutral** — TDEE assumes imperial-vs-metric handling, and `profiles.timezone` starts
  being read server-side with no client present. Worth a glance at #37 before choosing
  defaults, so M6 has less to undo.

### Guardrails that exist and shouldn't be broken

- **Every new API route under the `secure` sub-app**; `c.var.user`, never a userId from
  the request. The sync endpoint (#19) is the exception worth thinking hard about — it's
  called by a machine, not a browser, so it needs its own auth story rather than a
  session. Decide that with Dave before writing it.
- **`npm run verify:routing -- https://fuel.debrief.run`** after any `wrangler.jsonc`
  change and after the final push. **`npm run verify:viewport -- --camera --cookie …`**
  for layout. `npm run check` green before every commit.
- **Migrations are append-only.** M4 will add columns; new file every time.
- Never hardcode a color/font/radius — add a token. Motif slots only through the registry.

### Deliberate — don't let a session "fix" these

Everything in D's and E's lists above, plus:

- **`thinking: disabled` + `effort: low` on both analyze routes.** Latency is the product
  promise; the label read measured 4.3s and the text path 4.6s.
- **1568px at q0.8 on upload**, not Sonnet 5's 2576px ceiling — a deliberate cost choice
  (~3× the image tokens at the limit), revisited per-mode only if label reads go lossy.
- **The camera stage's fallback has no button** — the shutter itself hands off to the
  system camera, so there is one control where the user already expects it.
- **Barcode mode has no shutter.** Scanning is continuous; the ring is a status, and it
  keeps the deck's geometry so switching modes doesn't jump.
- **A row typed from scratch is not `edited`.** That flag answers "how good are the AI's
  estimates?", and a manual entry had no estimate to correct.
- **The scan loop pauses on a failed lookup.** Without it the next frame re-reads the
  same code and the failure repeats forever.

### Carried over, not blocking M4

**#49** prod analyze latency — instrumentation is live on both routes and now logs a
`deadline` outcome; still never reproduced · **#38/#39** standalone chrome + theme-color
→ M5's device pass · **#51** was fixed and closed in the pre-E session · **#30/#35/#46/
#36/#32/#52/#53/#54** → M5 (note **#35** and the barcode wasm are the same class of
problem, and the wasm half is now solved — the pattern in `vite.config.ts` is reusable
for the fonts) · **#33/#37/#55** → M6.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros, github.com/samsun076/MyMacros).
M0–M3 are done and live at https://fuel.debrief.run — photo, barcode and
text all log a meal end to end. This is Session F: build M4, the budget
engine, issues #17–#21, with #47 first.

Read CLAUDE.md, PLAN.md (Locked decisions + Build rules), design/TOKENS.md,
and the Session F section of NEXT-STEPS.md. Use GH_PAGER=cat for every gh
read — it prints nothing otherwise.

Start with #47, test infrastructure. It's scheduled before the budget math
on purpose: TDEE arithmetic is the first thing in this codebase where a
wrong number is silently wrong rather than visibly broken, and M3's analyze,
photo, barcode and food-log routes are its first customers. Pick the
lightest thing that runs in CI and against the Worker; don't build a
framework.

Then #17 → #18 → #19 → #21 in that order. #20 (Garmin) needs my credentials
— surface it when you get there rather than blocking on it. Two things are
already built waiting for M4's data: DayResponse.run is typed null on
purpose (#48), and the budget meter's earned layer already renders at zero
width. Fill them with data; if you find yourself re-laying-out BudgetMeter,
stop and check whether data is what's actually missing.

#19's sync endpoint is called by a machine, not a browser, so it needs its
own auth story rather than a session — settle that with me before writing
it, and don't weaken the rule that every other route reads c.var.user.

Verify screens at 375/390/428 with the signed-in shot-matrix recipe and LOOK
at the PNGs; run npm run verify:viewport -- --camera --cookie <name>=<token>.
npm run check stays green; migrations are append-only. Commit per issue,
"closes #N" only where genuinely finished, push when done (push deploys),
re-run npm run verify:routing -- https://fuel.debrief.run after the final
push, and rewrite the Session F section of NEXT-STEPS.md as the M5 runway
before you stop.
```

### One device check owed from M3 (5 minutes, any time)

On the phone, at `https://fuel.debrief.run`: photograph a real meal and check the numbers
and confidence are sane; scan a real package's barcode; confirm the camera permission
prompt and the standalone viewfinder behave. None of it blocks M4 — but it's the half of
M3 that headless Chrome structurally cannot reach, and the sooner it's known the cheaper
any fix is.
