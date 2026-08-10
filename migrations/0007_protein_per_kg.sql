-- Protein stops being a percent of energy (#77).
--
-- `protein_pct` made the protein target a function of how much you eat and
-- how far you ran. Measured on real data: a 5.0 mi run earned 219 kcal, 40%
-- of which went to protein, so the target jumped 191 g → 213 g on a run day.
-- Protein does not scale with the energy cost of a run — it scales with lean
-- mass. A run empties glycogen, so it raises the CARBOHYDRATE requirement.
--
-- It also quietly broke build rule 7: the kcal meter draws base and earned
-- separately, while the macro rows merged them into one number with no seam.
-- And `earnedKcal` is already a hedge (50% of a watch estimate, because
-- watches over-report), so the app was applying an estimate of an estimate to
-- a physiological requirement.
--
-- The new model, in one line: protein is anchored to body weight, and carbs
-- and fat absorb everything else including the earned bonus.
--
--   protein_g = protein_g_per_kg × trend_weight_kg      ← run or no run
--   remainder = adjusted_kcal − protein_g × 4
--   carbs : fat = carb_ratio_pct : (100 − carb_ratio_pct) of the remainder
--
-- ONE COLUMN FOR THE RATIO, NOT TWO. Fat is the remainder of the remainder,
-- so the three-legged "must total 100" invariant that routes/me.ts used to
-- enforce cannot be violated any more — it is structurally impossible rather
-- than checked. That is why the old check goes with the old columns.

-- Goal presets, g per kg. A U, NOT A LADDER, and the two ends are elevated
-- for different reasons: a cut defends existing tissue against catabolism, a
-- gain supplies material for new tissue, and maintain does neither. An
-- earlier draft put gain in the middle and was wrong (#77 records that so it
-- isn't re-derived). The gain preset stops at 2.0 because past that, protein
-- displaces the carbohydrate that fuels the training driving the growth —
-- a claim about displacement, not about protein mattering less.
--
-- DEFAULT 2.0 is coupled to `goal`'s own DEFAULT 'cut' above, the same way
-- `target_kcal`'s default was coupled to M2's. A profile row is created with
-- column defaults only (`loadProfile`), so the pair has to agree.
ALTER TABLE profiles ADD COLUMN protein_g_per_kg REAL NOT NULL DEFAULT 2.0;

-- Carbohydrate's share of the energy left after protein. 58 is the default
-- 40:25 carb:fat preference re-expressed against the remainder.
ALTER TABLE profiles ADD COLUMN carb_ratio_pct INTEGER NOT NULL DEFAULT 62
  CHECK (carb_ratio_pct BETWEEN 0 AND 100);

UPDATE profiles SET protein_g_per_kg =
  CASE goal WHEN 'maintain' THEN 1.6 ELSE 2.0 END;

-- EACH USER'S OWN CARB:FAT PREFERENCE IS PRESERVED, not replaced by a house
-- default — `carb_pct:fat_pct` already encoded it, and only protein's basis
-- is changing here. 35:25 becomes 58; the schema default 40:25 becomes 62.
-- The guard is for a profile that somehow put 100% into protein, where the
-- ratio is undefined and the column default is the only answer available.
UPDATE profiles SET carb_ratio_pct =
  CAST(ROUND(carb_pct * 100.0 / (carb_pct + fat_pct)) AS INTEGER)
  WHERE carb_pct + fat_pct > 0;

-- Dropped rather than left behind as a derived-but-stored remnant (#77's
-- 2026-08-10 comment). A column some code reads while other code recomputes
-- it is exactly the fault that produced #78, #85 and the build-rule drift,
-- all in one day, and #86 exists to hunt it. Migrations being append-only
-- makes leaving it *cheaper*, not *right*.
ALTER TABLE profiles DROP COLUMN protein_pct;
ALTER TABLE profiles DROP COLUMN carb_pct;
ALTER TABLE profiles DROP COLUMN fat_pct;
