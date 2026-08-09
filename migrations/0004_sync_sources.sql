-- When each feed last checked in (#69).
--
-- The failure this exists to make visible: a dead sync and a rest day render
-- identically. The Today screen builds its earned bonus from the `runs` rows
-- that exist, so zero rows draws as "you didn't run" — and `refreshTarget`
-- only fires when a weigh-in arrives, so a dead Garmin half leaves the base
-- target frozen with no marker. Both halves fail into states the UI already
-- has a legitimate reason to draw, which is why nothing ever looked wrong.
-- Measured before building this: sixteen consecutive Garmin failures and two
-- Cloudflare 403s, none of which moved a single indicator in the app.
--
-- PER SOURCE, not per token. `sync_tokens.last_used_at` already answers "is
-- this credential in use", but one token carries both feeds — so it goes on
-- stamping success while half the pipeline is dead. That is the exact
-- distinction the outage above lived in: runs kept arriving on the same token
-- whose Garmin half had been failing for a working day.
--
-- Not per token for a second reason: the question a user asks is "are my
-- weigh-ins arriving", which survives re-issuing a credential. Rotating a
-- token would otherwise reset the history and read as a brand-new feed.
CREATE TABLE sync_sources (
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- matches the top-level keys of a /api/sync payload
  source          TEXT NOT NULL CHECK (source IN ('runs', 'weights')),
  -- ISO-8601 UTC. An INSTANT, not a day: this is "when did the collector last
  -- speak to us", which is a clock question, unlike `ran_on`/`measured_on`
  -- which are days in the user's life.
  last_success_at TEXT NOT NULL,
  -- How many items came with that check-in. Zero is a perfectly healthy
  -- answer — a rest week checks in with an empty list — and storing it is what
  -- lets Settings say "checked in 20 minutes ago, nothing new" instead of
  -- leaving silence to mean two different things.
  last_item_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, source)
);
