-- Machine credentials for /api/sync (#19).
--
-- The sync endpoint is called by a script on Dave's Mac, not by a browser, so
-- it can't carry a session. The token here resolves to a `user_id` and the
-- route then puts the same `c.var.user` on the context that `requireAuth`
-- would — so "every route reads the user from the context, never from the
-- request" is extended to the machine caller rather than weakened for it.
--
-- Per-user rather than one deployment-wide secret (settled with Dave
-- 2026-08-07). A shared secret has no user attached, so the Worker would need
-- a second setting to know whose rows to write, and that bakes "there is
-- exactly one user" into the schema — the thing #37 exists to prevent.
--
-- Only the HASH is stored. A token is shown once, at creation, and is
-- unrecoverable afterwards; a database dump therefore yields nothing that can
-- be replayed against the API.
--
-- SHA-256 rather than bcrypt/argon2 deliberately: those exist to make
-- *guessable* secrets expensive to brute-force. This secret is 32 bytes from
-- crypto.getRandomValues, so there is no dictionary to run and no work factor
-- worth paying on every sync.
CREATE TABLE sync_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- lowercase hex SHA-256 of the token. UNIQUE so a presented token is one
  -- indexed lookup, and so the same token can never map to two users.
  token_hash   TEXT NOT NULL UNIQUE,
  -- what the user called it, e.g. "Dave's Mac" — so revoking is a choice
  -- between named things rather than between opaque ids
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- stamped on each successful sync: the cheapest way to answer "is the
  -- launchd job still running?" and "is this token still in use?" before
  -- revoking it
  last_used_at TEXT
);

CREATE INDEX sync_tokens_user_idx ON sync_tokens(user_id);
