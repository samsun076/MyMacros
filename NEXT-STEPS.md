# Next steps — session playbook

This file is the runway: what to run next, on which model, with paste-ready
starter prompts. Sessions are appended in order, oldest first.

**The current state of the project is the last session section in this file —
not this header.** Scroll to the bottom, or `grep -n '^## Session' NEXT-STEPS.md`
and open the last hit; its "Next up" heading is what to run and its "Still owed"
list is what the milestone is waiting on. For the board itself, ask GitHub
rather than this file:

```bash
gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title)  open:\(.open_issues)"'
gh issue list --milestone "M9 Budget truth" --state open
```

This paragraph used to restate milestone status and a "next up" line, and it was
wrong for five consecutive sessions — H, I, J, K and L each appended a section
and left the header describing Session F. A summary that lives in two places is
the defect #86 swept for; the fix is that it lives in one. Don't reintroduce a
dated state line here.

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

## Session F — M4, the budget engine — ⚠️ half done 2026-08-07

**Landed and deployed:** #47 and #17 closed; #18 all but its chart. The app now
computes a real budget: Mifflin-St Jeor → TDEE → deficit → target, recalculated
from the 7-day weight trend, with onboarding and a weigh-in screen behind it.

**Not started: #19, #20, #21.** They are the second half of M4 and they are
ordered — #21 has nothing to show until #19 supplies run data, so stopping after
#18 is a clean boundary rather than a ragged one.

### What changed that the next session should know

