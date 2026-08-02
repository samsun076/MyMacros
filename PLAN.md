# MyMacros — Plan

**One-liner:** A mobile-first PWA where you photograph (or scan, or describe) your food, AI fills in the macros, and your daily calorie budget breathes with your running.

Built for weight loss, built for one user first (Dave), but shaped so other people can use it later — hosted or self-hosted.

## Locked decisions

| Area | Decision |
|---|---|
| Stack | Vite + React + Hono on **Cloudflare Workers**, D1 (SQLite), R2 (photos), better-auth. Free tier. Repo connected to Workers Builds → push to main = deploy |
| AI | **Claude Sonnet 5** vision + structured outputs (JSON schema) for photo→macros and text→macros. ~1–3¢ per photo |
| API key | v1: `ANTHROPIC_API_KEY` as a Workers secret. OSS path: agent-install directives (Claude Code sets up D1/R2/secrets for the self-hoster) **and** optional per-user key in app settings for hosted multi-user |
| Run data | Sync from **debrief's `runs.db`** — a small addition to the existing launchd pipeline POSTs recent runs (date, distance, kcal, TSS) to MyMacros' API. No new Suunto OAuth in v1 |
| Weight data | **Garmin Connect sync** via unofficial `python-garminconnect` (garth auth) in the same local pipeline — the Garmin Index scale weigh-ins flow in automatically. Manual entry as fallback |
| Budget model | **TDEE (Mifflin-St Jeor) + chosen deficit**, protein-forward macro split. Targets recompute as logged weight drops |
| Eat-back | **Configurable partial** (default 50%) of run calories added to the day's budget, shown transparently ("+320 kcal from your 6mi run") |
| Logging inputs | Photo (meal or label) · **barcode → OpenFoodFacts** (free, exact) · **AI text quick-add** ("chipotle bowl, no rice") · favorites/recents. Every AI entry is editable before saving |
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

1. **Build every screen against Night Athletic first.** It's the primary; polish happens here.
2. **Never hardcode a color/font/radius** — everything through semantic tokens, so the light packs stay portable.
3. **New motif slots need a named variant per theme** before the component is considered done (placeholder variants OK until the M5 port).
4. **Theme QA pass at the end of each milestone** — quick render check of the two light packs; full port + QA lands in M5 (#30).
5. **Accent-aware accents** — anything colored accent must reference `--accent`, since Night Athletic users can switch it live.
6. **375px is the reference width** — Dave's phone is an iPhone 13 mini. No design is done until verified at 375 (then 390/428); screenshot matrix tooling in #31.
7. **Safari chrome blend** — the tab bar's *surface* color (never accent) bleeds through the bottom safe area with no seam, so iOS Safari tints its chrome to match; `theme-color` meta handles the top.

## V1 scope — the daily loop

1. **Today screen** — budget ring (eaten vs adjusted target), macro breakdown, meal timeline with photos, today's run if any.
2. **Log flow** — big "+" → camera / barcode / text. AI returns items with confidence → confirm/tweak → saved. Happy path under ~10 seconds.
3. **Weight** — auto-synced from the Garmin scale; quick manual entry fallback; 7-day smoothed trend feeds target recalc.
4. **Trends** — weekly weight vs intake vs deficit. The "is this working?" view.
5. **Settings** — profile/TDEE inputs, deficit, macro split, eat-back %.

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
2. **M1 Scaffold** — Workers project, D1 schema (incl. theme + accent columns), auth, PWA shell, push-to-deploy
3. **M2 Core loop** — text quick-add → confirm sheet → Today screen, built in Night Athletic (proves AI+DB+UI without camera complexity)
4. **M3 Photo & barcode** — camera + R2 + vision; OpenFoodFacts
5. **M4 Budget engine** — TDEE onboarding, weight sync, runs sync, eat-back
6. **M5 Trends & polish** — trends screen, settings (incl. theme switcher + accent picker #29), Field Notes + Instrument theme ports (#30), micro-interactions, install prompt
7. **M6 OSS-ready (backlog)** — settings BYOK, agent-install directives, direct Suunto OAuth
