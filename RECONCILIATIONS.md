# Reconciliations

Build rule 4b: at the end of each milestone, take a figure the app is showing a
real user, pull its inputs out of **production**, and recompute it by hand. Ten
minutes.

Tests prove the arithmetic and screenshots prove the layout. Neither can tell
you an *input* is wrong, and that is the failure this project keeps producing —
plausible-looking rather than visibly broken. Six in M4 alone, four of them
found only by running against real data.

One entry per milestone. Recompute independently; importing `computeBudget` to
check `computeBudget` proves nothing.

---

## M8 — daily target, 2026-08-09

**Figure:** `target_kcal` = 1900, as shown on Today.

**Inputs, pulled from production D1:**

| | |
|---|---|
| sex / birth_date | male / 1980-04-03 → age 46 |
| height_cm | 165.1 |
| activity_level | `light` → ×1.375 |
| goal / deficit_kcal | cut / 250 |
| weigh-ins in the 7-day window (08-03…08-09) | 74.8 (manual), 76.6 (garmin) |

**By hand:**

```
trend  = (74.8 + 76.6) / 2            = 75.7 kg
BMR    = 10(75.7) + 6.25(165.1) − 5(46) + 5 = 1563.875
TDEE   = 1563.875 × 1.375             = 2150.328
target = 2150.328 − 250               = 1900.33 → 1900   ✓ matches
```

**Arithmetic: exact.** The value of this exercise was in the inputs.

### What the inputs turned up

- **`height_cm` corroborated by an outside source.** Garmin's
  `get_body_composition` returns a `totalAverage.bmi` of 28.0 at 76.169 kg,
  which back-solves to 164.9 cm against our stored 165.1. Worth doing because
  height enters BMR at 6.25×, so a data-entry slip of 10 cm is ~86 kcal/day
  forever and looks like nothing.

- **`activity_level` was the expensive one, and it is set correctly.**
  `ACTIVITY_FACTORS` describes life *excluding* purposeful exercise, because
  run calories arrive separately as the earned bonus (#21). Dave ran 15 times
  in the 30 days audited; had that pushed the setting to `moderate`, the target
  would be 2174 — **274 kcal/day too generous, every day, with nothing visibly
  broken.** This is the double-count `budget.ts` warns about at length, checked
  against a real training load rather than assumed.

- **One soft input, worth less than it looked.** The 74.8 on 08-07 was a
  guess Dave typed, not a weigh-in. Removing it moves the target to 1913 —
  **13 kcal/day.** Predicted by hand before deleting, then observed in
  production after: 1900 → 1913. Negligible for the budget; not negligible for
  the trend line, where a fabricated 0.9 kg dip persists for the seven days its
  smoothing window covers, i.e. a loss the chart shows that never happened.
  Deleted 2026-08-09.

- **Eat-back spot-check.** 2026-08-05: 8865 m in 3287 s, 494 kcal → 247 earned
  at 50%. 55.7 kcal/km, mid-range for this runner, well clear of #63's floor
  and #64's flag.

**Verdict:** no seventh input bug. The one wrong input was known and cost 13
kcal/day.