- **There is a test suite now** (#47). `npm test` runs two vitest projects: unit
  (Node, ~150ms) and worker (real workerd + real D1 + the real migrations).
  Conventions are in CLAUDE.md. **`npm run build` runs check + test**, and since
  push-to-main deploys, that build is the only gate this workflow has — a red
  test stops a deploy rather than annotating one.
- **`target_kcal` is derived, not writable.** It comes from the profile plus the
  weight trend via `refreshTarget`, which runs after any profile PATCH and any
  weight write. It was removed from `me.ts`'s EDITABLE allowlist deliberately: a
  hand-set value would give one number two writers, and the derived one wins
  silently on the next weigh-in. A real override needs its own column.
- **The activity multiplier excludes exercise, and the onboarding copy says so.**
  Runs arrive as the earned bonus (#21). If that copy ever goes, #21 starts
  double-counting every mile and the budget is a few hundred kcal too generous
  every day with nothing looking wrong. `ACTIVITY_FACTORS` carries the note.
- **`dayInTimezone` is how the server resolves "today"** with no client present.
  #19 needs it: `ran_on`/`measured_on` written by a script have exactly the
  problem it solves.
- **The maths is in `src/shared/`** so onboarding previews the same function the
  Worker runs on save. Keep it that way — two implementations drift invisibly.

### The bug worth not re-introducing

A weigh-in dated *ahead* of the server's idea of today was filtered out as
future, so the engine declined for want of a weight it already had and the
target silently stayed on the M2 default — while `/api/day` reported
`onboarded: true`. Found by driving the real API, not by a test; the test came
after. `refreshTarget` now anchors at the later of the server's day and the
newest weigh-in. **Any new code that compares a client-supplied day against a
server-derived one is the same trap.**

Second one, cheaper: both new screens sat on `.shell` when the gutters and the
430px max-width live on `.frame`, so they ran edge-to-edge at 375.
`verify:viewport` passed throughout and was right to — nothing overflowed, the
content just had no margins. Only the PNG showed it. Look at the PNGs.

## Session G — finish M4 — ⚠️ all but Garmin, 2026-08-08

**Closed:** #19 (sync endpoint, per-user hashed tokens, debrief push script)
and #21 (eat-back). With #47, #17 and most of #18 from Session F, M4 is done
except **#20**, which is blocked on a Garmin login, and **#18's trend chart**,
which belongs to #22.

Verified against production, not just locally: 68 real runs pushed to
`fuel.debrief.run`, pushed again, still 68 rows. Token revoke confirmed (a
revoked token 401s). Migration 0003 applied remotely.

### #20 — what remains

The script is written and its every API call checked against the installed
`garminconnect`. Two steps, both Dave's:

1. `uv run tools/sync-garmin.py login` — interactive, once. **Garmin
   rate-limits login by IP (429) and repeated attempts extend the block**; the
   first attempt hit it. Wait 15–30 minutes between tries, never loop.
2. `MYMACROS_SYNC_TOKEN=… ./tools/install-sync-agent.sh` — installs the
   launchd agent that runs both syncs every 30 minutes.

Then confirm a weigh-in lands and check the grams→kg conversion on real data.
`tail ~/Library/Logs/mymacros/sync.log`.

### Handling the sync token

It is a live credential that can write to the account. **Neither `!` echoing
nor `export` keeps one out of the transcript** — the command line itself is
recorded, and each agent Bash call gets a fresh shell so the export isn't
even visible to it. The working pattern is to never let the agent hold it:

```bash
bash -c 'read -rsp "token: " T; echo; MYMACROS_SYNC_TOKEN="$T" ./tools/install-sync-agent.sh'
```

Verification afterwards reads the launchd log, which never contains the token.

### What M4 left for M5

- **#18's trend line is a list of numbers.** `GET /api/weights` already returns
  the smoothed `series` ready to plot; drawing it is #22.
- **The weigh-in link lives in Settings**, which is the wrong home for a daily
  action — noted on #22.
- **`.warn` on the macro-split total is accent-coloured**, a placeholder. There
  is still no destructive/alert colour in the pack; #52 wants `--danger` for the
  same reason.
- **Theme QA for M4's four new screens** (build rule 4): /onboarding, /weight,
  and Settings' two new sections are Night Athletic only. Light packs are #30.
- **`/api/day` now issues four queries** (logs, profile, weigh-ins, runs). Fine
  at this size; if the Today screen ever feels slow, that is where to look
  before anything else.

### One device check owed from M3 (5 minutes, any time)

On the phone, at `https://fuel.debrief.run`: photograph a real meal and check the numbers
and confidence are sane; scan a real package's barcode; confirm the camera permission
prompt and the standalone viewfinder behave. None of it blocks M4 — but it's the half of
M3 that headless Chrome structurally cannot reach, and the sooner it's known the cheaper
any fix is.

## Session H — the site onto its own domain — ✅ done 2026-08-10

**Shipped:** **https://mymacros.debrief.run**, built from `samsun076/mymacros-site`
(**private** — this repo is public, so never hyperlink it; the link 404s for
every reader. Link the site, name the repo).

Ported out of the Session F Claude artifact rather than rebuilt. That was one
1.29MB HTML file with fonts, video and stills inlined as base64, because the
artifact CSP forbids external requests. Off-platform: 16KB of markup, 18KB of
CSS, 944KB of separately cacheable assets. The throwaway Python script did not
survive — `build.mjs` walks `src/pages/`, so an article is a new file.

**Closed:** #73 (the README claimed the budget engine's routes didn't exist,
which M4 falsified — and the profile README already described it as working,
so the one public repo was contradicting the profile pointing at it).

**Deploys are manual on purpose.** A `wrangler login` OAuth session already
carries `workers_scripts`, `workers_routes`, `zone read` and `ssl_certs` write
— enough to create the Worker *and* the custom domain with no dashboard visit
and no API token at all. Push-to-deploy is the only thing a token would buy,
and at this cadence it's a credential that expires silently on a repo touched
twice a year. `program-cf/prd`'s existing `CLOUDFLARE_API_TOKEN` is
**Pages-scoped** — measured: it 403s on Workers scripts and can't see the zone.

**The site is Night Athletic only.** It shipped a light pack because artifacts
*must* honour the viewer's colour scheme, plus `:root[data-theme]` overrides for
the host's toggle. Off-platform nothing sets `data-theme` (dead CSS), and the
light values were the unported "Instrument" pack — a bone-white page wrapped
around eight dark screenshots, advertising a theme the app can't render. It
comes back with #30, alongside artwork that matches.

## Session I — #22, the Trends screen — ✅ done 2026-08-10

**Closed:** #22, #18 (its trend line, the last thing M4 left undrawn), #46.
**Filed:** #74. `GET /api/trends/:date?weeks=4|12|24`, a hand-rolled SVG weight
chart, weekly intake bars, and the first `--danger` in the pack.

### What Session I settled or discovered

- **Two rates, ranked.** Observed (least-squares slope of the smoothed trend)
  is the big number; the energy model (`deficit × 7 / 7700`) is a mono line
  under it. They disagree — on the demo fixture, 0.5 vs 1.6 lb/week — and the
  screen doesn't pretend to reconcile them. That gap is #28's job.
- **A sign bug the tests couldn't see.** The modelled rate came out `+0.72`
  while the observed was `−0.23`: a positive deficit predicts weight going
  *down*, so it has to arrive negative. Both render as bare magnitudes, so on
  screen it read as agreement. **Found by reading the live payload, not by a
  test** — the arithmetic was right and the convention was not. The fix is one
  negation; the guard is two tests plus a direction glyph on the model line so
  a disagreement is visible rather than implied.
- **The deficit uses FULL run calories, never the eaten-back share.**
  `eat_back_pct` is a budgeting hedge, not a claim about physiology; applying
  it here would apply it twice. So the weekly bar (budget view) and the weekly
  deficit (physiology view) use different run figures **on purpose**. There is
  a test that fails if anyone "corrects" it.
- **Historical targets are reconstructed, not recalled.** `target_kcal` is one
  stored current value, so each past day's target is recomputed from that day's
  trend weight and the *current* profile. Changing your activity level rewrites
  every week on this screen retroactively. Named in the route's doc comment.
- **One rule for everything absent: withhold, don't caveat.** Charts draw
  whatever exists; the rate figures are null until ≥14 logged days and a ≥14-day
  weigh-in span. Same posture as `computeBudget` returning null. In production
  today (7 logged days) that means most of the screen is withheld — which is
  the design working, not a bug.
- **No fifth motif slot, and that was the deliberate call.** A chart is data
  marks, and data marks already re-skin through `--mark-neutral` / `--track` /
  `--accent-soft` with no per-theme code. A fifth slot is permanent work for
  every future pack. If the earned hatch ever needs to vary, widen slot 2's
  contract instead.
- **`--danger` #f36884, and the thing it can't do.** A hue sweep of the whole
  red-through-rose range at every lightness clearing 5.2:1 tops out at ΔE ≈ 10.9
  worst-case under deuteranopia — reds converge with coral, roses converge with
  mint, and the failures cross before either clears. That is the colour space,
  not a search failure; `design/TOKENS.md` records it as a measured deviation.
  Every use is sign-carrying and direct-labelled, which is why it's acceptable.
- **#46 was misdiagnosed until it was measured.** The obvious fix
  (`space-evenly` → `space-around`) moved the label gap 4.9px → 7.3px, which is
  arithmetically +50% and visually nothing. The real shortage: both zones get
  `1fr`, the solo zone sat on **90px of unused slack** while the right zone had
  14.6px, and the centre column was 88px around a 58px button. Narrowing the
  column to the button's own width keeps the grid symmetric (so the button
  doesn't move) and takes the gap to 14.8px. **Measure before changing frozen
  ground truth.**
- **`seed-demo.mjs --weeks N`** seeds a deterministic window — weigh-ins with a
  nine-day gap, unlogged days, a sparse week, runs. Without it every screenshot
  of this screen is the empty state.
- **`shot-matrix` names by hash now**, so `/trends#empty` writes
  `app-trends-empty@*.png`. The Session D note above saying hash stages
  overwrite each other is **stale** — copying files aside afterwards clobbers
  the correctly-named output, which cost a confused round here.
- **A chart's y axis must have a floor.** Auto-fitting the domain magnified a
  first week's 0.8 kg of water into a cliff. `MIN_DOMAIN_KG = 2`. A small range
  is exactly the case that must not look big.
- **A media query ate an em-dash.** `.wk-row .val span { display: none }` at
  ≤389px was meant for the "/day" suffix and also hid the dash marking an
  unlogged week, so those rows went silent instead of explicitly empty. Scope
  display rules to a class, not to an element.

### What Session I did NOT do

- **#74** — a day logged with one coffee counts as a fully logged day, so the
  weekly deficit can read ~2× the truth next to a reassuring "6/7 DAYS".
  Deliberately not patched: the obvious floor is a guess about whether someone
  fasted. Full write-up on the issue and in RECONCILIATIONS.md.
- **#67** stays in M8. The measured exposure is on the issue now.
- **The M3 device check, done on the phone against production** (2026-08-09/10).
  Corrected once already — the first version of this note said the Starbucks
  photo was the model recognising a drink. It wasn't: Dave scanned the
  nutrition sticker on the cup, which is the label path M3 already verified.
  Ask what was photographed before crediting a read.
  - **Real barcodes: verified.** Four resolved on real packaging (Barebells,
    Bubba burger, Dave's Killer Bread, Clif Bar). That is precisely the gap
    Session E named — curvature, gloss and focus are what a generated flat
    EAN-13 never tested.
  - **A real plate: one mixed result, and the interesting one.** The 08-09
    dinner photo returned buffalo cauliflower / "fish sticks" / baby carrots.
    Numbers judged plausible; the fish sticks were **tofu**, corrected on the
    sheet. So the macros survived a misidentification — breaded protein in
    buffalo sauce lands near enough either way — which is the failure mode to
    expect here: confidently wrong about *what*, roughly right about *how
    much*.
  - **`confidence` may not be decoration.** That tofu row was 0.45, the lowest
    of the day; every other item sat at 0.55–0.7 and needed no correction. n=1,
    proves nothing, but it is the shape #75 asks about.
  - **Still owed: anything weighed.** "Seemed accurate" is the only measure so
    far, so the *magnitude* of error is unknown. That is what the site's
    "Unverified" card describes and what #75 exists to make measurable.
- **The site's "Trends is a placeholder" claim is now false.** Sweep it in the
  site repo under the `stale-claim` label; the budget-meter diagram and the
  "day route returns no run" claim are already there.

<details>
<summary>The pre-session brief for #22, kept for reference</summary>

### Next up: #22, the Trends screen

Four things point at it:

- **It's the last of M4.** Session G left #18's trend line as a list of numbers
  and said drawing it belongs to #22. `GET /api/weights` already returns the
  smoothed `series` ready to plot.
- **It unblocks #67**, which is explicitly deferred "until trends sum runs".
- **Both public surfaces name it as the gap** — the README, and the site's
  "Trends is a placeholder", which is the last *true* not-built claim on it.
- `src/client/routes/Trends.tsx` is four lines importing `Placeholder`.

**Pairs with it:** #46 (the tab label stops being decorative once the screen is
real), #18's leftovers (the weigh-in link lives in Settings, wrong home for a
daily action), and `--danger` — still no destructive/alert colour in the pack,
which #52 wants and the macro-split `.warn` is currently faking with `--accent`.

