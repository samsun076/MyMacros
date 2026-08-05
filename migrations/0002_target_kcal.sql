-- M2's static calorie target (settled on #45/#11): the base daily budget
-- lives in a real, editable column. M4's TDEE work (#17) changes how the
-- number is calculated, not where it lives — the meter's BASE marker and the
-- macro targets read it from here either way. The earned run bonus is never
-- stored here; it stays a separate quantity (build rule 7).
ALTER TABLE profiles ADD COLUMN target_kcal INTEGER NOT NULL DEFAULT 1800;
