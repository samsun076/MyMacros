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
| Design | **iOS-ish but not Apple cosplay** — native-feeling interactions (bottom tabs, sheets, safe areas) with its own personality. Direction chosen from HTML mockups, not words |

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

1. **M0 Design** — 3–4 throwaway HTML mockup directions → pick → design tokens
2. **M1 Scaffold** — Workers project, D1 schema, auth, PWA shell, push-to-deploy
3. **M2 Core loop** — text quick-add → confirm sheet → Today screen (proves AI+DB+UI without camera complexity)
4. **M3 Photo & barcode** — camera + R2 + vision; OpenFoodFacts
5. **M4 Budget engine** — TDEE onboarding, weight sync, runs sync, eat-back
6. **M5 Trends & polish** — trends screen, settings, micro-interactions, install prompt
7. **M6 OSS-ready (backlog)** — settings BYOK, agent-install directives, direct Suunto OAuth
