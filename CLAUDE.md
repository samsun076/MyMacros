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
npm run build          # typecheck + production build to dist/
npm run check          # tsc --noEmit + wrangler types drift check
npm run db:migrate     # apply migrations to LOCAL D1 (miniflare)
npm run db:migrate:remote   # apply to REAL D1 — needs wrangler login
npm run db:studio      # sqlite3 shell on the local D1 file
npm run icons          # regenerate PWA icons into public/icons/
node tools/shot-matrix.mjs <file.html|url>   # 375/390/428 render matrix
```

`.dev.vars` holds local secrets (gitignored) — copy from `.dev.vars.example`.

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
- `theme-color` meta stays at `--bg-top` for the standalone/PWA case.

## Data & auth conventions

- **Every API route is per-user isolated.** Read `userId` from the session
  (never from the request body or a query param) and scope every query by it.
  Route handlers get a typed `c.var.user` from `requireAuth`; there is no
  path to a DB query without it.
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
  that directory is the reset button.
- Chrome (headless, shot-matrix) reports `env(safe-area-inset-*)` as 0 and
  can't reproduce Safari's chrome tinting — verify those in the iOS Simulator
  or on device.
- Google OAuth creds and the real D1/R2 bindings are placeholders until
  Session B2 (see NEXT-STEPS.md). Passkeys work locally without any of that.
