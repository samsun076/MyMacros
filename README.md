# MyMacros

Photograph your food, AI fills in the macros, and your daily calorie budget breathes with your running.

<p align="center">
  <img src="docs/log-flow.gif" width="402"
       alt="Logging a meal: the Today screen shows 1,030 of 1,810 kcal eaten with 780 left; tapping the log button opens a camera viewfinder over a plate of steak and rice; after a few seconds reading the photo, a confirm sheet lists sliced steak 420 kcal and white rice 300 kcal, editable, totalling 720; tapping Log returns to Today, now 1,750 of 1,810 with 60 kcal left and dinner in the timeline.">
</p>

<p align="center"><sub>
Real recording — real camera frame, real Claude call, unedited numbers. The read took 5.4s
and is sped up here; the sheet reports its own timing. Recorded with
<a href="tools/screencast.mjs"><code>tools/screencast.mjs</code></a>.
</sub></p>

> **Status: in active development, built for one user so far.** It's deployed and the
> daily loop works end to end — photograph, scan or describe a meal and it lands in the
> timeline. It is *not* packaged for someone else to deploy: the budget engine that makes
> the target move with your running is the milestone in flight, and a self-hoster still
> has to wire up their own Cloudflare account by hand. [Setup](#setup) is honest about
> what that takes. **Not accepting issues or pull requests** — see
> [Contributing](#contributing).

## Architecture

One Cloudflare Worker serves the whole app: the React SPA through the assets binding, and
`/api/*` through a [Hono](https://hono.dev) router in the same script. Data lives in **D1**
(SQLite) via Kysely; meal photos live in **R2** under a `<userId>/` key prefix, where the
prefix *is* the authorization check rather than a convention on top of one. Auth is
[better-auth](https://better-auth.com) with Google sign-in and passkeys — no passwords
anywhere. The macros come from Claude Sonnet 5 through the Anthropic SDK: a photo or a
line of text goes in, a structured list of items with per-item confidence comes back, and
nothing is written until you've had a chance to edit it. Barcodes are decoded in-browser
and resolved against OpenFoodFacts, which needs no key.

The half that isn't built yet is the budget engine: run data is to arrive from
[debrief](https://debrief.run)'s existing pipeline rather than a second Suunto OAuth, and
weight from a Garmin Index scale through that same pipeline, so the day's target moves
with what you actually did. Neither route exists in `src/worker/routes/` today.

No state-management library, no component library, no CSS framework — semantic design
tokens (`design/tokens.css`) and plain stylesheets. 375px (iPhone 13 mini) is the
reference width and every screen is verified there first.

## Setup

> **Would rather not work through this by hand?** Point a coding agent at the repo and let
> it do the standing up — the clone, the migrations, the bindings, the secrets. It gets most
> of the way there unattended, and the place it stalls is the place it's worth the most,
> because reading the error and finding the trap is the actual work. [CLAUDE.md](CLAUDE.md)
> is largely a list of things that turned out not to be true here, and every one of them cost
> an afternoon to find. You'd be starting where I finished.

Local development needs **Node 22.12+** (Wrangler wants ≥22, Vite 8 wants ≥22.12) and
nothing else. D1 and R2 are emulated by miniflare, so **you do not need a Cloudflare
account until you deploy** — verified by running the steps below with an empty
`WRANGLER_HOME` and no credentials. `npm` is the package manager; `package-lock.json` is
the only committed lockfile.

```bash
git clone https://github.com/samsun076/MyMacros.git
cd MyMacros
npm install
cp .dev.vars.example .dev.vars   # do this before anything else, including cf-typegen
npm run db:migrate               # applies migrations/ to the local D1
npm run dev                      # SPA + Worker + local D1, one process
```

`GET /api/health` is the tell that it worked. `{"db":false,"migration":null}` means the
local database hasn't been migrated — run `npm run db:migrate` again.

### ⚠️ `ALLOWED_EMAILS` refuses *everyone* when it's empty

This is the one that will waste your afternoon. `ALLOWED_EMAILS` is a comma-separated
allowlist of who may **create** an account, and **an empty or unset value refuses every
signup** — deliberately. A guard that defaulted to "allow" is exactly the hole it exists
to close: a deploy that forgot the variable would look fine and be wide open to anyone
who found the URL, spending its `ANTHROPIC_API_KEY` on their lunch.

So if sign-up silently refuses you and nothing looks broken, that's this. Put your own
address in `.dev.vars`:

```
ALLOWED_EMAILS="you@example.com"
```

Existing accounts are unaffected by changes here; it only gates creation.

### Signing in locally

There are no Google credentials in a fresh clone, and registering a passkey requires a
session you don't have yet — so the sign-in screen carries a **dev-only email/password
button**. It's gated on `import.meta.env.DEV`, which Vite bakes to a literal, so a
production build ships with those endpoints dropped from the Worker entirely and no
environment variable can switch them back on. Sign in with it once, then enrol a passkey
from Settings.

### Deploying your own

Beyond the local setup, this needs a Cloudflare account with Workers, D1 and R2 enabled:

```bash
npx wrangler login
npx wrangler d1 create mymacros-db          # paste the id into wrangler.jsonc
npx wrangler r2 bucket create mymacros-photos
```

Then set the secrets on the Worker (`npx wrangler secret put <NAME>`):
`BETTER_AUTH_SECRET`, `ALLOWED_EMAILS`, `ANTHROPIC_API_KEY`, and — if you want Google
sign-in — `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Passkeys work without Google.

Edit `wrangler.jsonc` for your own deployment: `routes` (or drop it and re-enable
`workers_dev`), and the `vars` block's `APP_URL` and `PASSKEY_RP_ID`. Then `npm run
deploy`.

Two traps worth knowing before you hit them:

- **`d1_databases[0].database_id` also names your *local* sqlite file.** Changing it
  silently repoints local dev at a fresh, empty, unmigrated database — the old one stays
  on disk under the previous id's filename. Re-run `npm run db:migrate` after you swap it.
- **A passkey's `rpID` must be the origin's host or a parent of it.** This deployment sets
  `PASSKEY_RP_ID` to a parent domain, which is why `workers_dev` is off here. If you set
  no `PASSKEY_RP_ID` at all you get the hostname as its own rpID, and passkeys work fine
  on `*.workers.dev` with no domain of your own.

### Other commands

```bash
npm run build        # typecheck + production build
npm run check        # tsc --noEmit across app, worker and node tsconfigs
npm run db:studio    # sqlite3 shell on the local D1 file
node tools/shot-matrix.mjs <file.html|url>   # 375/390/428 render matrix
```

A fresh clone signs in to an empty Today screen, which is a poor first look and
useless to screenshot. `tools/seed-demo.mjs` fills one day with a plausible morning;
`tools/screencast.mjs` and `tools/assemble-cast.mjs` are what produced the GIF above,
and between them they'll rebuild it from scratch:

```bash
node tools/seed-demo.mjs                       # a day of meals in the local D1
node tools/screencast.mjs --cookie better-auth.session_token=... \
  --video meal.y4m --at 19:20 --out shots/cast # drive and record the log flow
node tools/assemble-cast.mjs --in shots/cast --out docs/log-flow
```

The recorder needs a square `.y4m` to stand in for the camera — headless Chrome has no
camera, and its built-in fake device is a colour-bar test pattern. Any photo will do:
`ffmpeg -loop 1 -framerate 15 -i plate.jpg -t 8 -vf scale=720:720 meal.y4m`.

## Layout

```
src/client/   React SPA — routes/, components/, lib/
src/worker/   Hono API — index.ts (entry), auth.ts, db.ts, routes/, middleware/
src/shared/   types shared across the wire
migrations/   D1 migrations (append-only — new file per change)
design/       tokens.css (the token pack) + TOKENS.md (schema + motif slots)
sketches/     frozen design ground truth from the mockup rounds
tools/        design-QA and verification scripts
```

[PLAN.md](PLAN.md) holds the locked decisions — stack, theming, v1 scope.
[NEXT-STEPS.md](NEXT-STEPS.md) is the session playbook, and
[CLAUDE.md](CLAUDE.md) is the working brief: conventions, and a long list of things that
turned out not to be true. Work is tracked in GitHub issues, grouped by milestone.

## Contributing

**I'm not taking pull requests or issues right now.** This repo is public to be read, not
to be built by committee — it's a personal app, the architecture is still moving, and I'd
rather not accept work I can't promise to merge. Non-collaborators are blocked from
opening issues and PRs at the GitHub level, so please don't spend the effort. Forking and
doing whatever you like with it is exactly what the license is for.

## License

[MIT](LICENSE) © 2026 Dave Marcinowski