**Two debts to clear in the same pass:** theme QA for M4's four screens
(/onboarding, /weight, Settings' two new sections are Night Athletic only —
build rule 4), and the M3 device check headless Chrome structurally cannot do
— photograph a real meal on the phone, scan a real package.

**Close the loop after:** shipping #22 falsifies the site's "Trends is a
placeholder" claim. Site sweep follows the milestone — the `stale-claim` label
in the site repo is where those live.

</details>

## Session J — the board, and one number three screens disagreed about — ✅ 2026-08-10

Started as issue triage off two phone screenshots and turned into three defects,
all shipped. **Closed: #78, #84, #85** (one commit, `a2b4896`, deployed and
verified). Build rules consolidated into CLAUDE.md (`d7f6bbe`).

### What was filed, and what each one is

Titles, not bare numbers — this section should be readable without GitHub open.

| | Issue | Why it exists | Where |
|---|---|---|---|
| **#76** | Store the AI's original numbers beside the saved ones | `food_logs.edited` is a boolean; the row never keeps *by how much* or *which way* the estimate was wrong. Cannot be backfilled. | M9 |
| **#77** | Protein is a percent of energy, so a run inflates it | A 5 mi run added 22 g to the protein target. Anchor it to body weight instead. | M9 |
| **#79** | Ask for an athlete profile instead of three macro percentages | Onboarding asks a novice to make three sliders sum to 100. Replaces that question rather than adding one. | M9 |
| **#83** | Dump the reconciliation inputs, and never the answer | Rule 4b's mechanical half is the same five-table production pull every time. Must print **no** derived figure, or the check is dead. | M9 |
| **#86** | Sweep for duplicated sources of truth | The fault type behind #78/#84/#85. Run at the milestone close. | M9 |
| **#80** | Today timeline: newest first, drop the node dots, centre the time | The just-saved entry appends below the fold; the node dot and the fresh accent bar collide at 0.5px. | M11 |
| **#81** | Build one meal from several captures | Scan the patty, scan the bun, type the mustard — one meal. Mostly built already; only the navigation replaces instead of appends. | M7 |
| **#82** | Favorites are built and invisible | Fully working since #12, and rendered only inside the text branch — unreachable from PHOTO, the default mode. | M7 |

Closed the same day: **#78** (Settings and Today disagreed on the base target),
**#84** (editing a deficit wrote a weeks-old weight as today's weigh-in),
**#85** (the stored target goes stale as the trend window slides).

### The board was restructured — read this before looking for M5

**M5 had 17 open issues and a name that stopped being true** when #22 shipped.
It is split three ways, and **M5, M4, M3, M2, M1 and M0 are now closed**
milestones — six completed milestones had been sitting open, which made the
list lie about what was in flight.

| Milestone | What it is |
|---|---|
| **M9 Budget truth** | The app showing wrong numbers. #78/#84/#85 done; #76, #77, #79, #83, #86 open |
| **M10 Launch & offline** | #53 cold-launch white screen, #35 self-host fonts, #54 service worker |
| **M11 Look & feel** | #23 editable Settings, #24 polish pass, #29 theme/accent picker, #30 light packs, #38 standalone tab bar, #39 theme-color question, #52 swipe-to-delete, #80 timeline |
| **M7** renamed | "Log flow: multi-item meals and corrections" — a basket is a capability, not a correction |

**#32 has no milestone on purpose** (its own body says it is an epic awaiting
concrete issues) and **#36 moved to M6** — what an unauthenticated visitor sees
is positioning, not polish.

### Next up, in this order

**#76, #77 and #79 are done — see Session K below.** What remains of M9:

1. **#83 — the reconciliation input dumper.** Wanted before the milestone's
   rule 4b entry, not after.
2. **#86 — the duplication sweep, plus the rule 4b reconciliation**, both at
   the close.

**#86 belongs at the close, not before** — it sweeps for duplicated sources of
truth, and #77/#79 rewrote the code it would sweep. Its figure for 4b is
already chosen by the work: the protein and base targets.

### What Session J settled, worth not re-deriving

- **One quantity, one source — and it hid behind itself.** #78, #84 and #85 are
  one defect at three depths, not three discoveries. #85 was *invisible* until
  #78's fix made one of the two answers right. That is why this fault type feels
  like whack-a-mole, and why #86 hunts it deliberately.
- **`currentTrendWeightKg` is now the only way to ask "what does this person
  weigh now".** `refreshTarget`, `/api/me` and `/api/day` all call it. The
  anchoring rule (accept a weigh-in dated ahead of the server's day) was inline
  in `refreshTarget`; a second copy is what #78 was.
- **Nothing user-facing reads `profiles.target_kcal` any more.** `/api/day`
  computes it. The column stays as a write-only cache — dropping it is a
  migration for no gain — but it is stale by however long since the last write.
- **`manual` on a weights row is load-bearing.** #20 protects manual rows from
  sync overwrite and #71 lets them clear tombstones. Both assume the word means
  *a human typed this today*. #84 broke that premise silently, and both
  protections then worked correctly against the user.
- **Two fault classes, two checks, neither substitutes.** #86 finds what reading
  can find; rule 4b finds what only production data can. Four of six findings
  this session were plain code reads nobody had run; #74 and the `energy_kj`
  unit were not findable that way at all.
- **Rule 4b is amended** — it fires when a milestone *changes how a number is
  computed*, not on every close; it budgets 45–90 minutes, not ten (measured
  against the two entries that exist); and a milestone with nothing to reconcile
  **records that it had nothing**, the way #69's syncs check in on empty days.
  So M10 and M11 owe a one-line "not applicable", not an entry.
- **Build rules live in CLAUDE.md now.** PLAN.md had a stale copy where rule 7
  was a *different rule*, and issue bodies cite these by number. Append, never
  reorder.
- **Favourites and the multi-item basket are both mostly built already.** The
  confirm sheet is already an N-item editor and the save already folds one
  `logged_at` into one meal; only the navigation replaces instead of appends
  (#81). Favourites work fully and render only inside the text branch (#82).
- **Protein is the wrong shape, and the goal presets are a U.** Cut 2.0,
  maintain 1.6, gain 2.0 g/kg — both ends elevated for *different* reasons.
  An earlier draft put gain in the middle and was wrong; #77 records that so
  nobody re-derives the bad version.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros). Read CLAUDE.md and the Session J
section of NEXT-STEPS.md first — the milestones were restructured on
2026-08-10 and M5 no longer exists as an open milestone.

Do #76 first: store the AI's original numbers beside the saved ones. It is
the only issue whose cost grows daily and cannot be backfilled. One
migration, four nullable columns on food_logs, the confirm sheet sending what
it already holds, the save route validating them beside confidence and
edited. No UI.

Then #77 (protein anchored to g/kg, not a percent of energy) and #79 (the
athlete profile) in that order — read the comment on #77 about not leaving
protein_pct as a stored-but-derived column before you plan the migration.

