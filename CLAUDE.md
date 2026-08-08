# MyMacros — working notes for Claude

Mobile-first PWA: photograph your food, AI fills in the macros, and the daily
calorie budget breathes with your running. One user first (Dave), but
multi-user-shaped from day one.

**Read [PLAN.md](PLAN.md) for locked decisions** (stack, theming, v1 scope).
**[NEXT-STEPS.md](NEXT-STEPS.md)** is the session playbook — what to run next.
Work is tracked in GitHub issues, grouped by milestone.

## Stack

Vite + React 19 + Hono on **Cloudflare Workers** · D1 (SQLite) · R2 (photos,
from M3) · better-auth (Google + passkeys, no passwords) · Claude Sonnet 5 for
photo/text → macros (from M2). Free tier throughout. TypeScript everywhere.

One Worker serves both: static SPA via the assets binding, `/api/*` via Hono.

## Layout

```
src/client/      React SPA — routes/, components/, lib/
src/worker/      Hono API — index.ts (entry), auth.ts, db.ts, routes/, middleware/
src/shared/      types shared across the wire
migrations/      D1 migrations (wrangler d1 migrations)
design/          tokens.css (the token pack) + TOKENS.md (schema + motif slots)
sketches/        frozen design ground truth — read, don't edit
tools/           shot-matrix.mjs (design QA), make-icons.mjs (PWA icons)
shots/           screenshot output (gitignored)
```

## Commands

```bash
npm run dev            # vite dev — SPA + Worker + local D1, one process
npm run build          # check + test + production build to dist/
npm run check          # tsc --noEmit across app, worker, and node tsconfigs
npm test               # vitest, both projects (#47)
npm run test:watch     # same, watching
npm run db:migrate     # apply migrations to LOCAL D1 (miniflare)
npm run db:migrate:remote   # apply to REAL D1 — needs wrangler login
npm run db:studio      # sqlite3 shell on the local D1 file
npm run icons          # regenerate PWA icons + manifest from design/tokens.css
npm run verify:auth    # drive the real passkey ceremony (needs `npm run dev`)
npm run verify:routing -- https://fuel.debrief.run   # /api survives navigation; SPA still falls back
npm run verify:viewport -- --cookie <name>=<token>   # no screen overflows horizontally (#51)
node tools/shot-matrix.mjs <file.html|url>   # 375/390/428 render matrix
```

## Tests (#47)

Two vitest projects, one `npm test`, split by filename:

- **`foo.test.ts` → `unit`.** Plain Node, no bindings, ~150ms for the lot.
  Pure functions live here and this is where most tests belong.
- **`foo.route.test.ts` → `worker`.** Real workerd, real D1, `migrations/`
  applied by `src/worker/test-setup.ts` — so route tests describe the schema
  production actually has instead of a fixture that drifts from it. Costs a
  few seconds to boot, which is why it isn't the default for everything.

Both colocate with their source; `tsconfig.app`/`tsconfig.worker` already
include `src/`, so `npm run check` type-checks tests with no extra project.

- **Route tests call `app.fetch(req, env)`, not `SELF.fetch`.** SELF enters
  through the asset router, whose directory the Vite plugin supplies and which
  doesn't exist under test. Everything under `/api` is `run_worker_first`
  anyway, so calling the Hono app directly exercises the same path.
- **`npm run build` runs check + test.** Push to main deploys via Workers
  Builds, so the build is the only gate this workflow actually has — a red
  test must stop a deploy, not annotate one. Verified by breaking a validator
  and watching `npm run build` exit 1.
