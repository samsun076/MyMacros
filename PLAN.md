# MyMacros — Plan

**One-liner:** A mobile-first PWA where you photograph (or scan, or describe) your food, AI fills in the macros, and your daily calorie budget breathes with your running.

Built for weight loss, built for one user first (Dave), but shaped so other people can use it later — hosted or self-hosted.

## Locked decisions

| Area | Decision |
|---|---|
| Stack | Vite + React + Hono on **Cloudflare Workers**, D1 (SQLite), R2 (photos), better-auth. Free tier. Deploy model is `.github/workflows/deploy.yml` (#136): `main` → the author's instance only, a `v*` tag → every other instance (#137) — built, and **inert until a repo variable is set**, so Workers Builds is still the live deployer as of 2026-08-26. See CLAUDE.md |
| AI | **Claude Sonnet 5** vision + structured outputs (JSON schema) for photo→macros and text→macros. ~1–3¢ per photo |
| API key | v1: `ANTHROPIC_API_KEY` as a Workers secret. OSS path: agent-install directives (Claude Code sets up D1/R2/secrets for the self-hoster) **and** optional per-user key in app settings for hosted multi-user |
| Run data | Sync from **debrief's `runs.db`** — a small addition to the existing launchd pipeline POSTs recent runs (date, distance, kcal, TSS) to MyMacros' API. No new Suunto OAuth in v1 |
| Weight data | **Garmin Connect sync** via unofficial `python-garminconnect` (garth auth) in the same local pipeline — the Garmin Index scale weigh-ins flow in automatically. Manual entry as fallback |
| Budget model | **TDEE (Mifflin-St Jeor) + chosen deficit.** Protein is anchored to body weight in g/kg, not taken as a percent of energy — a run must not inflate it (#77); carbs and fat divide what's left. Targets recompute as logged weight drops |
| Eat-back | **Configurable partial** (default 50%) of run calories added to the day's budget, shown transparently ("+320 kcal from your 6mi run") |
| Logging inputs | Photo (meal or label) · **barcode → OpenFoodFacts** (free, exact) · **AI text quick-add** ("chipotle bowl, no rice") · favorites/recents. Every AI entry is editable before saving |
| Platform | **Capture is mobile, review is both.** Photographing, scanning and quick-adding a meal happen on the phone — nobody photographs a restaurant plate from a desk. Desktop is a review surface (today, trends, history, fixing a past entry) and never grows a log flow. Mobile stays the reference experience and 375px stays the design gate |
| Auth | Google sign-in + passkeys via better-auth. No passwords |
| Ambition | Personal-first but **multi-user-shaped** (real auth, per-user data isolation). SaaS vs open-source decision deferred until the app is proven |
| Design | **Three themes, one app** (decided from the v2 mockup round — see Theming below). Native-feeling mobile interactions (bottom tabs, sheets, safe areas). Editorial direction rejected as AI-slop-adjacent |

## Theming

All three v2 mockup directions ship as **user-selectable themes** (Settings → per-user in `profiles`):

- **Night Athletic** — *primary + default + dark theme.* Blue-hour dark world with a user-selectable accent: **dawn coral / warm gold / mint** (the accent is itself a per-user setting). Ground truth: `sketches/c2-night-athletic.html`.
- **Field Notes** — light theme. Warm-ivory daily ledger, vermilion stamp as hero. `sketches/d2-field-notes.html`.
- **Instrument** — light theme. Bone paper, machined Braun-style dial. `sketches/b2-instrument.html`.

Why it's cheap: all three converged on the same skeleton (remaining-kcal hero, budget meter with a physically-extended earned zone, one shared meal+run timeline, tab bar). One layout, one component tree; themes are **semantic token packs** (CSS custom properties + `data-theme`): surfaces, inks, accent, fonts, radii.

The exception is **motif slots** — 3–4 components that render per-theme variants rather than re-skin: the earned-kcal annotation (rubber stamp / machined groove / hatched fuel zone), the budget meter, the log button, timeline row chrome. These are the only components with per-theme code.

**Budget display convention** (settling a mockup discrepancy): base target and earned bonus are always shown *separately* — the meter draws base length plus a visually distinct earned extension. Never silently merge them into one number.

**Focus macro** (decided): the accent color on macro bars marks the *focus macro* — the one the user is actively targeting (default protein, configurable in Settings, per-user in `profiles`). Other macros render neutral. Applies across all themes and all accent choices.

### Build rules going forward

**Moved to [CLAUDE.md](CLAUDE.md#build-rules--canonical-here-and-not-suggestions) on
2026-08-10. That list is canonical; this section is a pointer, not a copy.**

The two had drifted. Rules 4b, 8 and 9 were added to CLAUDE.md and never reached here, and
the rule numbered **7** was a *different rule* in each file — "Safari chrome blend" here,
"Budget display convention" there. Issue bodies and code comments cite build rules by
number, so two numberings made every one of those references ambiguous.

Rather than reconcile two copies that will drift again, there is now one. CLAUDE.md won
because that is where every rule since M1 actually landed — the plan proposed them; the
working document maintained them.

The Safari chrome-blend mechanics that used to be rule 7 here are not lost: they live in
CLAUDE.md's own **"Safari chrome blend (field-tested on device — don't re-derive)"**
section, in more detail than this list ever carried.

**Everything else in PLAN.md remains canonical** — stack, theming decisions, v1 scope, the
data model. Only the build-rules list moved.

## V1 scope — the daily loop

1. **Today screen** — budget ring (eaten vs adjusted target), macro breakdown, meal timeline with photos, today's run if any.
2. **Log flow** — big "+" → camera / barcode / text. AI returns items with confidence → confirm/tweak → saved. Happy path under ~10 seconds.
3. **Weight** — auto-synced from the Garmin scale; quick manual entry fallback; 7-day smoothed trend feeds target recalc.
4. **Trends** — weekly weight vs intake vs deficit. The "is this working?" view.
5. **Settings** — profile/TDEE inputs, deficit, protein anchor and carb:fat ratio, eat-back %.

**Out of v1:** adaptive MacroFactor-style TDEE (v2, needs weeks of data), direct Suunto OAuth (needed only for other users), billing, micro-nutrients, anything social.

## Data model sketch

`users` → `profiles` (height, weight, activity, deficit, eat-back %) → `food_logs` (name, kcal, P/C/F, source: photo|barcode|text|favorite, photo R2 key, meal slot, edited flag) → `weights` (source: garmin|manual) → `runs` (synced: date, distance, kcal, TSS) → `favorites`.

## Local sync pipeline (personal deploy)

One small script (or extension of debrief's launchd job) runs on the Mac:

- reads recent runs from `../debrief`'s `runs.db`
- pulls recent weigh-ins from Garmin Connect (`python-garminconnect`)
- POSTs both to `/api/sync` with a bearer token

The app never talks to Suunto or Garmin directly in v1 — the Mac does, using auth that already exists locally.

## Build order (milestones)

1. **M0 Design** — ✅ complete. Mockup rounds (v1 + v2, all three v2s adopted as themes); tweak list folded into Night Athletic; token schema + pack in `design/tokens.css` + `design/TOKENS.md` (#2); log-flow mockup `sketches/e-log-flow.html` (#3); screenshot-matrix QA tooling `tools/shot-matrix.mjs` (#31)
2. **M1 Scaffold** — Workers project, D1 schema (incl. theme + accent columns), auth, PWA shell, push-to-deploy (Workers Builds at the time; replaced by #136/#137)
3. **M2 Core loop** — text quick-add → confirm sheet → Today screen, built in Night Athletic (proves AI+DB+UI without camera complexity)
4. **M3 Photo & barcode** — camera + R2 + vision; OpenFoodFacts
5. **M4 Budget engine** — TDEE onboarding, weight sync, runs sync, eat-back
6. **M5 Trends & polish** — trends screen, settings (incl. theme switcher + accent picker #29), Field Notes + Instrument theme ports (#30), micro-interactions, install prompt

**All twelve milestones have shipped their work; the board past M5 is not this list.**
As of 2026-08-26 every milestone has 0 open issues — M6 OSS-ready is the one still
marked `open` on GitHub, with nothing left in it. M5 grew to 17 open
issues and a name that stopped being true the day Trends shipped, so on 2026-08-10 it was
split into **M7 Log flow**, **M9 Budget truth**, **M10 Launch & offline** and **M11 Look &
feel**, with **M6 OSS-ready** unchanged. Restating them here would be the same two-sources
defect the build rules had, so it isn't restated — ask GitHub:

```bash
gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title)  open:\(.open_issues)"'
```

The plan above is the *original* build order and is kept as the record of what was decided
up front. [NEXT-STEPS.md](NEXT-STEPS.md)'s last session section is the live runway.

**Someday, unscheduled:** two-way debrief integration. Today the flow is one-way — debrief's
pipeline pushes runs into MyMacros. The interesting direction is back: debrief showing what
was eaten before a run ("you ran this fasted", "you'd had 1,200 kcal"), so pre-run fueling
can be read against performance — a question neither app can answer alone. Deliberately not
an issue and not on a milestone: revisit only once the daily loop is fully working and
there's real data on both sides. The passkey rpID is already scoped to `debrief.run` so a
shared login stays available if this ever happens.