Verify at 375 with tools/shot-matrix.mjs and look at the PNGs, not just the
green check. Commit per issue with "closes #N" only where it is genuinely
finished. Push deploys, so confirm the build off GitHub check-runs and fetch
the shell WITH its asset to check the content-type — the hash alone marks the
start of a rollout, not the end.
```

## Session K — #76, #77, #79 — ✅ done 2026-08-10

**Closed:** #76, #77, #79, all three deployed and verified against production.
Three migrations (0006, 0007, 0008). M9 has #83 and #86 left, both of which
belong at the milestone close.

### What each one actually changed

- **#76** — `food_logs` grew `ai_kcal`/`ai_protein_g`/`ai_carbs_g`/`ai_fat_g`.
  The confirm sheet already held them: `orig` is what `isEdited` has always
  compared against, and the save simply stops discarding it. No UI.
- **#77** — protein is `g/kg × trend weight`; carbs and fat divide the
  remainder including the earned bonus. On production this moved the protein
  target from 191 g (213 g on a run day) to 153 g at 2.0 g/kg.
- **#79** — onboarding asks Runner / A bit of everything instead of three
  percentages, and the three percentage sliders are gone.

### What Session K settled, worth not re-deriving

- **An unedited save writes the AI's numbers EQUAL to the saved ones, never
  null.** "The reader agreed" and "we never recorded it" must not look the
  same. Null is reserved for *no read happened*: a favourite re-log, #16's
  blank recovery row, and every row older than migration 0006.
- **#76 records all three reads, not just the AI ones.** A barcode's figures
  are an exact database match rather than an estimate, but they are still what
  the reader proposed before the user touched it. `source` is on the row, so
  #75's estimate-quality question filters to `('photo','text')` while "how
  often is an exact match corrected" stays answerable.
- **The route takes all four `ai_*` or none.** A row holding three of four
  answers the by-how-much question for none of them, and the rejection happens
  while rows are being built, so a bad item can't half-land a meal. `kcal` and
  gram bounds are now one pair of validators used by both the saved and the
  recorded values — a stored pair must not have been quantised differently on
  the two sides.
- **The old three-leg macro split is dropped, not left derived-but-stored.**
  Per the constraint on #77, and it removed an invariant rather than moving it:
  fat is the remainder of the remainder, so `routes/me.ts` no longer needs the
  cross-field "must total 100" check and onboarding no longer gates its save
  button on it. Two columns replaced three.
- **Today had its own copy of the macro arithmetic** (a private `gramsFor`),
  which is exactly the shape #86 hunts — and here the two copies would have
  differed by a *model*, not by a rounding rule. It calls the shared
  `macroTargets` now, the same function onboarding previews with.
- **`ATHLETE_PROFILES` is tested by its exact key set**, not by asserting
  `activity_level` is absent. The next wrong field to appear there won't be the
  one already named, and onboarding spreads those objects wholesale, so the key
  list *is* the set of things a profile can move.
- **A default in two places is still a defect at 4 percentage points.** 0007
  left `carb_ratio_pct` defaulting to 62 while #79's General preset said 58;
  both answer "what does someone who has chosen nothing get". SQLite cannot
  alter a default in place, so 0008 rebuilds the column around its own values
  (add temp → copy → drop → re-add with the new default → copy back → drop
  temp). Existing rows keep the preference 0007 preserved. A route test asks
  the real schema rather than restating the number.
- **Adding an athlete profile later is a table rebuild**, because the CHECK
  lists only `runner` and `general`. Deliberate: admitting `lifter` before the
  app can serve one is the same promise-it-can't-keep the picker refuses to
  make, one layer down. #27 or #70 is where that gets paid.
- **A range input silently snapped its own thumb.** Runner's 65 is not on an
  even step, so `step={2}` left the DOM input at 66 while every number on the
  screen said 65 — and the next drag would have started from the wrong place.
  **Found by reading the input's `value` while driving the picker**, which no
  screenshot can show. Same lesson as the shutter bug in Session E: clicking
  the real control finds what reading the code does not.
- **A "wrong" number that was the fat floor working.** Picking Runner appeared
  not to move carbs or fat at all — because at a desk-bound target the 0.6 g/kg
  floor was binding at 48 g in both positions. The reading was right and the
  test setup was wrong. Check `fat_floored` before believing the ratio is
  broken.
- **Deploy ordering when a migration drops a column the live code reads.**
  Both orders break something for the length of a build, so: push, poll the
  check-run, and apply the migration the second it goes green — the old code
  and old schema stay consistent for the whole build, and the gap after it is
  seconds. Verified the rollout with the shell **and** its asset, and saw the
  documented mixed-version window both times (2 of 6 requests answering
  `text/html` for a `.js` URL, clean inside ~45s).
- **Production backfilled exactly as #77 predicted:** cut → 2.0 g/kg, and the
  35:25 carb:fat preference carried across as 58, untouched by 0008.

### Owed, and deliberately not done here

- **Theme QA (build rule 4)** for the two new onboarding sections and the four
  new Settings rows — Night Athletic only, like everything else. Light packs
  are #30 in M11.
- **Rule 4b's reconciliation for M9.** M9 changes how protein and the macro
  targets are computed, so it owes a real entry — the trigger is met. #83 is
  meant to land first so the mechanical half is a script.
- **The site's claims about macros** (`stale-claim` in the site repo). #77
  changed what the app shows a user; anything asserting a percentage split is
  now false.

## Session L — #83's tool and #86's sweep — ✅ done 2026-08-11

Same day as Session K, after a break. **Closed: #86.** #83's tool is built and
deployed; the issue stays open on its own third criterion (see below).

- **#83 — `npm run reconcile -- --date <YYYY-MM-DD> --weeks 1`.** Five tables
  out of production D1 as a paste-ready markdown block. **It prints no derived
  figure**, and that is the whole design: print the answer beside the inputs and
  the reconciler reads it first and confirms it, which turns RECONCILIATIONS.md
  into a log of the app agreeing with itself while every entry still says
  "✓ matches". `profiles.target_kcal` is never SELECTed rather than merely
  unprinted, and a test fails on any of five forbidden words reaching the
  output. Proven by adding the exact line the issue predicts — *"for reference,
  the app computes a base target of 2246"* — and watching four tests go red.
- **#86 found four real divergences**, all fixed: the meal fold written twice
  (Today's timeline and `/api/food-logs/recent`), `7700` kcal/kg stated twice,
  onboarding's `carb_ratio_pct ?? 62` still carrying the pre-0008 default a day
  after it was rebuilt to 58, and `protein_g_per_kg`'s column default agreeing
  with `PROTEIN_G_PER_KG[goal]` by hand with nothing pinning it. The full
  three-search result is the comment on #86; the durable half is the **"One
  quantity, one source" register in CLAUDE.md**, which lists what is
  deliberately duplicated so it isn't re-litigated.
- **`vitest`'s unit project now includes `tools/`**, which had no tests at all.

### Next up: #83's other half — the M9 reconciliation

This is the last thing in M9, and it wants a **fresh session**: the figure to
reconcile is the protein target, which Session K wrote, and rule 4b's whole
value is that the recomputation is independent.

**Where to look hardest.** #77 made protein `g/kg × trend weight`, so **body
weight now enters the protein target directly** — anything wrong in the weigh-in
feed moves a number it never used to move. Check the `source` column on every
row in the window; that is exactly what caught M8's finding.

**Budget 25–45 minutes**, not the rule's usual 45–90 — the tool removed the SQL
half. Nearly all of what remains is step 4, reading the inputs. **If it comes
out much faster than that, suspect step 4 was skipped**; it is the part with no
output until it finds something.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros). Read CLAUDE.md, then issue #83
and its two comments — the second one is the handoff and says exactly
what's left.

The tool is already built. Your job is the thing it exists for: M9's
build-rule-4b reconciliation. Run `npm run reconcile`, take the protein
target and the base target the app is actually showing, recompute both
BY HAND from the block, and then spend most of the time on the part that
matters — reading the inputs and asking which one is wrong.

Do not import computeBudget or macroTargets to check computeBudget or
macroTargets. Write the entry in RECONCILIATIONS.md, add one line on
whether the tool saved time, then close #83.

Model: Opus 5 @ xhigh.
```

