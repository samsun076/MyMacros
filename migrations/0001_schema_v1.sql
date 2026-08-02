-- MyMacros schema v1 (issue #5)
--
-- Two halves with deliberately different conventions:
--
--   * Auth tables (users, sessions, accounts, verifications, passkeys) are
--     OWNED BY better-auth. camelCase columns, because the library generates
--     and queries them by those names. Never hand-edit to taste — the shape
--     below was read out of better-auth 1.6.25's own schema metadata. On
--     SQLite its adapter stores dates as ISO-8601 text and booleans as 0/1.
--
--   * App tables are snake_case, carry user_id, and cascade on user delete.
--
-- Date discipline: instants are ISO-8601 UTC text; a "day in the user's life"
-- (logged_on / measured_on / ran_on) is YYYY-MM-DD local to that user, so a
-- day's totals don't shift when they travel. Canonical units are SI (kg, cm,
-- metres); pounds and miles are a display concern (profiles.units).

-- ─────────────────────────────────────────────────────────────
-- auth — better-auth owns these
-- ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image         TEXT,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);

CREATE TABLE sessions (
  id        TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token     TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_idx ON sessions(userId);

CREATE TABLE accounts (
  id                    TEXT PRIMARY KEY,
  accountId             TEXT NOT NULL,
  providerId            TEXT NOT NULL,
  userId                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  TEXT,
  refreshTokenExpiresAt TEXT,
  scope                 TEXT,
  -- present because better-auth's schema defines it; unused — no passwords
  -- in this app, ever (PLAN.md).
  password              TEXT,
  createdAt             TEXT NOT NULL,
  updatedAt             TEXT NOT NULL
);
CREATE INDEX accounts_user_idx ON accounts(userId);

CREATE TABLE verifications (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);
CREATE INDEX verifications_identifier_idx ON verifications(identifier);

CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  publicKey    TEXT NOT NULL,
  -- better-auth's own schema leaves this without a delete rule; cascade is
  -- the only sane answer for credentials belonging to a deleted account.
  userId       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- indexed, NOT unique: matches the library's schema exactly so a
  -- re-registration can never fail on a constraint it doesn't expect.
  credentialID TEXT NOT NULL,
  counter      INTEGER NOT NULL,
  deviceType   TEXT NOT NULL,
  backedUp     INTEGER NOT NULL,
  transports   TEXT,
  createdAt    TEXT,
  aaguid       TEXT
);
CREATE INDEX passkeys_user_idx ON passkeys(userId);
CREATE INDEX passkeys_credential_idx ON passkeys(credentialID);

-- ─────────────────────────────────────────────────────────────
-- app
-- ─────────────────────────────────────────────────────────────

-- One row per user: everything the budget engine needs, plus presentation.
-- Current weight is NOT stored here — it's the latest `weights` row, so there
-- is exactly one source of truth for a number that changes daily.
CREATE TABLE profiles (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Mifflin-St Jeor inputs. Nullable until onboarding (#17) fills them in.
  sex            TEXT CHECK (sex IN ('male', 'female')),
  birth_date     TEXT,
  height_cm      REAL,
  activity_level TEXT NOT NULL DEFAULT 'moderate'
                   CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),

  -- goal
  goal           TEXT NOT NULL DEFAULT 'cut' CHECK (goal IN ('cut', 'maintain', 'gain')),
  deficit_kcal   INTEGER NOT NULL DEFAULT 500,
  start_weight_kg REAL,
  goal_weight_kg  REAL,

  -- eat-back: the configurable share of run calories added to the day (PLAN.md)
  eat_back_pct   INTEGER NOT NULL DEFAULT 50 CHECK (eat_back_pct BETWEEN 0 AND 100),

  -- macro split as percent of kcal; the app keeps the three at 100
  protein_pct    INTEGER NOT NULL DEFAULT 35,
  carb_pct       INTEGER NOT NULL DEFAULT 40,
  fat_pct        INTEGER NOT NULL DEFAULT 25,
  -- the macro that gets --accent on its bar; others render --mark-neutral
  focus_macro    TEXT NOT NULL DEFAULT 'protein' CHECK (focus_macro IN ('protein', 'carbs', 'fat')),

  -- presentation (per-user, live-switchable — PLAN.md Theming)
  units          TEXT NOT NULL DEFAULT 'imperial' CHECK (units IN ('imperial', 'metric')),
  theme          TEXT NOT NULL DEFAULT 'night-athletic'
                   CHECK (theme IN ('night-athletic', 'field-notes', 'instrument')),
  accent         TEXT NOT NULL DEFAULT 'coral' CHECK (accent IN ('coral', 'gold', 'mint')),
  timezone       TEXT NOT NULL DEFAULT 'America/New_York',

  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE food_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  logged_on  TEXT NOT NULL,                       -- YYYY-MM-DD, user-local
  logged_at  TEXT NOT NULL,                       -- ISO-8601 UTC instant
  meal_slot  TEXT NOT NULL CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  name       TEXT NOT NULL,
  kcal       INTEGER NOT NULL,
  protein_g  REAL NOT NULL DEFAULT 0,
  carbs_g    REAL NOT NULL DEFAULT 0,
  fat_g      REAL NOT NULL DEFAULT 0,
  source     TEXT NOT NULL CHECK (source IN ('photo', 'barcode', 'text', 'favorite')),
  photo_key  TEXT,                                -- R2 object key (M3)
  barcode    TEXT,
  confidence REAL,                                -- AI 0..1; null for barcode/favorite
  -- true when the user changed the AI's numbers before saving. Keeping this
  -- is what makes "how good are the estimates?" answerable later.
  edited     INTEGER NOT NULL DEFAULT 0,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- the Today screen's only query shape
CREATE INDEX food_logs_user_day_idx ON food_logs(user_id, logged_on);

CREATE TABLE weights (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_on  TEXT NOT NULL,                     -- YYYY-MM-DD, user-local
  weight_kg    REAL NOT NULL,
  body_fat_pct REAL,                              -- the Garmin Index reports it
  source       TEXT NOT NULL CHECK (source IN ('garmin', 'manual')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- one weigh-in per day: makes the 7-day smoothing well-defined and lets the
-- Garmin sync re-POST the same day forever without creating duplicates
CREATE UNIQUE INDEX weights_user_day_idx ON weights(user_id, measured_on);

CREATE TABLE runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ran_on      TEXT NOT NULL,                      -- YYYY-MM-DD, user-local
  started_at  TEXT,                               -- ISO-8601 UTC, when known
  distance_m  REAL NOT NULL,
  duration_s  INTEGER,
  kcal        INTEGER NOT NULL,
  tss         REAL,
  source      TEXT NOT NULL DEFAULT 'debrief' CHECK (source IN ('debrief', 'manual')),
  -- debrief/Suunto workout id. NULLs stay distinct in SQLite, so manual runs
  -- don't collide while synced ones stay idempotent.
  external_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX runs_user_day_idx ON runs(user_id, ran_on);
CREATE UNIQUE INDEX runs_user_external_idx ON runs(user_id, external_id);

CREATE TABLE favorites (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kcal         INTEGER NOT NULL,
  protein_g    REAL NOT NULL DEFAULT 0,
  carbs_g      REAL NOT NULL DEFAULT 0,
  fat_g        REAL NOT NULL DEFAULT 0,
  photo_key    TEXT,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- "one-tap re-log" (#12) reads most-used first
CREATE INDEX favorites_user_use_idx ON favorites(user_id, use_count DESC);
