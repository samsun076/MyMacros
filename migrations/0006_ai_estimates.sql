-- What the reader said, beside what the user saved (#76).
--
-- `food_logs.edited` already records THAT the estimate was corrected. It
-- cannot record BY HOW MUCH or IN WHICH DIRECTION, and those are the two
-- facts that would change how the app is used. The M3 device check is the
-- concrete case: a real plate came back as "fish sticks" that were actually
-- tofu, and the macros were judged plausible anyway. Confidently wrong about
-- *what*, roughly right about *how much* — a boolean cannot tell those apart.
--
-- THIS IS THE ONLY THING ON THE BOARD THAT CANNOT BE BACKFILLED. The reader's
-- numbers exist solely in the confirm sheet's memory, for the seconds between
-- the analyze response and the save; nothing else has ever persisted them.
-- Every row logged before this migration can never answer the question, so
-- the cost of waiting is measured in rows, not in effort.
--
-- Nullable, and NULL means "not recorded" rather than "the model was right":
--   * rows written before this migration — nothing was captured;
--   * a `favorite` re-log — no read happened, the numbers came from a row;
--   * #16's blank recovery row — the read failed, so it produced no numbers.
-- An unedited save writes these EQUAL to the saved values, never null. "The
-- model agreed" and "we didn't record it" must not look the same, which is
-- exactly the ambiguity a null-on-unedited scheme would create.
--
-- Written for all three reads (photo, text, barcode), not just the AI ones.
-- A barcode's figures are an exact database match rather than an estimate —
-- but they are still what the reader proposed before the user touched it, and
-- `source` is on the row, so the estimate-quality question filters to
-- ('photo','text') while "how often is an exact match corrected" stays
-- answerable. The analysis is #75's; this issue only makes it possible.
ALTER TABLE food_logs ADD COLUMN ai_kcal      INTEGER;
ALTER TABLE food_logs ADD COLUMN ai_protein_g REAL;
ALTER TABLE food_logs ADD COLUMN ai_carbs_g   REAL;
ALTER TABLE food_logs ADD COLUMN ai_fat_g     REAL;