### Still owed after that, before M9 closes

- ~~**Theme QA (build rule 4)** for Session K's two onboarding sections and
  four Settings rows~~ — **done 2026-08-14, passes.** See below.
- **The site's stale macro claims** — see below; the debt is real but it is
  *not* the prose claim it was written down as.

### Theme QA — Session K's surfaces — ✅ 2026-08-14

Night Athletic at 375/390/428, `/onboarding` and `/settings`, plus
`verify-viewport` across all 12 routes × 3 widths: **no overflow anywhere, no
reflow breakage.** `/settings` is 1304px tall at all three widths (no reflow at
all); `/onboarding` differs by 24px at 428 only, which is one helper line
unwrapping. #79's training picker and #77's protein slider both render in the
pack with no untokenised values.

Two things worth keeping:

- **Eat-back prints its own value twice.** The other sliders put the *setting*
  in the section head and the *consequence* on the track — protein reads
  `2.0 G/KG` / `160g`, carbs & fat reads `62 : 38` / `239C · 65F`. Eat-back
  reads `50%` in both places, so the track earns nothing; the consequence is
  already in the prose under it ("a 500 kcal run would add 250 kcal"). Cosmetic,
  and a design call rather than a defect — but it is the same one-quantity-two-
  places shape #86 swept for, one layer down. Not filed; decide first.
- **The dev user still carries `carb_ratio_pct = 62`**, which is 0007's default,
  not 0008's 58. That is 0008 working as designed — it rebuilt the column around
  its own default and *preserved existing rows* — so every local database seeded
  before Session K reads 62 while a fresh account reads 58. Worth knowing before
  reading 62 off a screenshot as a bug.

**How to redo this.** A dev server is often already up on **5173**; a second
`npm run dev` silently takes **5174** and then every auth call 403s with
`INVALID_ORIGIN`, because `APP_URL` in `.dev.vars` pins better-auth's trusted
origin to 5173. Check `curl -s localhost:5173/api/health` before starting one.
A cookie without a browser:

```bash
curl -si -X POST localhost:5173/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
  -d '{"email":"dev@mymacros.local","password":"dev-password-not-for-production"}' \
  | grep -i '^set-cookie: better-auth.session_token'
```

Then `node tools/shot-matrix.mjs --settle 900 --cookie better-auth.session_token=… <urls>`
and `node tools/verify-viewport.mjs --cookie …`. Run both: shot-matrix renders
at a *fixed* width, so horizontal overflow is cropped into looking like a
screenshot rather than a defect — only verify-viewport sees that class.

### The site's macro claims — swept 2026-08-14, and the premise was wrong

The debt was written as "anything asserting a percentage split is now false."
**No such claim exists, and none ever did** — `git grep` for `percent` across
every revision of `mymacros-site/src` returns nothing but the 60%-of-target rule
from #74, which is still true. Nothing on the page describes how macros are
computed, so #77 falsified no prose.

What *is* stale is arithmetic baked into the media, which no text edit reaches:

- `index.html:114` — "133 g of a 158 g protein target"
- `index.html:150` — the `today-scroll.mp4` `aria-label`: "protein at 133 of 158
  grams … carbs 159 of 181 and fat 61 of 50"

Those figures encode the pre-#77 model: 158 g protein against an 1,810 kcal
target is 35% of calories, and the implied carb:fat on the remainder is 62:38.
Protein is `g/kg × trend weight` now and independent of the target, and the
remainder splits at the 58:42 default. The numbers are a real screenshot of a
day the current app would not produce.

**This is issue #2's re-record, not a separate job.** #2 already needs
`today-scroll.mp4` reshot with a run in the day, already says to regenerate the
clips as a set because they cross-reference one date, and already needs a dev
server, a seeded DB and a real `ANTHROPIC_API_KEY`. Fold the macro figures into
it rather than filing a second issue that blocks on the same recording.

## Session M — M9's reconciliation, and M9 closed — ✅ done 2026-08-14

**Closed: #83, and with it milestone M9.** The rule 4b entry is in
[RECONCILIATIONS.md](RECONCILIATIONS.md); this is the pointer, not the record.

**Figure reconciled:** Today on 2026-08-14 — `BASE 1,909` and
`153 g protein · 188 g carbs · 61 g fat`. All four match by hand.
**No input defect found**, which is a first for this exercise and is the
result #77 most needed: protein now depends on body weight, and every weigh-in
in the window is a real `garmin` scale reading.

### Worth not re-deriving

- **`trendWeightKg` rounds the window mean to 1 dp before anything consumes
  it.** A hand pass from the printed weigh-ins gives 76.25 kg and a base target
  of 1,908; the app builds from 76.3 and gets 1,909. Correct and deliberate —
  one quantity rounded once at its source — but it is a 1 kcal gap, which is
  precisely the size that gets waved through as "rounding" instead of chased.
  Only the base target shows it; the three macro targets match under either
  weight.
- **`manual` on a weigh-in is unconditional protection, and provenance decays.**
  2026-08-05's 76.0 is `manual`; asked directly, Dave does not remember whether
  he stood on the scale. #20 will never let sync correct it and #71 lets it
  clear tombstones — both on the premise that the word means a human typed it
  deliberately. Four days of the Trends chart rest on it. Not filed; it is a
  question to answer, and M8 already established that the honest move for a
  soft weigh-in is deletion once identified.
- **`athlete_profile` was `general` on someone who ran 6× in 14 days** —
  **switched to `runner` the same day**, verified in production (`carb_ratio_pct`
  65, written 18:04:35Z). Carb and fat targets moved 188/61 → 211/51; base target
  and protein unaffected. Not a defect and no test could reach it: the app was
  computing the right answer to a question the user had answered wrong. That is
  the entry's one finding, and it is the failure class rule 4b exists for in its
  mildest form.
- **The 08-05 `manual` weigh-in stays** — Dave's call, made after seeing the
  exposure. Unlike M8's 74.8 there is no evidence it is wrong, only no evidence
  it is right. Recorded in RECONCILIATIONS.md so it isn't re-raised as open.
- **`start_weight_kg` is 74.84 kg = exactly 165.0 lb, typed at onboarding, and
  now below the current trend.** Enumerated its readers: nothing user-facing
  consumes it (Onboarding's form seeding only, as the last fallback behind
  `trend_weight_kg`). Costs nothing today — re-check before any future screen
  draws a "since you started" figure.
- **The tool saved roughly half the exercise, and `rows_n` earned its place.**
  Recorded on the entry per #83's third done-when.
- **RECONCILIATIONS.md's header said "ten minutes"** while CLAUDE.md's amended
  rule says 45–90. Two sources for one number, #86's exact shape. The header
  now defers to CLAUDE.md.

