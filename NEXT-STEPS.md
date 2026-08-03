# Next steps — session playbook

State as of 2026-08-02 (night): plan locked (PLAN.md), 31 issues across 7 milestones.
**M0 is done** — Session A ran: #31 (shot-matrix tooling), tweak list folded into
c2-night-athletic, #2 (design/tokens.css + TOKENS.md), #3 (e-log-flow mockup), light-pack
theme-QA done (one finding filed on #30). **Session B1 is done** — #4, #5 (local D1), #8
and the code half of #6 all landed; project CLAUDE.md written. **Next up: Session B2**,
the credentials-and-deploy half — everything left in M1 needs Dave's accounts. This file
is the runway: what to run next, on which model, with paste-ready starter prompts.

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

### 1. Log in — `! npx wrangler login`
Browser OAuth click-through. Everything after this needs it.

### 1b. Make sure `debrief.run` is a zone on this Cloudflare account
The custom domain has to be Cloudflare-managed DNS. If `debrief.run` is already there,
nothing to do. If not: dashboard → Add a site → follow the nameserver change at the
registrar, and wait for it to go active before step 4.

### 2. Create the real D1
```
npx wrangler d1 create mymacros-db
```
Paste the printed `database_id` into `wrangler.jsonc` → `d1_databases[0].database_id`,
replacing `"local-dev-placeholder"`. **`wrangler deploy` fails until this is a real id.**

Optionally also `npx wrangler r2 bucket create mymacros-photos` — nothing reads it until
M3, and the binding gets written in #13 alongside the code that uses it, so creating the
bucket early only saves a trip back to the CLI.

### 3. Set the session secret
```
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
```
Not optional — better-auth signs session cookies with it. Local dev has its own value in
`.dev.vars`; the two are unrelated.

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

Then, with the client ID and secret it hands back:
```
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy
```
`GET /api/auth-methods` should flip to `{"google":true,...}` and the sign-in screen grows a
"Continue with Google" button. It hides itself while the credentials are missing, so that
response is the check that this step actually worked.

Optionally paste the same pair into `.dev.vars` to get Google sign-in locally too.

### 7. Connect the repo to Workers Builds (#7)
Cloudflare dashboard → **Workers & Pages → mymacros → Settings → Builds → Connect** →
GitHub OAuth grant → pick `samsun076/MyMacros`, branch `main`. Build command `npm run
build`, deploy command `npx wrangler deploy`. Then push an empty commit and watch it build,
so push-to-deploy is proven rather than assumed.

### 8. `wrangler secret put ANTHROPIC_API_KEY`
Can slip to M2 — nothing in M1 calls Claude. Setting it now saves a step later.

### 9. Smoke test on the phone

> **Don't share the URL yet — #33.** Until its allowlist lands, any Google account that
> reaches `fuel.debrief.run` can create an account, and from M2 those accounts spend the
> deployment's `ANTHROPIC_API_KEY`. Fine while the hostname is unknown to anyone else;
> not fine the moment it's posted anywhere. It's a ~15-line guard — worth doing straight
> after this session, before M2 puts a paid API behind the door.

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
Working on MyMacros (~/Projects/MyMacros). Read NEXT-STEPS.md — we're doing
Session B2 together: the credential/deploy half of M1 (finish #6 and #7).
I'm here to click OAuth prompts and paste secrets; you drive. Work through
the B2 checklist in order, one step at a time — tell me exactly what to do
when it's my turn (use `! <command>` for interactive logins), verify each
step landed before moving on, and end with the deployed smoke test. Commit
with "closes #6" / "closes #7" when each is actually done, push when done.
```

## Then

- **M2 core loop** (#9–#12) — text quick-add → confirm sheet → Today screen, built in Night
  Athletic. Candidate for a single autonomous Fable run once the scaffold is solid.
- Keep feeding design tweaks onto issue #2's thread until tokens freeze; after that, tweaks
  become normal issues.
