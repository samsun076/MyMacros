# Next steps — session playbook

State as of 2026-08-04 (evening): plan locked (PLAN.md), M0 and M1 done, the app live at
https://fuel.debrief.run. **Both review sessions have run**: C1 (audit) filed #40–#47 and
fixed #40/#41/#42; C2 (judgment) verified design fidelity by eye against the frozen
sketches (verdict: faithful, no unfiled drift), signed off the architecture for M2–M6,
signed off the motif registry on #43, and filed #48 (client data layer — the one decision
to land before #11). **Next up: Session D builds the M2 core loop (#9–#12).** This file is
the runway: what to run next, on which model, with paste-ready starter prompts.

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

## Session D — build M2, the core loop (Opus 5 @ xhigh, or one autonomous Fable run)

Issues **#9–#12** plus the groundwork C1/C2 settled. Everything below is decided —
nothing for the session to invent. Read the issue comments; they carry the decisions.

### 0. Prerequisite (Dave, ~2 min, before the session)

`ANTHROPIC_API_KEY` into Doppler (`prd` **and** `dev`), pushed to the Worker, and
`.dev.vars` regenerated — commands in CLAUDE.md `## Secrets`. It's the only secret that
costs money and M2 cannot be verified end-to-end without it. Everything else is code.

### Order of work (dependencies, not preference)

1. **#48 first** — the typed API client (`src/client/lib/api.ts`), refetch-on-mount
   policy, and `GET /api/day/:date` returning `{ logs, totals, target_kcal, run: null }`.
   It's the pattern every M2 screen copies, so it exists before any screen does.
