# Reconciliations

Build rule 4b: when a milestone **changes how a number is computed**, take a
figure the app is showing a real user, pull its inputs out of **production**,
and recompute it by hand. A milestone that changes none still gets a one-line
entry saying so — silence and nothing-to-report must not look identical.

Budget 45–90 minutes, or 25–45 once `npm run reconcile` has cleared the SQL.
This paragraph said "ten minutes" until 2026-08-14; the rule as amended lives
in CLAUDE.md and is the source, and no entry here has ever cost ten minutes.

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

## M9 (#77, #79) — the protein target and the base target, 2026-08-14

**Figure:** Today, Friday 14 August, shows **BASE 1,909 kcal** and macro targets
of **153 g protein · 188 g carbs · 61 g fat**. Protein is the focus macro and
M9 is the milestone that changed how it is computed, so it is the figure this
entry owes.

**Inputs, pulled from production D1** by `npm run reconcile -- --date 2026-08-14
--weeks 2` (the full block is #83's output; the load-bearing rows):

| | |
|---|---|
| sex / birth_date | male / 1980-04-03 → age 46 |
| height_cm / activity | 165.1 / `light` → ×1.375 |
| goal / deficit / eat-back | cut / 250 / 50% |
| protein_g_per_kg / carb_ratio_pct | 2.0 / 58 (`athlete_profile` = `general`) |
| weigh-ins in the 7-day window (08-08…08-14) | 08-09 76.6, 08-10 76.2, 08-12 75.8, 08-13 76.4 — **all `garmin`** |
| runs on 08-14 | none (last run 08-13) → earned 0 |

**By hand:**

```
trend  = (76.6 + 76.2 + 75.8 + 76.4) / 4 = 76.25 → round1 → 76.3 kg
BMR    = 10(76.3) + 6.25(165.1) − 5(46) + 5   = 1569.875
TDEE   = 1569.875 × 1.375                     = 2158.578
base   = 2158.578 − 250                       = 1908.578 → 1,909   ✓

protein   = 2.0 × 76.3                        = 152.6 g → 153 g    ✓
remainder = 1909 − (152.6 × 4)                = 1298.6 kcal
carbs     = 0.58 × 1298.6 / 4                 = 188.3 g → 188 g    ✓
fat       = 0.42 × 1298.6 / 9                 = 60.6 g  → 61 g     ✓
fat floor = 0.6 × 76.3 = 45.8 g — not binding
```

**Arithmetic: exact, all four figures.** Once again the value was in the inputs.

### The one-kcal gap, and why it is worth recording

The first hand pass produced **1,908**, not 1,909 — a mean of 76.25 kg carried
straight into Mifflin-St Jeor gives 1907.89. The gap is `trendWeightKg`
applying `round1` to the *window mean* before anything consumes it, so the
budget is built from 76.3 rather than 76.25.

That is correct and deliberate — the trend weight is one quantity with one
source (#78), and it is rounded once at its source rather than differently by
each caller. But it means **a reconciler working from the printed weigh-ins
cannot reproduce the app exactly without knowing it**, and a 1 kcal miss is
exactly the size that reads as "close enough, must be rounding" and gets
waved through. It is written down here so the next pass spends thirty seconds
on it rather than twenty minutes. Protein, carbs and fat all match under
either weight, so the base target is the only place it shows.

### What the inputs turned up

- **The weigh-in feed is clean, and that is the finding this milestone needed.**
  #77 made body weight enter the protein target directly — before M9 protein was
  a percentage of energy and a bad weigh-in could not touch it. All four
  readings in the current window are `source = garmin`, spread 75.8–76.6 kg
  over five days, no outlier and no manual row. So today's 153 g rests entirely
  on scale readings. This was the thing most likely to be wrong and it is not.

- **One weigh-in nobody can vouch for, and `manual` makes it permanent.**
  2026-08-05's 76.0 is `source = manual`. Asked directly, Dave does not
  remember whether he stood on the scale or typed it. It is outside today's
  7-day window so it costs the reconciled figure nothing — but it is the
  *first* weigh-in on file, so 08-05 through 08-08 have no other weight to
  smooth and four days of the Trends chart rest on it.

  The structural half is worse than the row: **`manual` is unconditional
  protection.** #20 refuses to let sync overwrite a manual row and #71 lets it
  clear tombstones, both on the premise that the word means *a human typed this
  deliberately*. An unremembered manual row is indistinguishable from a
  deliberate one, so if Garmin holds a different reading for 08-05 it can never
  land. Not filed: the fix is a provenance question ("typed when?"), and M8's
  entry already established that the honest move for a soft weigh-in is to
  delete it once identified. Flagged for Dave rather than patched.

- **`athlete_profile` is `general` on someone who ran six times in fourteen
  days** — 47 km, kcal/km 54–60, a tempo run on 08-13 at 8:36/mile. #79 exists
  to ask exactly this question and the answer on file is "a bit of everything".
  It is a preference rather than a fact, so it is not wrong — but it is the
  input most likely to be mis-set, and it is not free: `runner` carries
  `carb_ratio_pct` 65, which on today's numbers is **211 g carbs / 51 g fat
  instead of 188 / 61**. Protein and the base target are unaffected. Dave's
  call, not a defect.

- **`start_weight_kg` = 74.84274104995843 — that is exactly 165.0 lb**, typed at
  onboarding, and it is *below* the current 76.3 trend. Read as progress it says
  a cut has gone 1.5 kg the wrong way. Checked what consumes it: nothing
  user-facing does. Its only reader is Onboarding's form seeding, as the last
  fallback behind `trend_weight_kg` (#78 removed the Settings preview that used
  it). So a stale anchor costs nothing today — worth re-confirming before any
  future screen draws a "since you started" figure off it.

- **No unit trap in the runs.** Six runs, 54.1–60.4 kcal/km, median 57.3 —
  inside the documented 56–63 band and far clear of #63's 35 kcal/km floor.
  `energy_kj` is still holding kilocalories.

- **Both sync feeds healthy at the pull** (`sync_sources`: runs
  2026-08-14T17:42:24Z / 15 items, weights 17:42:25Z / 4 items), well inside
  the 18h staleness threshold. The two-day gap in food logs on 08-13/08-14 is
  behaviour, not a dead feed — 08-13 carries a run and a weigh-in from the same
  window.

- **Height and age corroborated, unchanged since M8.** 165.1 cm still
  back-solves against Garmin's BMI (164.9), and 1980-04-03 gives 46 on
  2026-08-14. Both re-checked because height enters BMR at 6.25× and age at 5×.

**Verdict: arithmetic exact on all four figures; no input defect.** Two
provenance questions for Dave (the 08-05 manual row, the `general` profile),
neither of which moves today's numbers.

### Did the tool save time? — yes, roughly half the exercise

`npm run reconcile` replaced five hand-written `wrangler d1 execute --remote`
calls and their formatting with one command and a paste-ready block; measured
against M5 and M8, that is the ~half of rule 4b that always finished first
because it was the part with a known ending. **The `rows_n` column earned its
place immediately** — 2026-08-06 reads `1 | 77` at a glance, which is #74
visible as a shape rather than as a small number.

What it did not do is the check itself. Every finding above came from reading
the block and asking which row was lying, and the one-kcal gap came from
recomputing by hand and refusing to wave the difference through. The tool
buys the hour back; it does not spend it.

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
