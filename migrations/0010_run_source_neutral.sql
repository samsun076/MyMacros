-- `runs.source` had a sibling project's name welded into a CHECK constraint
-- (#37). The column answers "did a machine put this here, or a person?", and
-- it said 'debrief' — which is the maintainer's own upstream pipeline, not a
-- concept this app has. Every self-hosted instance inherited it, and the CHECK
-- meant no other value was even permitted, so a self-hoster feeding
-- /api/sync from anything else got rows labelled with a project they have
-- never heard of.
--
-- 'sync' is the honest name for what the value means. It stays a two-value
-- enum rather than gaining a per-provider vocabulary, because nothing branches
-- on it and `external_id` already carries provenance — contrast
-- `weights.source`, where #66's deletion rule genuinely turns on the value
-- being 'garmin'.
--
-- SQLite cannot ALTER a CHECK, so this is a table rebuild. Done now
-- deliberately, while the table holds 76 rows: rebuilds only get more
-- expensive, and CLAUDE.md's note about doing them early is written about
-- exactly this. Nothing has a foreign key onto `runs`, so the drop is safe.
--
-- No reader anywhere selects `runs.source` — verified by enumeration
-- 2026-08-24 — so this renames a value nothing consumes. `sync.ts` writes it
-- and is updated in the same commit.

CREATE TABLE runs_new (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ran_on      TEXT NOT NULL,                      -- YYYY-MM-DD, user-local
  started_at  TEXT,                               -- ISO-8601 UTC, when known
  distance_m  REAL NOT NULL,
  duration_s  INTEGER,
  kcal        INTEGER NOT NULL,
  tss         REAL,
  -- 'sync' = arrived through POST /api/sync from whatever feed this
  -- deployment has wired up. 'manual' = a person typed it.
  source      TEXT NOT NULL DEFAULT 'sync' CHECK (source IN ('sync', 'manual')),
  -- The upstream workout id, whatever the upstream is. NULLs stay distinct in
  -- SQLite, so manual runs don't collide while synced ones stay idempotent.
  external_id TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO runs_new (id, user_id, ran_on, started_at, distance_m, duration_s, kcal, tss, source, external_id, created_at)
SELECT id, user_id, ran_on, started_at, distance_m, duration_s, kcal, tss,
       CASE source WHEN 'debrief' THEN 'sync' ELSE source END,
       external_id, created_at
FROM runs;

DROP TABLE runs;
ALTER TABLE runs_new RENAME TO runs;

CREATE INDEX runs_user_day_idx ON runs(user_id, ran_on);
CREATE UNIQUE INDEX runs_user_external_idx ON runs(user_id, external_id);