2. **Motif registry** (settled on #43) — `src/client/motifs/` with `MotifSet` requiring
   all four slots, `MOTIFS: Record<Theme, MotifSet>`, placeholders re-exporting Night
   Athletic. Move the existing `.log-btn` in as the first variant so the convention
   predates the meter and timeline row rather than being retrofitted onto them.
3. **Migration 0002** (append-only, new file): `profiles.target_kcal` (settled on
   #45/#11 — the base target lives in a real column; M4 changes how it's calculated,
   not where it lives).
4. **#9** — `POST /api/analyze/text` → `claude-sonnet-5` structured output. **Load the
   `claude-api` skill before writing this.** Settled on #45: official `@anthropic-ai/sdk`
   (add the dependency), thinking disabled or low effort (Sonnet 5 thinks by default;
   PLAN.md promises the happy path under ~10s), `additionalProperties: false` on every
   schema object, and range-check `confidence` in our code — structured outputs silently
   drop numeric bounds.
5. **#10** — confirm sheet + `POST /api/food-logs`. Settled on #44/#10: `logged_on` is
   the client's local date, midnight cutoff, set once and never recomputed on edit; the
   client writes `profiles.timezone` on first log; `meal_slot` derives from the clock
   (<11 breakfast · <16 lunch · <21 dinner · else snack), displayed on the sheet,
   editable — the sketch designs no picker control, so derived-and-displayed is the
   port and any picker is a deliberate addition. Extract `routes/me.ts`'s validator
   helpers (`isNum`/`oneOf`/`isDay`/`pct`) into a shared worker module here instead of
   copy-pasting them into the second route.
6. **#11** — the Today screen, ported **literally** from the frozen sketches (see the
   comments on #11): adjusted target as the hero denominator with the base/earned
   arithmetic in the aria-label; the `.earned` meter layer renders at zero width in M2
   rather than being omitted; `BASE … ▸` labelled on the scale; macro targets derived
   from the adjusted total; focus macro carries accent + the screen-reader suffix. This
   issue adds two motif slots (budget meter, timeline row) — they go in the registry,
   and `BudgetMeter` takes the earned data so each theme decides whether the earned
   mark lives inside its box or beside it (see the C2 note on #43).
7. **#12** — favorites/recents, one-tap re-log at the current slot (same clock
   derivation as #10).

### The design gate (every screen, before its issue closes)

Shot-matrix at 375/390/428 and **look at the PNGs** — never infer fidelity from CSS.
The signed-in local recipe, verified end to end in C2 (dev user exists; sign-up is the
fallback on a reset DB; better-auth 403s without the Origin header):

```
npm run dev                      # in another terminal, then:

CREDS='{"email":"dev@mymacros.local","password":"dev-password-not-for-production"}'
curl -s -X POST localhost:5173/api/auth/sign-in/email \
  -H 'content-type: application/json' -H 'Origin: http://localhost:5173' \
  -c /tmp/mm.txt -d "$CREDS" > /dev/null
grep -q session_token /tmp/mm.txt || curl -s -X POST \
  localhost:5173/api/auth/sign-up/email -H 'content-type: application/json' \
  -H 'Origin: http://localhost:5173' -c /tmp/mm.txt \
  -d "${CREDS%\}},\"name\":\"Dev\"}" > /dev/null
TOKEN=$(grep session_token /tmp/mm.txt | awk '{print $7}')

node tools/shot-matrix.mjs --cookie "better-auth.session_token=$TOKEN" \
  http://localhost:5173/ http://localhost:5173/settings
```

Gotcha found in C2: shot-matrix names outputs by URL path, so a signed-**out** shot of
`/` overwrites the signed-in `app-home@*.png`. Copy aside anything you need to keep
before re-shooting the same path in a different auth state.

Sanity-check `curl -s localhost:5173/api/health` first — `{"db":false,"migration":null}`
means run `npm run db:migrate` (see the CLAUDE.md gotcha about `database_id`).

### Guardrails that exist and shouldn't be broken

- **`npm run verify:routing -- https://fuel.debrief.run`** after any change to the
  `wrangler.jsonc` assets config or route mounting — and after the final push, since
  push deploys (~40s via Workers Builds; don't `npm run deploy` by hand).
- **Every new API route is per-user isolated** — mount under the `secure` sub-app,
  read `c.var.user`, never a userId from body or query.
- **`ALLOWED_EMAILS` fails closed**; new sign-up paths inherit it via the user-create hook.
- **Test browser-facing routes the way a browser asks for them** — `Accept: text/html`
  + `Sec-Fetch-Mode: navigate` for anything reached by navigation.
- **`npm run check` green before every commit** — it's what makes the motif registry's
  missing-variant guarantee real.

### Deliberate — don't let a session "fix" these

Passkeys scoped to `debrief.run` (#34) · `workers_dev: false` ·
`run_worker_first: ["/api/*"]` · `ALLOWED_EMAILS` failing closed on empty · dev email
sign-in gated on `import.meta.env.DEV` as a build-time literal · no service worker
(deliberate non-decision, reasoning on #42) · refetch-on-mount with no client cache
(#48 — add invalidation only when something hurts).

### Carried over, not blocking M2

**#38/#39** (standalone chrome, theme-color) → M5's device pass · **#30** light packs +
**#35** self-hosted fonts + **#46** tab-label spacing → M5 · **#47** test infra → stand
up before M4's budget math, not before M2 · **#33** claim flow → M6.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros, github.com/samsun076/MyMacros).
M0/M1 are done, the app is live at https://fuel.debrief.run, and both review
sessions (C1 audit, C2 judgment) have signed off the foundation. This is
Session D: build the M2 core loop, issues #9-#12.

Read CLAUDE.md, PLAN.md (Theming + Build rules), design/TOKENS.md, then
`gh issue view --comments` for #9, #10, #11, #12, #43, #44, #45, #48 — the
comments carry every settled decision; nothing is yours to invent. Follow
the "Order of work" in NEXT-STEPS.md's Session D section: #48's API client
and day endpoint first, then the motif registry (per #43), then migration
0002 (profiles.target_kcal), then #9 → #10 → #11 → #12.

Load the claude-api skill before writing the Claude call (#9). Load the
frontend-design skill before building screens. Port the Today screen and
confirm sheet literally from sketches/e-log-flow.html and
sketches/c2-night-athletic.html — sketches are frozen ground truth; never
edit them to match the app.

Verify every screen at 375/390/428 with the signed-in shot-matrix recipe in
NEXT-STEPS.md and LOOK at the PNGs. npm run check must stay green. Don't
break the guardrails or "fix" the deliberate list in NEXT-STEPS.md.

ANTHROPIC_API_KEY should already be in the environment (I push it before
this session) — if /api/analyze/text can't reach Claude, stop and tell me
rather than stubbing it silently.

Commit per issue, "closes #N" only where the issue is genuinely finished,
push when done (push deploys), and finish by re-running
npm run verify:routing -- https://fuel.debrief.run after the build lands,
plus one end-to-end quick-add against production. Rewrite the Session D
section of NEXT-STEPS.md as the M3 runway before you stop.
```
