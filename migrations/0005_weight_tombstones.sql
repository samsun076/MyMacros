-- Days whose scale reading the user has rejected (#71).
--
-- Without this, deleting a weigh-in in the app doesn't stick: the Garmin sync
-- re-sends a rolling 30-day window every 30 minutes, the day is gone so the
-- upsert takes its INSERT branch, and the reading walks back in. Measured
-- before building: 0 rows after the delete, 1 row after the next sync.
--
-- #20 can't cover it. That fix guards a row whose stored source is 'manual'
-- from being overwritten — but a deleted row isn't manual, it's absent, and
-- there is nothing left for the WHERE to protect.
--
-- #66 is the opposite direction: that removes rows Garmin has STOPPED
-- reporting. This is a row Garmin still reports and the user rejected.
--
-- THE VALUE IS PART OF THE KEY, and that is what makes expiry unnecessary.
-- A tombstone says "not this reading for this day", not "never anything for
-- this day". So the case that matters still works: the scale reads you holding
-- a dumbbell, you delete it, you weigh again properly, and the corrected
-- number is a different value — so it is not tombstoned and it arrives
-- normally. A day-only tombstone would lock you out of your own re-weigh, and
-- a time-based expiry would quietly let the rejected reading back.
CREATE TABLE weight_tombstones (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  measured_on TEXT NOT NULL,                     -- YYYY-MM-DD, user-local
  -- the exact rejected reading, already rounded to 0.1 by both writers, so
  -- comparison is on the same rounded value the table stores
  weight_kg   REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, measured_on, weight_kg)
);

CREATE INDEX weight_tombstones_user_day_idx ON weight_tombstones(user_id, measured_on);
