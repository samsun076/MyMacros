# Installing MyMacros on your own Cloudflare account

This is a procedure, not a tour. Every step has a check with an expected answer, so
you can tell a half-finished install from a finished one — which matters here more
than usual, because the two look alike (see [Traps](#traps)).

**Written to be executed by a coding agent.** Point Claude Code at the repo and say
*"follow install.md"*. It also reads fine by hand.

> **`CLAUDE.md` in this repo is not for you.** It is the maintainer's file — build
> rules, design decisions, and a long list of things that turned out not to be true
> during development. Nothing in it is needed to run your own instance, and following
> it will waste your time.

---

## What you need

| | |
|---|---|
| **Node 22.12+** | Wrangler wants ≥22, Vite 8 wants ≥22.12. `node -v` |
| **A Cloudflare account** | Free tier is enough. D1, R2 and Workers are all on it. |
| **An Anthropic API key** | Turns a photo *or* a typed line into macros — both go through Claude. ~1–3¢ a read. [console.anthropic.com](https://console.anthropic.com) |
| **An email address** | Yours. It becomes the only account allowed on the instance. |

You do **not** need a Google Cloud project, a domain name, or a Mac. Each of those
was required at some point and none is now; if a guide tells you otherwise it is out
of date.

**One Cloudflare account per instance.** If you want a second instance later — for a
partner, a kid, a test box — give it its own Cloudflare account rather than adding it
to this one. Resource names are unique per account, so a second instance in one
account means renaming the Worker, the database and the bucket, and forgetting any of
them replaces the first instance. `npm run deploy` refuses that, but separate accounts
mean the repo's defaults just work.

---

## Part 1 — run it locally

Prove it works on your machine before involving Cloudflare. Nothing here touches the
network except `npm install`; D1 and R2 are emulated locally.

```bash
git clone https://github.com/samsun076/MyMacros.git
cd MyMacros
npm install
cp .dev.vars.example .dev.vars
```

**Copy `.dev.vars` before anything else, including `npm run cf-typegen`.** `wrangler
types` reads it to type the secret bindings; regenerating without it silently drops
them and the Worker stops type-checking.

Now edit `.dev.vars`. Two lines matter:

```ini
ALLOWED_EMAILS="you@example.com"   # your real address; this is who may create an account
BETTER_AUTH_SECRET=...             # any long random string: openssl rand -base64 32
```

`ANTHROPIC_API_KEY` is worth setting now. **Both** ways of describing food go through
Claude — the photo *and* the typed line — so without it the only input left is scanning a
barcode, which needs a camera. You can still create your account and walk the screens.

```bash
npm run db:migrate     # applies migrations/ to the local database
npm run dev            # SPA + Worker + local D1, one process
```

**Check:**

```bash
curl -s localhost:5173/api/health
```

```json
{"ok":true,"db":true,"migration":"0009_portion.sql",
 "expected_migration":"0009_portion.sql","migration_behind":false}
```

`ok` must be `true`. If `db` is `false` the migration did not run. If
`migration_behind` is `true` your code is newer than your database — run
`npm run db:migrate` again.

Then open <http://localhost:5173>. It should say **"Nobody has claimed this deployment
yet"** and lead with **Create your account**. Tap it, type the address you put in
`ALLOWED_EMAILS`, and confirm with your fingerprint or Face ID.

You now have a working local instance. If you set the Anthropic key, log a meal by typing
a description of it — that is the fastest way to see the whole loop. The camera needs
HTTPS or `localhost`, which `npm run dev` gives you.

---

## Part 2 — deploy it

```bash
npx wrangler login
```

### 2.1 Create the resources

```bash
npx wrangler d1 create mymacros-db
npx wrangler r2 bucket create mymacros-photos
```

`d1 create` prints a `database_id`. **Copy it.**

### 2.2 Edit `wrangler.jsonc`

Four values, and they are the only ones you should need to touch:

| Field | What to put |
|---|---|
| `d1_databases[0].database_id` | the id `d1 create` just printed |
| `routes` | your own hostname — or delete the whole `routes` line and set `"workers_dev": true` |
| `vars.APP_URL` | the URL the app will actually be served from, with `https://` |
| `vars.PASSKEY_RP_ID` | **`""`** unless you know you want otherwise — see below |

**On `PASSKEY_RP_ID`:** empty means "this host, and only this host", which is the
tightest setting and the right default. Setting it to a parent domain lets one passkey
cover every subdomain, which is why this deployment uses `debrief.run`. It is
effectively **irreversible** — passkeys are bound to the domain they were created
under, so changing it later forces everyone to enrol again.

**On `workers_dev`:** a free `*.workers.dev` subdomain works completely, passkeys
included, precisely because an empty `PASSKEY_RP_ID` falls back to the hostname. You do
not need to buy a domain.

### 2.3 Set the secrets

```bash
npx wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32 — a NEW one, not your local value
npx wrangler secret put ALLOWED_EMAILS         # your address; comma-separated for more
npx wrangler secret put ANTHROPIC_API_KEY
```

**`ALLOWED_EMAILS` empty or unset refuses everyone**, deliberately — a deployment that
forgets it is shut rather than open. If sign-up says *"This email is not allowed on this
deployment"*, this is why.

Do **not** set `APP_URL` or `PASSKEY_RP_ID` as secrets. They are `vars` in
`wrangler.jsonc`, and setting both leaves two sources for one name.

### 2.4 Migrate, then deploy — in that order

```bash
npm run db:migrate:remote
npm run deploy
```

**The order is load-bearing and nothing enforces it.** Deploying code that expects a
column the database does not have yet is a silent half-failure; doing it the other way
round is harmless, because an unused column costs nothing.

`npm run deploy` runs a preflight that refuses if a Worker of this name already exists
on the account bound to a *different* database. If you see that refusal, read it — it
is the second-instance trap and it is about to orphan somebody's data.

### 2.5 Check

```bash
curl -s https://<your-host>/api/health
```

`{"ok":true,...,"migration_behind":false}`. **One curl is the whole post-deploy check**:
`ok` is false if the database is unreachable *or* older than the code.

Then open the URL on your phone, tap **Create your account**, and use the address you
put in `ALLOWED_EMAILS`. Add it to your home screen — it is a PWA and runs full-screen
offline-capable from there.

---

## Part 3 — optional extras

**Google sign-in.** Only if you want the familiar button; passkeys are complete without
it. Create an OAuth client in Google Cloud Console (Credentials → OAuth client ID → Web
application), with `https://<your-host>/api/auth/callback/google` as the redirect URI,
then `wrangler secret put GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The button
appears on its own once both exist.

**Run and weigh-in sync.** `tools/sync-runs.mjs` and `tools/sync-garmin.py` push into
`POST /api/sync` from a Mac under launchd. They are the maintainer's own bridges to his
own data sources, kept in the repo as worked examples of feeding that endpoint. You do
not need them — the app works without any run or weigh-in data, and weigh-ins can be
typed on the `/weight` screen. Issue #70 tracks moving the Garmin half into a Cloudflare
Cron Trigger so no Mac is involved.

---

## Keeping it updated

There is no in-app update button, and there structurally cannot be one: a Worker cannot
deploy a Worker — no filesystem, no shell — and handing the running app a
deploy-capable API token so it could update itself is not a trade worth making. The
button you may be looking for, familiar from Nextcloud or Home Assistant, is not
missing here; it is unavailable.

### Learning that an update exists

**There are no tagged releases, deliberately.** There is no version scheme here and
commits land several a day, so a release process that depends on remembering to tag
would stop halfway through a year — and a Releases page that stops reads as an
abandoned project rather than an untagged one. Two things that cannot rot instead:

- **Your fork's own page says "N commits behind".** That is the update notification,
  it is always accurate, and it costs nobody anything to maintain.
- **The commit log is the changelog.** Messages in this repo are long and say what
  changed and why, which is more than a generated release note would carry.

**You never need to ask whether an update includes a migration.** Run
`db:migrate:remote` every time; when there is nothing pending it is a no-op that
prints an empty table. That is why the procedure below has it unconditionally rather
than as a step to decide about.

There is also no in-app "update available" check, and there will not be: an instance
should not phone home to the author's infrastructure to ask whether it is current. It
would leak the existence and liveness of every deployment, and make one person's
uptime a dependency of everybody else's app.

### Applying one

**Fork the repo** rather than cloning it, and updating becomes:

1. GitHub's **Sync fork** button on your fork.
2. `git pull` locally.
3. `npm run db:migrate:remote` — **first**.
4. `npm run deploy`.
5. `curl https://<your-host>/api/health` → `ok:true`.

Your `wrangler.jsonc` edits live in your fork and upstream rarely touches that file
(measured: 6 changes in 234 commits, all in the project's first five days), so Sync fork
is normally conflict-free. If it ever does conflict there, **keep your version** — it is
the file that defines your deployment.

**To automate it**, point your own CI at your fork. Two options and the trade is real:

- **Cloudflare Workers Builds** — a dashboard setting on *your* account pointed at
  *your* fork. Every push deploys. **It cannot run migrations**, so step 3 stays manual.
- **GitHub Actions** — can do migrate-then-deploy as one ordered job, at the cost of a
  Cloudflare API token in your repo secrets.

Neither is wrong. Workers Builds is less setup and leaves you a manual step that is easy
to forget; Actions is more setup and cannot forget.

---

## Traps

Every one of these was hit for real during development. They share a shape: **the
command succeeds and leaves something half-done.**

**`ALLOWED_EMAILS` empty refuses everyone.** The most common first-run confusion. It is
deliberate — the alternative is a deployment that forgets one secret and is open to
anyone who finds the URL.

**A skipped migration looks like a healthy deploy.** The Worker boots, the app loads,
every query answers, and the first request touching a new column 500s.
`migration_behind` in `/api/health` is the only thing that will tell you.

**A second instance in one Cloudflare account replaces the first.** `d1 create` and
`r2 bucket create` fail loudly on a name collision, so you rename those and keep the
*Worker* name — and `wrangler deploy` then exits 0 having pointed the first instance's
URL at your database. The preflight in `npm run deploy` catches this.

**`npm run dev` refuses to start if port 5173 is taken.** That is deliberate. `APP_URL`
pins the origin, and a dev server on a port `APP_URL` does not name fails every passkey
ceremony with `Invalid origin` — a message that says nothing about ports.

**Changing `d1_databases[0].database_id` also changes your *local* database.** Miniflare
names the local SQLite file after that id, so editing it silently repoints local dev at
a fresh, empty, unmigrated database. The old one is still on disk under the previous
id's filename. Re-run `npm run db:migrate` after you change it.

**Secret changes take up to a minute to reach every isolate.** Old isolates keep serving
the previous environment, so a freshly-pushed secret is intermittently absent. Redeploy
to recycle them, then sample a few times before believing it landed.

**Deleting `.wrangler/state/v3/d1/` is the local reset button.** It is the only way back
if the local database gets into a state you cannot explain.

---

## If you lose every device

The sign-up route can only ever *claim* an address with no way in yet. Once an account
has a passkey or a linked Google login, adding another device needs a session — which
means being signed in already.

If you lose every enrolled device, delete that account's passkey rows from your own D1
and claim it again:

```bash
npx wrangler d1 execute mymacros-db --remote \
  --command "delete from passkeys where userId = (select id from users where email='you@example.com')"
```

You own the database, so this is always available to you and to nobody else.

---

## Getting help

There isn't any, and that is stated plainly rather than implied:
[CONTRIBUTING.md](CONTRIBUTING.md) explains that this repo is public to be read and
forked, not to be contributed to, and that issues from non-collaborators are blocked at
the GitHub level. Fork it and take it wherever you want — it is [MIT](LICENSE).
