-- The second onboarding axis (#79).
--
-- Onboarding asked a novice "what percent of your calories should be
-- carbohydrate?", three times, and made the answers sum to 100. Nobody
-- arrives knowing that, so whatever they landed on was arbitrary — and it
-- then drove every macro number the app showed them. "Do you mostly run?"
-- has an obvious answer. This REPLACES that question rather than adding one;
-- if onboarding still asked for percentages afterwards, it would have failed.
--
-- Two axes, one owner each: `goal` sets protein g/kg and the sign of the
-- deficit (#77); `athlete_profile` sets the carb:fat ratio of the remaining
-- energy and the eat-back default. Protein deliberately stays on the goal
-- axis alone — endurance athletes sit slightly below lifters at maintenance,
-- the two converge in a deficit, and the residue is smaller than #77's own
-- noise floor (~10 g here). Two axes moving one number makes it untraceable
-- for a difference that doesn't matter.
--
-- WHAT THIS MUST NEVER TOUCH: `activity_level`. ACTIVITY_FACTORS describes
-- daily life EXCLUDING purposeful exercise, because run calories arrive
-- separately as the earned bonus (#21). A profile that helpfully raised the
-- activity level would double-count every session while looking like a
-- thoughtful feature. Measured in RECONCILIATIONS.md, not hypothetical: 15
-- runs in the 30 days audited, and pushing `light` to `moderate` would have
-- made the target 274 kcal/day too generous, every day, with nothing visibly
-- broken. `deficit_kcal` is out too — how fast you want to get there is a
-- preference, not an athletic characteristic.
--
-- TWO VALUES ONLY, and the CHECK says so. Lifter and CrossFit are decided
-- (50:50 at 25% eat-back, 60:40 at 40%) and still held back, because the app
-- has no exercise input that isn't a run: someone picking "Lifter" would get
-- sensible macros and an app that never records a session, with an eat-back
-- slider governing a permanent zero. Admitting the value here before the app
-- can serve it is the same promise-it-can't-keep the picker refuses to make,
-- one layer down. Adding them is a table rebuild — that is the price of the
-- guarantee, and #27 or #70 is where it gets paid.
ALTER TABLE profiles ADD COLUMN athlete_profile TEXT NOT NULL DEFAULT 'general'
  CHECK (athlete_profile IN ('runner', 'general'));

-- One default, not two. `carb_ratio_pct` arrived in 0007 defaulting to 62 —
-- the pre-#77 schema split of 40:25 re-expressed — while General, the profile
-- a new user starts on, is 58:42. Both answer "what carb:fat does someone who
-- has chosen nothing get", and leaving them disagreeing is precisely the
-- duplicated-source fault #86 exists to hunt. SQLite cannot alter a default in
-- place, so the column is rebuilt around its own values; the dance is ugly and
-- the alternative is a number with two homes.
--
-- Existing rows keep whatever they had: 0007 preserved each user's own
-- carb:fat preference and this must not undo that.
ALTER TABLE profiles ADD COLUMN carb_ratio_tmp INTEGER;
UPDATE profiles SET carb_ratio_tmp = carb_ratio_pct;
ALTER TABLE profiles DROP COLUMN carb_ratio_pct;
ALTER TABLE profiles ADD COLUMN carb_ratio_pct INTEGER NOT NULL DEFAULT 58
  CHECK (carb_ratio_pct BETWEEN 0 AND 100);
UPDATE profiles SET carb_ratio_pct = carb_ratio_tmp;
ALTER TABLE profiles DROP COLUMN carb_ratio_tmp;
