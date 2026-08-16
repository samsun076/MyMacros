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
npm run fonts          # re-fetch the self-hosted woff2 files (#35)
npm run fonts -- --check     # fail if the committed fonts drifted from the spec
npm run reconcile -- --date 2026-08-10 --weeks 1   # rule 4b's input block (#83)
npm run verify:auth    # drive the real passkey ceremony (needs `npm run dev`)
npm run verify:camera -- --cookie <name>=<token>   # /log asks for the camera once, not seven times (#94)
npm run verify:routing -- https://fuel.debrief.run   # /api survives navigation; SPA still falls back
npm run verify:viewport -- --cookie <name>=<token>   # no screen overflows horizontally (#51)
npm run verify:firstpaint   # needs `npm run build` first — the document paints the app alone (#53)
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
`#confirm` they inject no demo data, so they aren't DEV-gated. Trends adds `/trends#empty`
and `/trends#sparse` (#22), both DEV-gated — they build a real `TrendsResponse` by running
`buildTrends` over fabricated inputs, so a stage can't drift into a shape the route would
never produce.

**shot-matrix names its output from the hash**, so `/trends#empty` writes
`app-trends-empty@*.png` and hash stages do *not* overwrite each other. Copying files
aside afterwards clobbers the correctly-named output.

**The trends screen needs weeks of data to be worth shooting.** `seed-demo.mjs --weeks 12`
seeds a deterministic window — weigh-ins with a nine-day gap, unlogged days, a sparse week,
runs — so the irregularities the screen exists to handle are actually exercised. Without it
every PNG of `/trends` is the empty state.

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

## Sync from the Mac (#19, #20)

Two scripts push into `POST /api/sync`, both idempotent — they re-send a
rolling window and the endpoint upserts, so a missed run costs nothing and a
double run writes nothing twice.

```bash
MYMACROS_SYNC_TOKEN=mms_… node tools/sync-runs.mjs --days 30   # debrief runs.db
MYMACROS_SYNC_TOKEN=mms_… uv run tools/sync-garmin.py          # Garmin weigh-ins
uv run tools/sync-garmin.py login                              # once, interactive
MYMACROS_SYNC_TOKEN=mms_… ./tools/install-sync-agent.sh        # launchd, every 30 min
```

- **Tokens are per-user and hashed** (`sync_tokens`, migration 0003). Issued in
  Settings → Sync, shown once, revocable. The token resolves to a `user_id` and
  the route puts the same `c.var.user` on the context every other route reads —
  the rule is extended to the machine caller, never relaxed.
- **`/api/sync` is mounted on the OPEN sub-app** because `requireAuth` wants a
  session cookie a launchd job doesn't have. It does its own auth first. Don't
  "fix" this by moving it under `secure`.
- **Runs are `activity_id` 1 and 53**, and **TSS is `COALESCE(tss_hr, tss)`** —
  both from debrief's own `pipeline/src/weekly.js`, whose comment is explicit
  that raw `tss` changes calculation method across history and must never be
  aggregated. Don't re-derive these.
- **debrief's `energy_kj` column holds KILOCALORIES.** It comes from Suunto's
  `energyConsumption`, which is kcal. Measured, not assumed: recent runs land at
  56–63 kcal/km, right for an ~80 kg runner, where kJ would imply ~14 kcal/km.
  Dividing by 4.184 understates every run by 76% — and since eat-back returns a
  share of it, the symptom is a bonus that merely looks small.
- **Garmin reports weight in GRAMS** (`80200.0` = 80.2 kg). `sync-garmin.py`
  refuses anything outside 20–400 kg after conversion, loudly, because the
  failure worth catching is a silent unit change upstream.
- **Don't use `sqlite3 -readonly` on debrief's runs.db.** It is WAL mode, and a
  read-only open can't create the `-shm` file it needs:
  `Error: in prepare, unable to open database file (14)`. It passes whenever the
  database is quiescent, so it fails only sometimes — which is worse.
- **Garmin rate-limits login by IP (429)** and repeated attempts extend the
  block. Wait 15–30 minutes; don't retry in a loop.
- **Deleting a weigh-in writes a tombstone** (#71), or the scale re-adds it
  within 30 minutes — the rolling window finds no row and the upsert takes its
  INSERT branch. #20 can't cover that: it guards a row whose source is
  `manual`, and a deleted row isn't manual, it's absent.
  **The value is part of the key**, which is why tombstones never expire and
  still aren't a trap: they say "not *this* reading for this day". Delete a
  dumbbell-inflated 82.4, re-weigh at 76.6, and the corrected number arrives
  normally. Typing a weight for a day clears every tombstone on it — that's the
  escape hatch. Three directions, all three tested.
- **Garmin reports a deletion by going silent** (#66). Measured against the
  live API: no tombstone, no flag — the day just stops appearing in
  `dateWeightList`, which for one day is identical to "didn't weigh in". So the
  sync deletes nothing unless it sends `weights_window`, a claim that the list
  it carries is *everything* Garmin reported for that range. The claim is
  withheld entirely if any entry was refused, because a day we saw and dropped
  looks exactly like a day Garmin no longer reports. Three guards, each with a
  test that fails when it's removed: no window → no deletion; empty payload →
  no deletion (that's the shape an API hiccup takes); more than 2 days → refuse
  and name them (`--allow-removals N` to override). Manual rows are invisible
  to all of it — the protection lives on the SELECT that builds the candidate
  list, not on the DELETE.
- **Both scripts check in even when they have nothing** (#69). `/api/sync`
  stamps a per-source heartbeat in `sync_sources`, and the Today screen uses it
  to tell a rest day apart from a dead sync — so returning early on an empty
  payload would make the feed go quiet on exactly the days there is nothing to
  report. The signal is whether `runs`/`weights` is **present**, not non-empty:
  `{"runs": []}` says "I speak for runs and there are none", where no key says
  nothing at all. Don't collapse those.
- **Per source, not per token.** One token carries both feeds, so
  `sync_tokens.last_used_at` goes on looking healthy while half the pipeline is
  dead — which is exactly what hid #62's sixteen Garmin failures. Staleness
  threshold is 18h (`src/shared/sync.ts`), set by the false alarm rather than
  the true one: a laptop shut at 11pm and an app opened on a phone at breakfast
  is a nine-hour gap on a working system.
- **The launchd exit code is real, and one log holds everything** (#62). The
  runner used to end each sync with `|| echo`, so `launchctl print` reported
  `last exit code = 0` across sixteen consecutive Garmin failures. It now
  collects failures and re-raises them after both syncs have run — independence
  without silence. stdout and stderr both go to
  `~/Library/Logs/mymacros/sync.log` (rotates at 1MB, one generation kept);
  the old `sync.err.log` split is what hid those failures.
  `launchctl print gui/$(id -u)/run.debrief.mymacros-sync | grep 'last exit'`
  is now a real health check.
- **`sync-runs.mjs` refuses a batch whose median is under 35 kcal/km** (#63).
  A tripwire for the `energy_kj` unit trap, and a *median over the batch* on
  purpose: a unit change moves every value, a dropped HR strap moves one.
  Derived from debrief's history — 179 rolling 30-day windows sit at 56–89
  kcal/km, and the same windows read as kJ would be 13–21. If it ever fires on
  honest data, re-derive the floor; don't delete the guard.
- **It also reports matched-of-total** (`15 run(s) matched of 21 workout(s)`).
  `RUN_ACTIVITY_IDS` is copied from debrief, and the symptom of that copy going
  stale is zero rows — indistinguishable from a rest week. 0-of-0 is quiet;
  0-of-12 warns and prints the activity mix so the id that took over is named.
- Garmin credentials never reach the repo: `login` exchanges the password for
  OAuth tokens in `~/.garminconnect`, and nothing afterwards needs a password.

## The site (#56) — a separate repo

The walkthrough at **https://mymacros.debrief.run** is built from
`samsun076/mymacros-site`, which is **private**. This repo is public, so
**don't hyperlink the site repo from README.md or anywhere else public** — it
404s for everyone but Dave. Link the site; name the repo in prose.

- **Separate on purpose.** Every article and its images would otherwise ship to
  everyone who clones the app and stay in git history after being replaced.
  The argument that "the pages are generated from the app" argues for the
  *tooling* staying here — it drives a live dev server — not the site.
- **The tooling stays here; only outputs move.** `screencast.mjs`,
  `assemble-cast.mjs`, `shot-matrix.mjs`, `seed-demo.mjs` are all still ours.
  The handoff is a copy of generated files, not shared code.
- **The site is an assets-only Worker.** No `main`, no script, no D1/R2, no
  secrets. `npm run deploy` there is `node build.mjs && wrangler deploy`.
- **Deploys are manual, deliberately.** A `wrangler login` OAuth session already
  carries `workers_scripts`/`workers_routes`/`ssl_certs` write, which is how the
  Worker and the `mymacros.debrief.run` custom domain were created with no
  dashboard visit and no API token. Push-to-deploy would need a token that
  expires silently on a repo touched twice a year; it's tracked in the site
  repo, unbuilt on purpose.
- **The site is Night Athletic only.** It came from a Claude artifact, which
  *must* honour the viewer's colour scheme, so it shipped a light pack and
  `:root[data-theme]` overrides. Both were removed: nothing sets `data-theme`
  off-platform, and the light values were the unported "Instrument" pack (#30)
  — a light page wrapped around eight dark screenshots, advertising a theme the
  app can't render. When #30 lands, that's when it comes back.
- **The site asserts things about the app, and the app falsifies them
  silently.** M4 alone broke three claims (runs exist now, so "the day route
  returns no run at all" and the drawn budget-meter diagram are both false).
  Images decay loudly and prose decays quietly. Known-stale claims are issues
  in the site repo under the `stale-claim` label; the sweep belongs at
  milestone close, next to the theme QA of build rule 4.
- **A hardcoded figure is the trap to avoid.** `Commits: 81` on the page was
  wrong the next morning. Prefer figures that are finished history ("plan to
  deployed: 6 days") over any number the next commit moves.

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

## Build rules — canonical here, and not suggestions

**This list is the source.** PLAN.md carried an earlier copy that drifted: 4b, 8 and 9
never reached it, and its rule 7 was a *different rule* from this one's. Two sources for
one name is the same defect the Doppler note warns about, so as of 2026-08-10 PLAN.md
points here and the numbering below is the only numbering. Issue bodies and code comments
cite these by number — changing one renumbers the references, so append rather than
reorder.

1. **Night Athletic first.** It's the primary/default dark theme; polish
   happens there. Light packs (Field Notes, Instrument) port in M5 (#30).
2. **Never hardcode a color, font, or radius.** Everything through the
   semantic tokens in `design/tokens.css`. If a value isn't a token yet,
   add a token — don't inline it.
3. **Motif slots need a named variant per theme** before a component is done
   (placeholder variants OK until M5). The four slots: earned-kcal
   annotation, budget meter, log button, timeline row chrome. See TOKENS.md.
4. **Theme QA at the end of each milestone** — render check of the light packs.
4b. **Reconcile one real number whenever a milestone changes how a number is
   computed.** Recorded in [RECONCILIATIONS.md](RECONCILIATIONS.md). Take a figure
   the app is showing a real user, pull its inputs out of *production*, and
   recompute it by hand — **independently**, because importing `computeBudget` to
   check `computeBudget` proves nothing.

   **Trigger, not calendar.** A milestone that changes a computation owes an entry.
   One that changes how the app looks, loads or navigates owes none: M10 (service
   worker, fonts, first paint) and M11 (theme packs, timeline order) have no
   user-facing figure to reconcile, and a forced entry there is theatre.

   **Record the skip.** A milestone with nothing to reconcile still gets a one-line
   entry saying so. An absent entry looks like negligence; "no computed figure — not
   applicable" is a decision. Same principle as #69's sync heartbeat: silence and
   nothing-to-report must not look identical.

   **Budget 45–90 minutes, not ten** — 25–45 now `npm run reconcile` exists.
   Measured: M5 took a production D1 pull across six input categories, five days of
   hand-computed BMR → TDEE → deficit, and two cross-checks; M9 with the tool took
   the low end and spent nearly all of it on step 4. A rule that advertises ten
   minutes and costs sixty gets skipped the first time a milestone closes late.
   **If it finishes much faster than that, step 4 was skipped** — reading the inputs
   is the part with no output until it finds something.

   **`npm run reconcile` clears the mechanical half** (#83) — five tables out of
   production D1 as a paste-ready markdown block. **It prints no derived figure and
   never will:** printing the answer beside the inputs means the reconciler reads it
   first and confirms it, which turns the file into a log of the app agreeing with
   itself while every entry still says "✓ matches". `profiles.target_kcal` isn't
   merely unprinted, it is never SELECTed, and a test fails on any of five
   forbidden words reaching the output. Adding "here's what the app thinks" is the
   change that kills the rule.

   **Why it earns the time.** Tests prove the arithmetic and screenshots prove the
   layout; neither can tell you an **input** is wrong, and that is the failure this
   project keeps producing — six in M4 alone, plausible-looking rather than visibly
   broken, four of them found only by running against real data (a
   client-day/server-day filter that froze the target, `energy_kj` holding kcal,
   Garmin reporting grams, and a scale that silently reverted a typed weigh-in every
   30 minutes). Three entries so far: **#74** (a weekly deficit reading ~2× the
   truth because a 77-kcal day counted as fully logged), a soft weigh-in worth
   13 kcal/day, and M9 clean — no input defect, which is a result rather than a
   blank. **A clean pass is worth recording precisely because it is falsifiable:**
   M9 was the milestone that made the protein target depend on body weight, so
   "every weigh-in in the window is a real scale reading" is the specific claim the
   pass was there to test.

   **The arithmetic can also miss by one, and that is not noise.** M9's base target
   came out 1,908 by hand against the app's 1,909, because `trendWeightKg` rounds
   the window mean to 1 dp before anything consumes it. Correct and deliberate —
   but a 1 kcal gap is exactly the size that gets waved through as "rounding"
   instead of chased, and chasing it is how you learn the inputs are not what you
   assumed. Commit the hand figures *before* comparing.
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
9. **`--danger` is the alert colour, and it is deliberately narrow** (#22).
   Never `--accent` — rule 8 spends that on the focus macro, and Night
   Athletic switches it live, so an alert built on it changes colour when the
   user picks gold. On Trends it fires only for a surplus averaged across the
   *whole* window while the goal is a cut: one heavy week is noise, and
   colouring noise teaches people to ignore the colour. `design/TOKENS.md`
   records its measured CVD limit — under deuteranopia no colour separates
   from all three accents, so every use must be sign-carrying and labelled.

### One quantity, one source — the register (#86)

#78, #84 and #85 were one defect at three depths: **two things that should be one
thing**. Each was invisible until the one above it was fixed, which is why the type
feels like whack-a-mole. The sweep of 2026-08-11 enumerated them; this is the result,
kept here so the deliberate cases aren't re-litigated and the rest aren't rediscovered.

**Single sources, and nothing may compute these a second time.** `computeBudget` (base
target) · `macroTargets` (protein/carbs/fat grams) · `currentTrendWeightKg` /
`trendWeightKg` (what someone weighs now) · `earnedKcal` · `foldMeals` (what counts as
one meal) · `ACTIVITY_FACTORS` · `PROTEIN_G_PER_KG` · `ATHLETE_PROFILES` ·
`KCAL_PER_KG` · `TREND_WINDOW_DAYS` · `MIN_LOGGED_SHARE` · `STALE_AFTER_HOURS`. All in
`src/shared/`, all reached by both the client preview and the Worker, which is the whole
reason that directory exists.

**Deliberately two, and each is correct:**

- **`localDay()` vs `dayInTimezone()`** — the device owns the local day when a person is
  present (#44); the server needs an answer when nobody is (#19's launchd job,
  `refreshTarget`). Both files explain it. **A client-supplied day compared against a
  server-derived one is still the trap** that froze the M4 target.
- **The weekly bar's run figure vs the weekly deficit's** — budget view vs physiology
  view, eaten-back share vs full run calories, on purpose. A test fails if they're
  "fixed" into agreement.
- **Two profile-creation paths** — better-auth's `after` hook and `loadProfile`'s
  self-heal — same values, `onConflict doNothing`, so they cannot disagree.
- **Enums stated four ways** (TS type, migration `CHECK`, route `oneOf`, client array).
  The house pattern. `athlete_profile` is the one where adding a value costs a table
  rebuild, and #79 records why that price is worth paying.
- **`round1` defined six times.** A language idiom, not a domain rule — there is no
  truth for three tokens to diverge from. Left alone on purpose.

**`profiles.target_kcal` is a write-only cache.** `refreshTarget` is its only writer and
nothing user-facing reads it (#85) — `/api/day` computes the target, `/api/trends`
recomputes history. The single exception is `day.ts`'s un-onboarded fallback, which is
deliberately showing the deployment default rather than a number computed for nobody.
Verified by enumeration, 2026-08-11.

**The trap that keeps producing these: a literal that restates a column default.** Every
`?? <literal>` in Onboarding's form seeding is a second statement of a `DEFAULT` in
`migrations/`, correct only while someone keeps them in step by hand. One had already
rotted within a day (`carb_ratio_pct ?? 62` against a default rebuilt to 58). Seed from
the shared constant, and pin the pairs that remain with a route test against a freshly
inserted profile row.

**This sweep cannot find input bugs**, and a clean result is not a clean bill of health.
#74, `energy_kj` holding kcal, Garmin reporting grams, the scale reverting a typed
weigh-in — in every one the code was right and the data was not what it assumed. Rule 4b
is the check for those; M9's entry was paid 2026-08-14 and came back clean, which is a
result about the *inputs* and says nothing about this register.

### Trends (#22) — four things not to re-derive

- **The realized deficit uses the FULL run calories, never the eaten-back
  share.** `eat_back_pct` is a budgeting hedge that decides what you may eat,
  not a claim about physiology; applying it to the deficit applies it twice and
  understates every week by half a run. The weekly bar (budget view) and the
  weekly deficit (physiology view) therefore use *different* run figures on
  purpose. There's a test that fails if anyone "fixes" it.
- **Both rates must carry the same sign.** A positive deficit predicts weight
  going *down*, so `predicted_kg_per_week` is negated. They render as bare
  magnitudes side by side, so a sign mismatch reads as agreement — it shipped
  wrong once and was caught by reading the live payload, not by a test.
- **Averages run over `counted_days`, and everything divides by the same set.**
  A day counts when it is logged to at least `MIN_LOGGED_SHARE` (60%) of its own
  base target, has a base target at all, and isn't today (#74). Intake, target,
  earned and deficit all use that one denominator — the first cut of #74 let a
  day with no target through, which averaged it into the intake while the
  deficit excluded it, and one week reported two different means over two
  different weeks. If you add a figure here, divide it by `counted`.
- **Historical targets are reconstructed, not recalled.** `profiles.target_kcal`
  is one stored current value, so each past day is recomputed from that day's
  trend weight and the *current* profile. Changing activity level rewrites every
  week on the screen retroactively.

### Safari chrome blend (field-tested on device — don't re-derive)

- iOS Safari paints its **top** chrome from the **canvas** and ignores
  `theme-color` in-browser → `background-color` is `--bg-top` on phone widths
  (`@media (max-width: 499px)`). **"The body background" was too loose a way to
  say it, and the vagueness cost two regressions in one session** (#38):
  - The canvas comes from `<html>` if html declares a background, and from
    `<body>` otherwise. Setting `html { background: var(--canvas) }` moved the
    tint to `--canvas` — measured #0e1118, which is 1 off `--canvas` and 24 off
    `--bg-top`. **Declare no background on `html`.**
  - **The canvas takes a background-COLOUR, not a background-image.** Writing
    `background: linear-gradient(…)` on body resets `background-color` to
    transparent, nothing propagates, and the UA's dark-scheme canvas — *black* —
    wins. Measured #000000, at both ends of the screen at once. So body keeps
    `background-color` and `background-image` as **separate declarations** and
    must never use the `background` shorthand here.
  - Top chrome and the standalone bottom gap are **one surface**. They went
    black together, which is how that was established.
  - Every automated check stayed green through both regressions, including a
    direct read of the computed value. It was the right number on the wrong
    property. The claim is about what iOS *does*; only a device tests it.
- Its **bottom** bar derives from the page's bottom-edge content, but only
  from an **opaque** surface. The tab bar is solid `--chrome`: no alpha, no
  `backdrop-filter`, no border below it, extended through
  `env(safe-area-inset-bottom)`.
- `--chrome` is **never accent-tinted** (the accent switches live).
- **`theme-color` is inert in standalone — settled 2026-08-14 (#39).** The
  whole screen is the page plus the canvas. Proven by a regression that
  separated the three candidates for free: with `background:` shorthand having
  reset the canvas to transparent, `theme-color` and manifest `theme_color`
  were both `#1a2230` and the standalone screen rendered **black** at both
  ends. Neither was consulted. (The top was already known: `black-translucent`
  + `viewport-fit=cover` run the page to y=0.) The meta stays in `index.html`
  for iOS Safari *in-browser* and for future installable contexts — but nothing
  in standalone depends on it, and no change should be justified by what it
  "should" do there. **For #30, the value that matters is the canvas colour**
  (`background-color` on `body` at phone widths), not `theme_color`.
- **The top chrome cannot exactly match the page, and that is deliberate.**
  The canvas is a flat `--bg-top`; the page top is `--bg-top` *plus* the radial
  accent glow, measured ~6 lighter. Closing that gap would mean accent-tinting
  the canvas, and the accent switches live (rule 5) while `--chrome` is never
  accent-tinted. Baking a glowed value in would be right for coral and wrong
  for gold and mint.
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
- **A UAT check is recorded as a comment on the issue it checked, pass or
  fail, and labelled `uat`.** Half of what this project gets wrong
  is only visible to a thumb — the 5,000 g portion cap, the swallowed dismiss
  tap, and an open swipe row hiding the name of the meal it is about to delete
  were all found by using the app and none of them by a check. So the finding
  is only half the artifact; the other half is that somebody looked.
  **Clean passes get a comment too**, for rule 4b's reason exactly: a silent
  pass and negligence are indistinguishable from the outside, and #90 is the
  issue where "nobody looked" already cost real data.
  **Not a file.** `UAT.md` was proposed and rejected: the issue is already the
  home for a finding, and a second list of findings beside it is #86's own
  defect. The distinction that nearly justified one — `RECONCILIATIONS.md` is
  append-only and so cannot drift, where `PLAN.md` mirrored a live rule set and
  did — is real but does not earn a file when a comment carries the same dated,
  falsifiable record and sits on the thing it describes.
  Record the iOS version and whether it was Safari or the installed app;
  #94 turned entirely on that distinction.
- Push to `main` deploys via Workers Builds (wired in M1 #7).
- **Read the build result off GitHub, not by polling the asset hash:**
  ```bash
  gh api repos/samsun076/MyMacros/commits/<sha>/check-runs \
    --jq '.check_runs[] | select(.name|startswith("Workers Builds")) | .conclusion'
  ```
  Workers Builds reports back as a check-run. The *Cloudflare* Builds API is
  unreadable with the `wrangler login` token (Session B2), which is why this
  wasn't known — the status arrives by a different path. Better than
  hash-polling in both directions: it distinguishes failure from still-running,
  which polling structurally cannot (a failed build looks exactly like a slow
  one), and it doesn't report success off a single edge node.
- **A deploy has a mixed-version window, and the SPA fallback makes it silent.**
  Two Worker versions serve simultaneously while isolates drain, each with its
  own asset manifest — so a request can get the new `index.html` and then have
  its hashed asset land on the old version, which doesn't have that file.
  `not_found_handling: single-page-application` answers that with `index.html`
  and HTTP 200, so the browser gets `text/html` where it asked for JavaScript:
  a white screen, no error anywhere. Measured on the #22 deploy: 5 of 12
  requests mid-rollout, clean after ~90s. Self-heals on reload, so it isn't
  worth fixing at this scale — #54's service worker is the real mitigation.
  To check a deploy honestly, fetch the shell **and its referenced asset
  together** and assert the content-type; the hash alone marks the *start* of
  the rollout, not the end.
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
- **`shot-matrix` waits for three things, and only learned two of them on
  2026-08-14 (#29, #52).** It now waits for the boot skeleton's `aria-busy` to
  clear (React has mounted), then for a live in-flight request count to reach
  zero (the screen's own `/api/*` fetches have landed), then for
  `scrollHeight` to stop moving across a real delay. **Before that it measured
  the page height once and shot at it**, so anything not yet rendered was
  silently cropped off the bottom of the PNG — no error, no warning, just a
  short image. It bit three times in one session: Settings clipped mid-page at
  375 while 390 was complete, and Today came out at 812px twice, which is
  exactly the viewport with a header and nothing else. **Any PNG in `shots/`
  from before that commit may be cropped**, and any conclusion drawn from one
  is suspect.
- **`verify:viewport` knows about clipping (#52).** Its probe flags elements
  whose rect passes the viewport edge; an element parked off-stage inside an
  `overflow: hidden` ancestor is skipped, because it cannot be seen, scrolled
  to or tapped. The exemption only applies when the *ancestor's* own edge is
  inside the viewport, so a scroller that is itself overflowing still fails.
  Verified still able to fail by injecting a 600px block.
- **CDP can synthesize touch** (`Input.dispatchTouchEvent`), so a gesture's
  *state machine* — intent thresholds, commit distance, what opens and what
  closes — is testable unattended. What it cannot tell you is **feel**: whether
  a row tracks the finger or lags it, whether a scroll goes sticky. Don't write
  off a gesture as untestable; write off its feel.
- **Design QA never sees loading states.**
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
- **The shell is precached at `/`, never `/index.html`** (#87), and the cached
  shell must not be a redirect. Cloudflare's asset router **307s
  `/index.html` → `/`**, and a redirected response cannot answer a navigation:
  **Safari refuses the page outright** ("Response served by service worker has
  redirections"), which bricks the installed app rather than degrading it.
  **Chrome does not enforce this** — measured, by running the broken worker
  against the harness, where the navigation succeeded and rendered. So no
  amount of behavioural testing in headless Chrome can find it; the guard is
  the *structural* assertion in `verify:firstpaint` that the cached shell has
  `redirected === false`. The worker also refuses to answer a navigation from a
  redirected cache entry, so a cache poisoned by an older worker heals instead
  of bricking.
- **The service worker precaches the shell and nothing else** (#54). Its logic
  is `src/client/sw.js` (plain, unbundled); a plugin in `vite.config.ts` emits
  `/sw.js` with this build's manifest and a cache name hashed from it.
  **`/api` is skipped entirely, navigations included** — answering
  `/api/auth/callback/google?code=…` from the shell is B2's outage with a
  service worker on top. **No API response is ever cached**: a cached `/api/day`
  beside a live one is the register's own defect with a stale timestamp.
  Excluded on size: the 991 KB wasm, and everything in `public/` (icons, the
  1.4 MB of launch images) which never enters the bundle at all.
  **`install` must never call `skipWaiting`** — the update flow is
  *on next launch*, so a deploy can't reload the page under someone mid-meal;
  Settings → App is the only thing that forces it. Registration is
  `import.meta.env.PROD`-gated, a build-time literal, because a worker in front
  of Vite's dev server serves a stale document and the symptom is "my edit
  didn't take".
- **The launch path has three moving parts and one check** (#53). The
  stylesheet is inlined into `index.html` by a plugin in `vite.config.ts`
  (build only — dev injects CSS through JS), `#root` ships a boot skeleton that
  is deliberately the *same* `<main class="splash">` App.tsx renders while the
  session is pending, and `index.html` carries 12 `apple-touch-startup-image`
  links generated between markers by `npm run icons`. **Never hand-edit the
  block between `launch-images:start` and `:end`** — a size that disagrees with
  its media query is ignored by iOS silently, and the symptom is the white
  frame this issue was about, on one device model, months later.
  `npm run verify:firstpaint` is the guard for all three, and it deliberately
  blocks the app bundle so it can see the state `shot-matrix` and
  `verify:viewport` structurally cannot. It is **not** in `npm run build`:
  build runs in Workers Builds CI, which has no Chrome.
- **The fonts are ours now, latin subset only** (#35). `tools/fetch-fonts.mjs`
  is the only thing that should write `src/client/styles/fonts/` or
  `fonts.css`; the spec lives in `GOOGLE_FONTS_CSS` in that file, and
  **Archivo's `wdth` axis is load-bearing** for the eyebrow/label style — drop
  it on a refresh and every label on every screen reflows by a hair at once.
  The emitted CSS carries no `unicode-range` because there is one subset per
  face. That is a **real narrowing**: the CDN fetched `latin-ext` on demand, so
  "Kraków" now falls back to the system sans for the ł alone. é ñ ü ç å ø are
  all inside the latin subset, which is why it's an edge and not a bug. Adding
  latin-ext back means restoring `unicode-range` in the same change.
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