### Next up: pick a milestone

M9 is closed. Nothing is blocked and nothing is half-finished, so the next
session starts clean on whichever of these you want:

| Milestone | Open | What it buys |
|---|---|---|
| **M10 Launch & offline** | #53, #35, #54 | The cold-launch white screen, fonts off the critical path, a service worker. Most user-visible, and #54 is the real mitigation for the mixed-version window this project keeps documenting |
| **M11 Look & feel** | 8 issues | Editable Settings (#23), theme/accent picker (#29), light packs (#30), timeline order (#80), swipe-to-delete (#52), plus the two device-only questions (#38, #39) |
| **M7 Log flow** | 5 issues | Multi-capture meals (#81), favourites made reachable (#82), edit a saved meal (#60), portion scaling (#58), tell-the-reader-it-was-wrong (#59). #81 and #82 are both mostly built already |
| **M6 OSS-ready** | 11 issues | The self-hoster story — BYOK, claim flow, landing page, Garmin sync into the Worker |

**Rule 4b for whichever lands next:** M10 and M11 change how the app looks,
loads and navigates, so they owe a one-line "no computed figure — not
applicable", not an entry. M7 changes how a meal is assembled, which touches
`foldMeals` — if it changes what counts as one meal, it owes a real entry.

## Session N — M10's first half: #35 and #53 — ✅ done 2026-08-14

**Closed: #35, #53.** M10 has **#54 (the service worker) left**, and its four
decisions were settled with Dave before any code — see below.

### What landed

- **#35** — seven woff2 files, 165 KB, latin subset, committed and
  fingerprinted. No third-party host anywhere in `dist/client`.
  `tools/fetch-fonts.mjs` owns them; `npm run fonts -- --check` fails on drift.
- **#53** — stylesheet inlined into `index.html` by a build-only Vite plugin,
  a boot skeleton inside `#root`, and 12 `apple-touch-startup-image` links
  generated by `npm run icons` between markers.
- **`npm run verify:firstpaint`** — the guard, and the reason this didn't ship
  as a hope. It blocks the app bundle at the network layer and asserts what is
  left.

### Worth not re-deriving

- **The boot skeleton is `<main class="splash">` on purpose** — byte-for-byte
  what `App.tsx` renders while the session is pending. Same element, same
  class. No second source, no handoff flash, no layout shift.
- **The tab bar is deliberately not in the skeleton**, a partial decline of
  #53's own third bullet. Copying it restates `TabBar.tsx` in a file no test
  renders. And an empty `.tabbar` is *worse* than none: measured at 21px
  against the real bar's 61px, because the height comes from `.tab`'s content —
  so it would paint a strip and then jump.
- **`--page-surface` is a gradient, so `.splash` has no background-*color*.**
  A structural "is it dark" check reads `rgba(0,0,0,0)` and means nothing. The
  verifier samples real pixels — screenshot, handed back to Chrome to decode.
  Any future darkness assertion must do the same.
- **There is no first-contentful-paint, and that is correct.** A contentless
  skeleton is a first *paint*. #53 proposes FCP as the number to move; FCP
  cannot move until React renders. Headless Chrome reports no paint entries
  here at all, which is why the verifier prints them and asserts nothing.
- **The pixel check cannot see a render-blocking regression.** Proven: with the
  stylesheet linked again, the samples still come back dark, because localhost
  has no latency. The two document-level assertions are what catch it. Don't
  delete them as redundant.
- **`verify:firstpaint` is not in `npm run build`** — build runs in Workers
  Builds CI, which has no Chrome. Same reason icons and fonts are committed.
- **1.4 MB of launch images**, ~140 KB each. Only one is ever fetched per
  device and iOS caches it at install, so runtime cost is nil. The bytes are
  the accent glow; a flat vertical gradient would compress to almost nothing,
  at the price of a seam at handoff.

### Two things device testing turned up the same day

- **The white blip, and the frame that belonged to nobody.** `color-scheme:
  dark` lived only in `design/tokens.css` under `:root[data-theme=…]`, so it
  took effect only once the inlined stylesheet parsed — and until then the UA
  canvas is white by spec. The launch image covers up to the moment iOS starts
  painting the web view; the inlined CSS covers from the moment our styles
  apply; between them was a frame nothing owned. `<meta name="color-scheme">`
  applies from HTML parse. **Two rival explanations were measured and killed
  first** — a font swap (fallback vs real differs by 0.01pp of bright pixels)
  and anything in the load at all (12-frame screencast of the real production
  document, peak mean luminance 33/255). Fixed and confirmed on device.
- **#38 is now measured, from a boot-skeleton screenshot.** The page gradient
  runs cleanly to `#11161e` at 92% of the screen and then jumps to `#1b212e`
  for the bottom ~50pt — that is `--bg-top`, i.e. **`<body>` showing through
  because `.frame`/`.splash` at `min-height: 100dvh` stops short of the
  physical bottom in standalone.** The loaded app hides it behind the fixed tab
  bar; during boot nothing does. Numbers on #38. **Don't "fix" it by changing
  body's phone-width background** — that value is field-tested for the Safari
  top-chrome tint.

### The bundle, measured — and #53's guess was wrong

#53 hypothesised that "the better-auth client is likely a big slice that only
the sign-in path needs". Measured by splitting every package into its own
chunk: **better-auth totals 18.6 KB gzip**, about 15%. The weight is
`react-dom` 57.2, `react-router` 29.2, app code 20.0 — no fat chunk to cut.

**Correction, made while building #54:** the first version of this note (and
the first comment on #53) said `@sec-ant/barcode-detector` at 15.3 KB was
"imported eagerly" and worth splitting out. **It was already lazy** —
`src/client/lib/barcode.ts` has always used `import()`, and the default build
emits it as its own `pure-*.js` chunk outside the 122 KB entry. The
`manualChunks` experiment gave it a name and made it *look* like part of the
client bundle; it never was.

So there is **no code-splitting win available at all** — which strengthens the
conclusion rather than weakening it. The ~1.2s first load is distributed across
fetch → download → parse and execute on a phone CPU → two API round trips, and
a shell precache is the only thing that removes most of it.

### Next up: #54, the service worker — decisions already made

Settled with Dave 2026-08-14, before code, because #54's own body says these
need answering first:

| Question | Answer |
|---|---|
| **Scope** | **Shell only** — HTML, CSS, JS, fonts, icons. Not API responses. Caching data would add "which number is real" to a project that just spent M9 removing exactly that |
| **Update flow** | **On next launch.** The new worker installs and waits; it takes over when the app is closed. Never reloads the page mid-log. Worst case one launch behind |
| **Offline writes** | **No.** Say it can't, clearly. Queuing touches `logged_at`/`logged_on` and the R2 upload path, and is its own issue |
| **Build integration** | **Hand-rolled** over the Vite manifest. Workbox is a large dependency and the house rule is no new ones without cause |

**Also owed in #54, and promised to Dave:** a way to force an update on demand,
so "am I on the new version?" is answerable rather than guessed at.

**A bonus worth stating in the issue:** a shell precache also closes the
mixed-version window CLAUDE.md documents. The worker serves one coherent
generation of assets, so it cannot hand out a new `index.html` with an old
asset manifest.

**Don't precache the launch images** — 1.4 MB, only one is ever used, and iOS
fetches them outside the service worker anyway.

## Session O — #54, and M10 closed — ✅ done 2026-08-14

**Closed: #54, and with it milestone M10.** All four decisions were taken
before code (table above) and all four held.

- **`src/client/sw.js`** — plain, unbundled, readable. A plugin in
  `vite.config.ts` emits `/sw.js` with the manifest baked in and a cache name
  hashed from it, so a rebuild that changes no asset re-downloads nothing.
- **`src/client/lib/sw.ts`** — registration (PROD-only), `useUpdate` for
  Settings → App, `useOnline` for the banner.
- **`npm run verify:firstpaint` now drives the real worker**, installs it, and
  **kills the server** before navigating to a deep link.

### Worth not re-deriving

- **CDP's offline emulation does not reach the service worker.**
  `Network.emulateNetworkConditions {offline:true}` applies to the *page*
  session; once a worker controls the page, requests originate from the
  worker's own session. The server kept answering and every offline check
  passed for the wrong reason. **Caught only by a negative control** — an
  un-precached URL that must fail at the same moment the shell succeeds. The
  fix is to stop the HTTP server; a dead socket cannot be argued with. Any
  future offline test needs the same control.
- **`navigator.serviceWorker.ready` resolves a moment before `active.state` is
  `"activated"`** — `clients.claim()` sits inside `waitUntil`. Reading state at
  that instant races and reports `"activating"`. Wait on `statechange`.
- **A test that reads code must strip comments first.** Twice now: the worker
  says "No skipWaiting" in prose right beside the rule, so a substring search
  reports the rule broken while it is being kept. Same shape as #35's
  `unicode-range` test.
- **The `.png` / `launch-` filter in the plugin was dead code.** Nothing under
  `public/` enters the rollup bundle, so icons and launch images are excluded
  by absence, not by rule. The filter looked like it was doing something and
  never matched once.
- **The offline banner is not `--danger`** (rule 9). Losing signal is a fact
  about the room, not a fault in the numbers, and every figure behind the
  banner is still the last true one.

### #87 — #54 bricked the app on iOS, same day

**M10 was closed, reopened for this, and closed again once it was confirmed on
device** — 4 issues, all shipped. A milestone that shipped a bricking bug was
not finished, and reopening it is cheaper than a milestone list that lies.
Fixed in `4bf6084`.

**Recovery worked without clearing website data**: two swipe-closed relaunches.
A worker that breaks the navigation leaves no *controlled client* behind — an
error page is not one — so the browser's soft update of `/sw.js` still runs
after the navigation fetch event, the fixed worker installs, finds nothing to
wait behind, and activates. **That was luck, not design.** A worker that threw
during `install`, or a `/sw.js` that 404'd, gets no fetch event and no update:
the registration sits there and the app's own `register()` can never run
because the page never loads. **The update flow lives inside the thing it may
need to repair** — named on #87, deliberately not closed with it, and owed its
own decision in a later milestone.

Cloudflare's asset router **307s `/index.html` → `/`**, so precaching the shell
at `/index.html` stored a *redirected* response — and a redirected response may
not answer a navigation. Safari refuses the page outright ("Response served by
service worker has redirections"), which is an app that will not open rather
than a slow one.

**The lesson is about the harness, not the worker.** `verify:firstpaint` drove
the real worker, cut the network, and asserted a deep link still loaded — all
green, against a hand-written server that answered `/index.html` with a plain
200. That is the one behaviour production does not have. Same family as design
QA never seeing loading states and curl's `Accept: */*` passing an OAuth
callback a browser failed: **the stand-in was wrong in exactly the way that
mattered.** It now 307s like the real thing.

**And the part that would have defeated any amount of behavioural testing:**
re-running the broken worker against the fixed harness, the deep-link
navigation **still succeeded in headless Chrome**. Chrome does not enforce the
rule Safari does. The check that catches it is *structural* — assert the cached
shell has `redirected === false` — not behavioural. Measured, not assumed.

Two test-design faults found in passing, both now fixed:

- **`service-worker.test.mjs` read `dist/`.** `npm run build` is
  `check && test && vite build`, so it validated the **previous** build every
  time; #87's fix went green against the broken output on its first run. It
  reads `src/client/sw.js` now, and everything about the emitted manifest is
  asserted in `verify:firstpaint` against a browser's live Cache Storage.
- **The offline probe read `navigator.serviceWorker.controller` unguarded**, so
  a failed navigation — the single most important thing the file can report —
  surfaced as a harness crash. #87 first appeared as a stack trace.

*(This section ended with a plan for #38 — a body gradient instead of a flat
`--bg-top`. It was carried out immediately, in Session P below, and the reasoning
that survived contact with a device is recorded there and on #38. The plan is
not repeated here, because a "next up" left behind in a finished session is the
thing this file's header warns about.)*

## Session P — #38 and #39, and two self-inflicted regressions — ✅ done 2026-08-14

**Closed: #56, #88, #38, #39.** Six configurations of the same twenty lines of
CSS, four of them measured on a real phone. The full dataset is the long
comment on #38; this is the pointer, and the Outcome section below is the
final state.

**The rule, sharpened by breaking it twice:** iOS Safari tints its top chrome
from **the canvas**, the canvas comes from `<html>` if html declares a
background and `<body>` otherwise, and **it takes a background-*colour*, not a
background-image.** Three measured configurations:

| config | Safari top |
|---|---|
| `body { background: <colour> }` — original | **#1a2230** ✓ |
| `html { background: var(--canvas) }` (#53) | #0e1118 = `--canvas` |
| html none, body = gradient via `background:` | **#000000** black |

The third is the shorthand resetting `background-color` to transparent. Top
chrome and the standalone bottom gap went black **together**, which is what
proved they are one surface.

**Config 4 is what shipped:** `background-color` and `background-image` as
separate declarations, **never the shorthand**. It restored the top blend to
delta 2 — see the Outcome below. The fallback drawn up at the time, and not
needed, was to revert to config 1 (flat `--bg-top`) and accept the band, on the
grounds that a correct top blend on every Safari session beats a launch-time
strip that disappears by itself. Worth keeping only as the tie-breaker if this
ever regresses again.

**The tooling lesson, which is the durable half.** Both regressions passed every
automated check — `verify:firstpaint`, `verify:viewport`, 323 unit tests, and a
direct read of the computed style that correctly reported `rgb(26,34,48)` for
the gradient's top stop. **The right number on the wrong property.** No check in
this repo can tell those apart, because the claim is about what iOS *does*, not
what the declaration says. Both were caught by a photograph of a phone.

**#88, and a correction worth more than the fix.** Filed claiming CSS-only
changes never reached devices, "measured". The measurement edited a CSS
*comment*, which the minifier strips — so nothing changed and a no-op was
reported as a defect. Re-run properly, CSS-only changes were always caught
(Vite carries the stylesheet in the JS module graph, so the entry chunk's hash
moves). **The real gap was `index.html`-only changes**, which this session
shipped (`<meta name="color-scheme">`) and which reached devices only because
that commit also touched CSS. Fixed by hashing the emitted shell into the cache
name — in `writeBundle`, not `generateBundle`, because the stylesheet is not
inlined yet at the earlier hook.

### Outcome — #38 and #39 both closed

**Closed this session: #56, #87, #88, #38, #39.** M9 and M10 closed as
milestones. M11 has 6 issues left (#23, #24, #29, #30, #52, #80) — all screen
work, none device-gated. **The two oldest device debts in the project are
paid.**

**#38 — accepted with the residual explained, not merely tolerated.**

| | before | now |
|---|---|---|
| Safari top chrome | `#1a2230` → broke twice → | **`#1c222f`**, delta 2 from `--bg-top` ✓ |
| standalone bottom gap, delta from the bar | 16 | **8** |

- **The top will never match the page exactly**, and that is correct: the
  canvas is flat `--bg-top`, the page top is `--bg-top` *plus the accent glow*
  (~6 lighter). Matching it means accent-tinting the canvas, which rule 5 and
  the never-tint-`--chrome` convention both forbid. Don't "fix" it.
- **The bottom's remaining 8 has one known lever**: the gap is landing in the
  gradient's 90px→130px *ramp*, not its solid section. Widen the solid
  `--chrome` band to ~140px. One value. Not attempted — six configurations in
  one session, and the last three moved single digits.

**#39 — answered for free, after three attempts had failed.** `theme-color` is
**inert in standalone**. The `background:`-shorthand regression set the canvas
transparent while `theme-color` and manifest `theme_color` were both
`#1a2230`; the screen rendered **black at both ends**. Neither was consulted.
A question open since Session B2, settled by a bug.

**Why six configurations were needed, and the lesson to carry:** every one of
them passed `verify:firstpaint`, `verify:viewport` and 323 unit tests, and one
passed a direct read of the computed style that correctly reported
`rgb(26,34,48)`. **The right number on the wrong property.** No check here can
distinguish those, because the claim is about what iOS *does*. Every regression
was caught by a photograph of a phone, and the fix rate was roughly one useful
configuration per screenshot.

### Testing on the device — the two things that are easy to get wrong

Both were learned the hard way today and neither is obvious:

- **`apple-touch-startup-image` is read at INSTALL time.** Changing a launch
  image and redeploying does nothing to an existing install — it keeps showing
  the old frame however green the build is. **Delete and re-add the home-screen
  icon.** That is the *only* case where re-adding matters.
- **Everything else needs no reinstall, but does need the service worker to
  update**, which is one launch to download and a second to apply. Two deploys
  in a row therefore look like "nothing happened" after two relaunches. The
  shortcut is **Settings → App → Check for updates → Update and reload now**
  (#54), which skips the wait — inside the app, not iOS Settings.

### Next up — M11, and nothing is blocked

**M11 has 6 issues, all ordinary screen work**: #23 editable Settings, #24
polish pass, #29 theme + accent picker, #30 light packs, #52 swipe-to-delete,
#80 timeline order. **None are device-gated** — #38 and #39 were the last two
and both closed today.

Order, and the dependencies that set it:

1. **#23 → #29 → #30.** #23 makes Settings editable, which is the surface #29's
   pickers live on; #29 is what makes a second theme switchable, and shipping
   light packs with no way to reach them is a render check nobody can repeat.
   **#30 inherits two things measured today**: the canvas colour is
   `background-color` on `body` and must stay a *colour* (#89 fails the build
   if not), and `theme_color` is irrelevant in standalone (#39).
2. **#80 → #52**, adjacent — both are the timeline, layout before gesture.
3. **#24 last.** A polish pass over screens about to change is work done twice.

### How much of M11 can run unattended

**Four of six, fully.** #23, #29, #80 and #30's build are ordinary screen work
that `shot-matrix`, `verify:viewport` and `verify:firstpaint` can all see.

**Two carry caveats, and neither should be closed by an unattended session:**

- **#52** — the route, the undo toast and the revealed state are testable; the
  *gesture* is not. The issue says so itself. Its body is also stale in one
  place: `--danger` already exists, added by #22.
- **#24** — **transitions are structurally invisible to this harness.**
  `cdp.mjs` forces `prefers-reduced-motion: reduce` on every page it opens, so
  every PNG this project has produced is animation-free. Also check whether an
  install prompt applies at all on iOS before building one
  (`beforeinstallprompt` is not a Safari API), and note #54 already shipped the
  offline-tolerant Today view this issue asks for.

**#30 wants one device check after it lands** — the light packs are the first
time `--canvas`, `--chrome` and `--bg-top` stop being nearly the same colour,
which is exactly the divergence #38 spent a session on.

**The standing risk: push to `main` deploys.** The build gates on 327 tests and
#89 now fails on the two canvas edits that broke Safari, but nothing stops a
*visual* regression reaching production unseen. An unattended run should verify
hard, leave a device-check list, and not mark judgment work finished.

**Rule 4b:** M11 changes how the app looks, not how a number is computed, so it
owes a one-line "no computed figure — not applicable" in RECONCILIATIONS.md at
the close, not an entry.

**Build rule 4 (theme QA)** is unusually load-bearing for this milestone,
because #30 *is* the light packs — the render check is the deliverable rather
than a debt against it.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros). Read CLAUDE.md, then the LAST
section of NEXT-STEPS.md (Session P). Yesterday closed M9, M10, #38, #39
and #89, and the Safari chrome notes in CLAUDE.md were rewritten after two
regressions walked straight through the old wording. Trust that section
over anything earlier in the file.

This is M11, and it is an unattended run. Six issues, in this order:

  #23 editable Settings  ->  #29 theme + accent picker  ->  #30 light packs
  #80 timeline order     ->  #52 swipe-to-delete
  #24 polish pass        (last)

#23 before #29 because the pickers live on the surface #23 builds. #29
before #30 because a pack you cannot switch to is a render check nobody
can repeat. #80 before #52 -- same rows, layout before gesture.

Three things #30 inherits, all measured on a device and all easy to undo
by accident:
- the canvas colour is `background-color` on body at phone widths and must
  stay a COLOUR. Never the `background` shorthand, never a gradient alone.
  tools/canvas.test.mjs fails the build if you get this wrong -- read it
  before touching that block, not after.
- `theme_color` does nothing in standalone (#39). Don't spend effort there.
- #30 is the first time --canvas, --chrome and --bg-top stop being nearly
  the same colour, which is the divergence #38 spent a session on.

DO NOT CLOSE #52 OR #24. Build them, but their acceptance needs a person:
#52's gesture cannot be exercised by shot-matrix (screenshot the revealed
state via a DEV hook instead), and #24's transitions are invisible to the
whole harness -- cdp.mjs forces prefers-reduced-motion: reduce on every
page it opens. Reference them without the closing keyword and list what a
human still has to look at. Two notes so you don't rediscover them: #52's
body is stale where it says --danger needs adding (#22 added it), and
`beforeinstallprompt` is not a Safari API, so check whether #24's install
prompt applies on iOS at all before building one.

Verification, every issue: `npm run build` (327 tests, and it gates the
deploy), shot-matrix at 375/390/428 and LOOK AT THE PNGs, verify:viewport,
and `npm run verify:firstpaint` after a build -- it is the only check that
sees the pre-JS state. For #29 and #30, shoot every screen in each theme,
not just one.

Push to main deploys. Nothing stops a visual regression reaching
production unseen, so if a change is one you cannot verify, say so rather
than assuming. When the milestone is done, leave a device-check list at
the end of a new Session Q section, and give M11 its one-line "no computed
figure - not applicable" entry in RECONCILIATIONS.md (build rule 4b).

Commit per issue with "closes #N" only where genuinely finished.

Model: Opus 5 @ xhigh.
```
