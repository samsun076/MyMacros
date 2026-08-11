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

`npm run reconcile -- --date <YYYY-MM-DD> --weeks <n>` prints the input block
below the fold of each entry — profile, weigh-ins with their `source`, per-day
intake with its row count, runs, and sync health, straight out of production.
It prints **inputs only** (#83), and that is load-bearing rather than a
limitation: the recomputation stops being independent the moment the answer is
sitting above it.

---

## M5 (#22) — the trends screen's realized deficit, 2026-08-10

**Figure:** the week of 2026-08-03 would draw **−1,263 kcal/day**, labelled
**6/7 DAYS**.

**Inputs, pulled from production D1** (`wrangler d1 execute --remote`):

| | |
|---|---|
| sex / birth_date | male / 1980-04-03 → age 46 |
| height_cm / activity | 165.1 / `light` → ×1.375 |
| goal / deficit / eat-back | cut / 250 / 50% |
| weigh-ins, all of them | 08-05 76.0 (manual), 08-09 76.6, 08-10 76.2 |
| logged days, 08-03…08-09 | 742, 652, **77**, 1780, 1040, 1405 |
| runs in the week | 08-03 586 kcal, 08-05 494 kcal |

**By hand** (BMR = 10w + 6.25(165.1) − 5(46) + 5 = 10w + 806.875):

```
08-04  trend window 07-29…08-04 empty, and no weigh-in before it → no target,
       so the day carries intake but contributes no deficit
08-05  trend 76.0  BMR 1566.875  TDEE ×1.375 = 2154  +494 run −652  = 1996
08-06  trend 76.0                TDEE          2154  +  0     − 77  = 2077
08-07  trend 76.0                TDEE          2154  +  0   −1780  =  374
08-08  trend 76.0                TDEE          2154  +  0   −1040  = 1114
08-09  trend (76.0+76.6)/2=76.3  TDEE          2159  +  0   −1405  =  754

intake = 5696 / 6 logged days                                       =  949
target = (1904×4 + 1909) / 5 days with a target                     = 1905
earned = 247 / 6                                                    =   41
deficit = 6315 / 5                                                  = 1263  ✓
```

All five match `buildTrends` exactly. **Arithmetic: exact. The value was in the
inputs, again.**

### What the inputs turned up

- **Both honesty gates fired correctly, on real data.** 7 logged days against a
  floor of 14, and a 6-day weigh-in span against a floor of 14 — so production
  shows no window rate and no window deficit today. The screen this milestone
  ships is, for its own author, mostly a set of withheld numbers. That is the
  design working, and worth stating out loud before anyone reads the blank
  panels as a bug.

- **A seventh input bug, and it is the one this screen introduces.**
  −1,263 kcal/day is not a real deficit. It is what you get when 2026-08-06 is
  logged as **77 kcal** — one entry, a whole day. `logged_days` counts days
  with *at least one row*, so a day with a single coffee in it is worth exactly
  as much as a day logged in full, and the "6/7 DAYS" label beside the figure
  reads as good coverage. Coverage is measured in **days, not completeness.**
  Four of the six days in this week are plausibly partial (742, 652, 77, 1040
  against a 1,905 target).

  This is squarely the failure class rule 4b exists for: arithmetically
  perfect, superficially well-labelled, and off by roughly a factor of two in
  the direction that flatters the user. Filed as **#74** rather than patched
  here — the obvious fix (ignore days under some kcal floor) is a guess about
  whether someone fasted, and guessing wrong in the other direction is worse.

- **`run_kcal` is a total over every day of the week; the means are over
  logged days only.** 1,080 kcal of running against a mean earned of 41/day —
  they look inconsistent and aren't. 08-03's 586-kcal run fell on an unlogged
  day, so it counts in the week's total and cannot count in a per-day mean
  whose denominator is the logged days. Checked because the two figures sit in
  the same row.

- **Both sync feeds healthy at the time of the pull** (`sync_sources`: runs
  14:44:37Z / 14 items, weights 14:44:38Z / 2 items), so the sparse weigh-in
  history is a scale that isn't being stood on, not #62 again.

**Verdict:** the arithmetic is exact and the gates work. One new input defect,
inherent to this screen rather than inherited — see #74.

### Follow-up, same day: #74 fixed, and the fix was wrong twice first

A day now has to reach **60% of its own base target** to be averaged, and
**today is never counted** (incomplete by definition — this morning's 270 kcal
was being read as a full day and reported the current week at −1,889/day).

Same production inputs, re-run:

| | before | after |
|---|---|---|
| week of 08-03, counted days | 6 | **2** |
| week of 08-03, deficit | −1,263/day | **−564/day** |
| window counted days | 7 | 2 |

Recomputed by hand against the two surviving days — 08-07 (2,154 − 1,780 = 374)
and 08-09 (2,159 − 1,405 = 754), mean **564** — and matched.

**Two errors caught by re-running production data through the new rule, not by
the tests that were written for it:**

1. **"No target to judge against" was treated as a pass.** 2026-08-04 is logged
   (742 kcal) but sits before the first weigh-in, so it has no trend weight and
   therefore no target. Counting it averaged it into the intake while the
   deficit — which needs a TDEE — excluded it. **The week's means ran over
   different denominators**, which is precisely the error the code comment two
   functions above warns about. A day without a target is now not counted, so
   `counted` is the single denominator for intake, target, earned and deficit
   alike.
2. **The threshold quietly moved the 14-day floor.** It now applies to counted
   days rather than logged ones, which is stricter and right — a fortnight of
   coffees was never a fortnight of evidence — but it broke a test fixture whose
   14-day run ended *on* today. That failure was correct and worth keeping: the
   fixture, not the rule, was wrong.

The reconciliation exercise found the original defect *and* both defects in its
fix. Neither was visible in a unit test, and both were obvious the moment real
inputs went through.

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