- **Route tests read `.dev.vars`** (the pool loads it — you'll see "Using
  secrets defined in .dev.vars"). Don't write a test that depends on a value
  in there; it isn't present in CI.
- **The pool's v4 API is not what its older docs describe.** There is no
  `@cloudflare/vitest-pool-workers/config` subpath and no
  `defineWorkersProject`/`singleWorker` — it's a Vite plugin, `cloudflareTest()`,
  imported from the package root.
- A test that can't fail is worse than no test. When one covers something that
  matters, break the source once and watch it go red before trusting it.

**Shooting the camera screen needs `--camera`.** Headless Chrome has no camera, so
`/log` and `/log#barcode` render their no-viewfinder fallback — a real screen, but not
the primary one. `--camera` gives Chrome a synthetic device and auto-grants the
permission; `--settle <ms>` waits past `document.fonts.ready`, which `getUserMedia`
resolves long after. Both flags exist on `verify:viewport` too, and its live layout is
the one worth checking — a viewfinder that failed to open is a centred paragraph, which
overflows nothing.

```bash
node tools/shot-matrix.mjs --camera --settle 1200 --cookie <name>=<token> \
  http://localhost:5173/log
npm run verify:viewport -- --camera --cookie <name>=<token>
```

The log flow's modes are addressable: `/log#photo`, `/log#barcode`, `/log#text`. Unlike
`#confirm` they inject no demo data, so they aren't DEV-gated.

`.dev.vars` holds local secrets (gitignored) — **copy it from `.dev.vars.example` before
anything else**, including before `npm run cf-typegen`: `wrangler types` reads `.dev.vars`
to type the secret bindings, so regenerating without it silently drops
`BETTER_AUTH_SECRET` and friends from `Env` and the Worker stops type-checking.

Design QA can shoot the running app, not just the sketches — every screen is behind auth,
so pass a session cookie:

```bash
node tools/shot-matrix.mjs --cookie better-auth.session_token=<token> http://localhost:5173/
```

**The cookie has a different name in production.** better-auth applies the
`__Secure-` prefix automatically over HTTPS (nothing sets it in `auth.ts`), so
against `fuel.debrief.run` it is `__Secure-better-auth.session_token=<token>` —
the bare name 401s. Same for any other tool that takes `--cookie`. Measured,
not assumed: bare → 401, prefixed → 200 on `/api/me`.

## Secrets

Canonical home is the **`mymacros` Doppler project** (`dev` and `prd` configs);
Doppler is never consulted at runtime — secrets are *pushed* to Cloudflare and
the Worker just reads plain `env` bindings, which is what keeps a self-hoster
on `wrangler secret put` with no extra account.

```bash
# regenerate local .dev.vars from the dev config
doppler secrets download -p mymacros -c dev --no-file --format env | grep -v '^DOPPLER_' > .dev.vars

# push prd secrets to the Worker (repeat after ANY secret change — Workers
# Builds deploys from Cloudflare's CI and will never run doppler)
doppler secrets download -p mymacros -c prd --format json --no-file \
  | jq 'with_entries(select(.key | startswith("DOPPLER_") | not))' | npx wrangler secret bulk
```

- **Always filter `DOPPLER_*`.** Doppler injects `DOPPLER_PROJECT`/`_CONFIG`/
  `_ENVIRONMENT` into every config; unfiltered they become bindings in
  `worker-configuration.d.ts` locally and real Worker secrets in production.
- **Never put `APP_URL` or `PASSKEY_RP_ID` in `prd`.** They're `vars` in
  `wrangler.jsonc`; pushing them as secrets too leaves two sources for one name.
- **Secret pushes lag by up to a minute.** Old isolates keep serving the
  previous env, so a freshly-pushed secret is intermittently absent (measured:
  2/12 requests served a stale value). Redeploy to recycle isolates, then
  sample several times before believing a secret landed.

## Build rules (from PLAN.md — these are not suggestions)

1. **Night Athletic first.** It's the primary/default dark theme; polish
   happens there. Light packs (Field Notes, Instrument) port in M5 (#30).
2. **Never hardcode a color, font, or radius.** Everything through the
   semantic tokens in `design/tokens.css`. If a value isn't a token yet,
   add a token — don't inline it.
3. **Motif slots need a named variant per theme** before a component is done
   (placeholder variants OK until M5). The four slots: earned-kcal
   annotation, budget meter, log button, timeline row chrome. See TOKENS.md.
4. **Theme QA at the end of each milestone** — render check of the light packs.
5. **Accent is live-switchable** — anything accent-colored references
   `--accent`, never a literal. Night Athletic users pick coral/gold/mint.
6. **375px is the reference width** (iPhone 13 mini). Nothing is done until
   it's verified there: `node tools/shot-matrix.mjs`. Then 390/428.
7. **Budget display convention:** base target and earned bonus always draw
   *separately* — base length plus a visually distinct earned extension.
   Never merge them into one number.
8. **Focus macro:** `--accent` on a macro bar means *the macro being
   targeted* (default protein, per-user in `profiles.focus_macro`). Other
   macros use `--mark-neutral`, plus an accent tick under the focused label
   and a screen-reader "— focus macro" suffix.

### Safari chrome blend (field-tested on device — don't re-derive)

- iOS Safari paints its **top** chrome from the **body background** and
  ignores `theme-color` in-browser → body background is `--bg-top` on phone
  widths (`@media (max-width: 499px)`).
- Its **bottom** bar derives from the page's bottom-edge content, but only
  from an **opaque** surface. The tab bar is solid `--chrome`: no alpha, no
  `backdrop-filter`, no border below it, extended through
  `env(safe-area-inset-bottom)`.
- `--chrome` is **never accent-tinted** (the accent switches live).
- `theme-color` meta stays at `--bg-top` for the standalone/PWA case — but
  **what it actually does there is unverified** (#39). Measured on device:
  at the top of a standalone launch the page gradient runs continuously to
  y=0, so `apple-mobile-web-app-status-bar-style: black-translucent` plus
  `viewport-fit=cover` are what put content under the status bar —
  `theme-color` paints nothing there. The bottom inset is still unattributed
  because `theme_color`, `--bg-top` and the body background are all
  `#1a2230`; only a contrast test can separate them, and every attempt so
  far was defeated by iOS manifest caching. Don't state what `theme-color`
  does in standalone until #39 is closed.
- **Standalone is not Safari.** In standalone the app owns the full screen,
  so the tab bar must cover the bottom safe area itself; Safari hides that
  case behind its own bottom bar. There is an open seam defect there (#38),
  found only on device.

## Data & auth conventions

- **Every API route is per-user isolated.** Read `userId` from the session
  (never from the request body or a query param) and scope every query by it.
  Route handlers get a typed `c.var.user` from `requireAuth`; there is no
  path to a DB query without it.
- **R2 photo keys are `<userId>/<uuid>.jpg`, and the prefix IS the
  authorization check** — for `GET /api/photos/:owner/:name` and for a
  `photo_key` arriving on a save. Not a convention on top of a check; it *is*
  the check (`src/worker/photos.ts`). A `food_logs` row deliberately can't
  stand in: the confirm sheet shows the photo *before* any row exists, because
  the Worker writes R2 before it calls Claude so an analysis failure can't lose
  it. A foreign key answers 404, never 403 — a 403 would confirm it exists.
- Auth tables (`users`, `sessions`, `accounts`, `verifications`, `passkeys`)
  are **owned by better-auth** — their columns are camelCase because the
  library generates them. Regenerate rather than hand-edit:
  `npx @better-auth/cli generate`.
- App tables are snake_case and reference `users(id)` with
  `ON DELETE CASCADE`. Money-free, but every row that belongs to a person
  carries `user_id`.
- Timestamps: app tables store ISO-8601 text in UTC; dates that mean "a day
  in the user's life" (`food_logs.logged_on`, `weights.measured_on`,
  `runs.ran_on`) are `YYYY-MM-DD` local-to-the-user text, so a day's totals
  don't shift with timezone.
- Migrations are append-only. New file per change, never edit an applied one.

## Conventions

- Commit per issue, `closes #N` **only when the issue is actually finished** —
  a partial commit references `#N` without the keyword.
- Push to `main` deploys via Workers Builds (wired in M1 #7).
- Sketches in `sketches/` are frozen ground truth from the design rounds. Port
  from them; don't edit them to match the app.
- Don't add a state-management library, a component library, or a CSS
  framework. Tokens + plain CSS modules-free stylesheets is the deal.

## Gotchas

- `wrangler dev` and the Vite plugin share one local D1 at
  `.wrangler/state/v3/d1/` — `npm run db:migrate` targets it, and deleting
  that directory is the reset button. **Which** sqlite file they share is
  keyed by `d1_databases[0].database_id` in `wrangler.jsonc`, so changing that
  id silently repoints local dev at a fresh, empty, unmigrated database (the
  old one stays on disk under the previous id's filename). Verified by
  experiment, not assumed. `GET /api/health` is the tell:
  `{"db":false,"migration":null}` means you're on an unmigrated file — run
  `npm run db:migrate`.
- **`gh issue view` prints nothing on this machine** unless the pager is
  disabled — prefix every `gh` read with `GH_PAGER=cat`, or use `--json`. It
  exits 0 with empty output, so it looks like an empty issue rather than a
  broken command.
- Chrome (headless, shot-matrix) reports `env(safe-area-inset-*)` as 0 and
  can't reproduce Safari's chrome tinting — verify those in the iOS Simulator
  or on device.
- **Design QA never sees loading states.** `shot-matrix` waits for
  `document.fonts.ready` plus two frames and the screens' own fetches, and
  `cdp.mjs` forces `prefers-reduced-motion: reduce` on every page it opens. So
  every PNG this project has ever produced is of a fully-loaded, animation-free
  app. #51 lived entirely in the data-pending window — the frame collapsed to
  its content width until the day's data arrived — and was invisible to the
  whole design loop for that reason, while being trivially reproducible by
  blocking `/api/day` and `/api/me` with `Network.setBlockedURLs`. When a bug
  is reported that screenshots can't reproduce, suspect a state the tooling
  skips past, not the device. The same blind spot covers the pending-upload
  and analyzing windows on the camera screen — reach them by holding the
  request open with `Fetch.enable` and simply not continuing it, which is how
  M3's analyzing state was shot. (`--camera`/`--settle` close the *other* half
  of this gap; see Commands.)
- **The Anthropic SDK retries timeouts, so `timeout` is not a deadline.** With
  the default `maxRetries: 2`, a 20s `timeout` is a 60s worst case. A real
  wall-clock ceiling is an `AbortSignal` — an abort is terminal. Both analyze
  routes use one (`DEADLINE_MS` in `routes/analyze.ts`); any future AI route
  should too. This is #49's finding in code: an attempt cap was never the
  lever, because the slowest call ever measured was a *single un-retried*
  attempt.
- **The barcode decoder fetches its WebAssembly from jsdelivr by default.**
  `@sec-ant/barcode-detector` is pointed at a self-hosted copy instead, via an
  alias in `vite.config.ts` and a `locateFile` override in
  `src/client/lib/barcode.ts` — otherwise a third-party CDN sits on the
  critical path of every scan (the same objection #35 raises about the fonts)
  and scanning breaks under a strict CSP or offline. **Re-check after any
  `@sec-ant/*` upgrade**, by blocking `*jsdelivr*` in DevTools and confirming a
  scan still decodes. Separately, OpenFoodFacts answers an unknown product with
  **HTTP 200 and `status: 0`** — checking the status code reports every unknown
  barcode as a success and then reads nutriments off an empty object.
- Google OAuth creds and the real D1 binding are placeholders until Session
  B2 (see NEXT-STEPS.md); `wrangler deploy` fails until `database_id` is real.
  Passkeys work locally without any of that.
- **Signing in locally:** there's no Google yet, and passkey registration
  needs an existing session, so the sign-in screen has a dev-only
  email/password button. It's gated on `import.meta.env.DEV`, which Vite
  bakes to a literal — a production Worker is built with email/password off
  and no env var can switch it back on. Never make that gate runtime.
- A missing static asset doesn't 404: `not_found_handling:
  single-page-application` serves index.html instead, so a mistyped asset
  path shows up as HTML with the wrong content-type rather than an error.
- **The asset router runs *before* the Worker, and it swallows HTML
  navigations.** With SPA `not_found_handling`, any unmatched path requested
  as a document (`Accept: text/html`) is answered with index.html and the
  Worker is never invoked. `fetch()` calls send `Accept: application/json`
  and fall through to the Worker, so the API looks fine while anything the
  *browser navigates to* silently returns the SPA. This broke the Google
  OAuth callback in B2: `/api/auth/callback/google?code=…` rendered the
  sign-in screen, so better-auth never saw the code — no session, no user,
  no error, no log line. `assets.run_worker_first: ["/api/*"]` is what keeps
  `/api` on the Worker regardless of `Accept`; don't remove it.
- **Verify browser-facing routes the way a browser asks for them.** curl
  defaults to `Accept: */*`, which is exactly the case the asset router
  passes through — so every curl probe of the broken callback above returned
  a correct 302 while the real browser got HTML. For anything reached by
  navigation (OAuth callbacks, redirects, share links), send
  `-H 'Accept: text/html' -H 'Sec-Fetch-Mode: navigate'` or the test proves
  nothing.
