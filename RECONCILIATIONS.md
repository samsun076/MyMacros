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

## M7 (#58, #104, #107, #109, #60, #81, #59) — a meal's macros after a portion change, 2026-08-21

**Why an entry is owed.** #58 changed how a meal's macros are *derived*: they are
no longer whatever the reader returned, they are the reader's figures rescaled
linearly from a pristine `base` by a portion the user chose. #104 gave that
portion columns, #107 stopped the barcode path discarding its grams, and #109
fixed the ceiling that clamped 200 g to 100. Five issues, one arithmetic path,
and it writes to every row a person eats. Not a skip.

**Figure:** Today, Friday 21 August, shows **2,549 kcal eaten** and
**139.4 P · 269.4 C · 107.7 F**, over eight rows — one of which is the only row
in the entire production table whose macros came out of a portion rescale.

**Inputs, pulled read-only from production D1 the same evening.** 87 `food_logs`
rows, of which 7 carry a portion and 48 carry `ai_*` macros. Profile: male,
b. 1980-04-03, 165.1 cm, light, cut, deficit 250, `protein_g_per_kg` 2,
`carb_ratio_pct` 65, runner, tz America/New_York. Both sync sources healthy
(runs and weights, last success 2026-08-21T21:09Z, 15 and 10 items) — no #62
repeat.

The eight rows of 21 August:

| name | source | kcal | P | C | F | portion | ai_portion |
|---|---|---|---|---|---|---|---|
| Barebells PROTEIN BAR PEANUT B… | barcode | 200 | 20 | 21 | 6 | — | — |
| Mini pancakes with blueberry… | photo | 260 | 6 | 38 | 9 | 4 mini pancakes | 4 |
| Scrambled eggs with hot sauce | photo | 220 | 14 | 2 | 16 | 1 cup | 1 |
| Sausage patty | photo | 110 | 6 | 1 | 9 | 1 patty | 1 |
| Watermelon chunks | photo | 45 | 1 | 11 | 0 | 0.5 cup | 0.5 |
| **Barebells CHOCOLATE DOUGH** | **barcode** | **564** | **56.4** | **56.4** | **19.7** | **155 g** | **55** |
| Pineapple pizza | text | 720 | 28 | 88 | 28 | 4 slices | 4 |
| Grande Hot Mocha (White Mocha… | favorite | 430 | 8 | 52 | 20 | — | — |

**Recomputed by hand, importing nothing:**

```
kcal    200+260+220+110+45+564+720+430 = 2549   app: 2549
protein 20+6+14+6+1+56.4+28+8          = 139.4  app: 139.4
carbs   21+38+2+1+11+56.4+88+52        = 269.4  app: 269.4
fat     6+9+16+9+0+19.7+28+20          = 107.7  app: 107.7
```

And the one row #58's path actually produced, checked against its own base:

```
564 kcal / 155 g = 3.63871 kcal/g
at the reader's 55 g: 200.13 kcal · 20.01 P · 20.01 C · 6.99 F
```

Those are round pack numbers — 200 / 20 / 20 / 7 for a 55 g bar. The rescale is
linear from a pristine base and lands exactly where it should. **Not one figure
off, including the arithmetic this milestone changed.**

### What it found, which is not in the arithmetic

**A question about an input, and it is the only thing here that matters.** That
Barebells row says 155 g of a bar whose pack serving is 55 g — 2.82 bars, 564
kcal, 22% of the day, on a day that came out 643 kcal over a 1,906 target. The
same day's *other* Barebells row is the control: one bar, 200 kcal, portion not
recorded. Nothing in the code is wrong and every column is internally
consistent; the question is whether 155 is what was eaten or a 1 in front of a
55. **Only Dave can answer it**, and that is exactly the class rule 4b exists
for — plausible-looking rather than visibly broken, invisible to every test and
every screenshot, reachable only by reading real rows.

It is also #60's argument restated by the data: as of the start of this session
there was no way to open that meal in the app and look. There is now.

**A latent inconsistency in what the `ai_*` columns mean, worth writing down
before something reads them.** The macro pair and the portion pair are
denominated differently, and each is correct for its own question. `ai_kcal` is
stated **at the saved portion** — `setPortionQty` and `setGrams` deliberately
move `orig` with the scaled values so that a portion change does not read as an
override — so the row correctly answers "did the user override the numbers?"
with *no*. `ai_portion_qty` is stated **at the read portion** (`base`, never
`orig` — #107 made that explicit), so it correctly answers "what did the reader
count?" with *55*. Joined naively as one reading, they claim the reader said 55 g
was 564 kcal, which it never said.

Nothing reads them that way today; the only consumer is `Today.tsx`'s undo,
which round-trips them faithfully. **#75's per-source estimate-quality analysis
is the reader that would get this wrong**, by a factor of 2.82 on the barcode
path. Recorded here rather than filed, because the columns are not defective —
what is missing is the sentence saying they are not a pair.

**`edited = 1` on a row with a zero macro delta, and it is not a defect.**
2026-08-11's "Mushrooms with sesame seeds" has all four macros equal to the
reader's and `edited = 1`. `isEdited()` includes `item.name`, and there is no
`ai_name` column — so a name-only correction is indistinguishable from a
spurious flag by reading the row. A limit on what the column can answer, not a
bug in it.

**A coverage fact that surprised me and is the strongest thing here.** #58's
*per-item* portion rescale — the control this milestone was built around — **has
never run in production.** All six non-barcode portion rows have
`portion_qty == ai_portion_qty`, meaning the reader's count was accepted
unchanged every single time. The only rescale in 87 rows used the barcode grams
path (#15/#107), which predates #58. So the headline computation of M7 is, on
real data, exercised by tests and by nobody's thumb. That is CLAUDE.md's "a
bound that has never been reached has never been tested" one level up: not an
unreached limit but an unused feature, and the same warning applies — the first
time it runs for real is the first time anything checks it.

### The two issues that landed after the figures were taken

#81 and #59 closed the milestone a few hours after this recomputation, and both
touch a derivation, so they are named in the heading rather than left out.
**Neither changes anything checked above**, and saying why is the point:

- **#81 makes `savedGrams` per capture rather than per save.** That is a real
  change to which number reaches `portion_qty` — but only on a path that did
  not exist until that commit, a basket holding more than one barcode scan.
  Production has no such row, and cannot have one before this deploys. The
  single-capture save is byte-identical to what produced the Barebells row
  above.
- **#59 resets `orig` on a re-read**, so a corrected read stores the *second*
  answer's numbers in the `ai_*` columns and leaves `edited` at 0. This is the
  first thing that writes those columns from anything but the original read,
  and it sharpens the denomination gap recorded above rather than closing it:
  after a correction, `ai_kcal` is what the reader said the *second* time.
  Nothing in production has been corrected, because nothing could be.

Both are therefore owed a figure at the *next* reconciliation, once real rows
exist. Recording that now is the honest version of "not applicable yet" — the
alternative is a future entry that silently starts covering them.

### Answered 2026-08-23 — it was not an input defect, and that is a real result

Dave, asked directly: *"that was me messing with macros and never reverted
back."* The 155 g was deliberate experimentation on a live row, left in place.

**So the reconciliation found no defect, and the check still did its job.** It
took a figure the app was showing a real person, pulled the inputs out of
production, recomputed them by hand, and surfaced the one row that could not be
explained from the data alone — then a person explained it in nine words. That
is the rule working exactly as written: rule 4b cannot tell a wrong input from a
deliberate one, and it is not supposed to. It is supposed to *find the row
nobody can account for* and hand it to somebody who can.

**Two things follow.**

The row is still wrong, and it is still in the history. 2026-08-21 reads 643
kcal over a 1,906 target and ~364 of that is a bar nobody ate. Trends averages
over `counted_days`, so it is quietly in the mean until it is corrected — which
**#60 now makes possible in the app**, on the very day it shipped. Recorded
rather than corrected here: production is read-only from this file, and a
reconciliation that edits its own inputs is not one.

And the practice is worth naming: **test data written into production by hand
is indistinguishable from a wrong reading**, which is precisely why this took a
person to settle. Anything typed into the live app to see what happens should be
undone the same minute, or it becomes an input the next reconciliation has to
chase.

**Verdict:** arithmetic clean, four totals reconciled exactly, the one real
rescale in production recomputes to round pack numbers. No input defect found in
the code's assumptions. One input question for Dave (the 155 g), one
documentation gap recorded (the `ai_*` denomination), and one uncomfortable
coverage fact (the per-item path is unused). Time spent: roughly 40 minutes,
most of it on the last three paragraphs, which produced no output until they did.

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
  delete it once identified.

  **Resolved 2026-08-14: leave it.** Dave's call, having been shown the
  exposure — four days of Trends smoothing and a row sync can never correct.
  76.0 sits plausibly between nothing and the 76.6 four days later, and unlike
  M8's 74.8 there is no evidence it is wrong, only no evidence it is right.
  Recorded so the next pass does not re-raise it as an open question.

- **`athlete_profile` is `general` on someone who ran six times in fourteen
  days** — 47 km, kcal/km 54–60, a tempo run on 08-13 at 8:36/mile. #79 exists
  to ask exactly this question and the answer on file is "a bit of everything".
  It is a preference rather than a fact, so it is not wrong — but it is the
  input most likely to be mis-set, and it is not free: `runner` carries
  `carb_ratio_pct` 65, which on today's numbers is **211 g carbs / 51 g fat
  instead of 188 / 61**. Protein and the base target are unaffected. Dave's
  call, not a defect.

  **Resolved 2026-08-14: switched to `runner`.** Verified in production —
  `athlete_profile` = `runner`, `carb_ratio_pct` = 65, written 18:04:35Z. Today's
  carb and fat targets are 211 / 51 from that moment; the figures reconciled
  above are the pre-switch ones and the recomputation stands, the inputs moved
  after it. **This is the entry's one finding**, and it is worth naming as one
  even though nothing was broken: the app was faithfully computing the right
  answer to a question the user had answered wrong. No test can reach that. It
  is the same failure class as `energy_kj` and the Garmin grams, in its mildest
  form — a correct program over an input nobody had re-read since it was set.

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

**Verdict: arithmetic exact on all four figures; no input *defect*.** But the
pass was not empty — it raised two provenance questions and both were answered
the same day: the 08-05 manual row stays, and `athlete_profile` moved to
`runner`, which changed the carb and fat targets by 23 g and 10 g. So the
honest summary is **"the code is right and one input was stale"**, which is
this rule's usual result arriving in its mildest form rather than its absence.

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

---

## M6 (#126, #129, #127, #26, #130, #37) — the base target, and the one input only Dave can confirm, 2026-08-24

**Trigger.** M6 is mostly auth, docs and guards, none of which computes anything.
One change qualifies: #37 replaced Onboarding's height and weight fields, and
those two numbers are direct inputs to Mifflin-St Jeor. A milestone that changes
how a computed number is *entered* owes the same check as one that changes how it
is calculated — the register's whole argument is that an input defect looks
exactly like correct code.

**Inputs, pulled from production D1 2026-08-24, read-only.**

```
profiles   sex=male  birth_date=1980-04-03  height_cm=165.1
           activity_level=light  goal=cut  deficit_kcal=250  units=imperial
weights    7-day window ending 2026-08-23, all source=garmin
           76.6  75.5  76.5  75.8  76.4  76.2  76.6
```

**Recomputed by hand, without importing `computeBudget`.**

```
trend weight   mean 76.2286 → 76.2   (round to 1dp before anything consumes it)
age            46            (born 1980-04-03, on 2026-08-24)
BMR            10(76.2) + 6.25(165.1) − 5(46) + 5   = 1568.9
TDEE           1568.9 × 1.375  (light)               = 2157.2
target         2157.2 − 250                          = 1907.2 → 1907
```

**App shows 1,907. Hand figure 1,907. Exact — no rounding gap this time**, which
is worth saying because M9's came out one short and the gap was real information
about `trendWeightKg` rounding before its consumers see it.

### The arithmetic is clean and one input is not confirmed

`height_cm = 165.1` is **exactly 65 inches**, so it was entered through the ft/in
pair as 5 ft 5 in rather than typed as centimetres. That is a plausible value and
it is not obviously wrong. It is also the single input this milestone's field
rewrite was about, produced by a field that had a real coercion bug — clearing
either half wrote `0` into it — and nobody has ever checked the stored number
against the person.

The sensitivity is not small:

```
5'5"  (stored)   BMR 1568.9   TDEE 2157.2   target 1907
5'10"            BMR 1648.2   TDEE 2266.3   target 2016    (+109 kcal/day)
6'0"             BMR 1680.1   TDEE 2310.2   target 2060    (+153 kcal/day)
```

**Asked, not assumed.** This is #74's shape and the 155 g bar's shape: a figure
the app is confident about, that only the person can falsify. Asked rather than
waved through, because "probably fine" is the answer that made the 155 g bar
take three weeks to look at.

**Answered 2026-08-24: 5'5" is correct.** So `height_cm = 165.1` is a real
measurement of a real person, the coercion bug never corrupted it, and the
1,907 the app has been showing is right in both its arithmetic and its inputs.

**That is a result, not a blank**, and it is falsifiable in the way M9's clean
pass was: this milestone rewrote the field that produces this exact number, so
"the stored height is the person's height" is the specific claim the pass
existed to test. It could have come back the other way and cost 109 kcal a day
for four months without anything else in the system noticing — no test, no
screenshot and no type could have told the difference between 5'5" and 5'10".

### What did not need reconciling

- **#126, #129, #127** — auth, a health comparison, a deploy preflight. No arithmetic.
- **#26, #130** — documentation.
- **Migration 0010** — renames a value nothing reads.
- **`localeDefaults`** — sets `timezone` and `units` on **new** profiles only. `units`
  is a display conversion; `timezone` decides which day a row belongs to, which is a
  real computation input, but no existing row moved and the only profile in production
  was created long before this and still reads `America/New_York`.
- **`PROFILE_LIMITS`** — new clamps on height and weight. They bound typos far outside
  any real body (50–260 cm, 20–400 kg) and the stored values sit well inside, so
  nothing was rewritten by their arrival. Verified rather than assumed: 165.1 and 76.2.

**Time:** ~35 minutes, most of it step 4. Verdict: **clean — arithmetic exact,
every input confirmed.** Third clean pass in the file (M9, and now this),
against three that found defects.

## M11 (#23, #29, #30, #80) — no computed figure, not applicable, 2026-08-14

**Nothing to reconcile, and that is a result rather than a gap.** M11 changed
how the app *looks*: an editable Settings screen, a theme and accent picker,
the two light packs, and the Today timeline's order. No milestone work changed
how any number is computed. The trigger for rule 4b is a computation, not a
calendar, and a forced entry here would be theatre — the same argument M10 and
the service-worker work were exempted under.

The two places it was worth checking rather than assuming, because both touch
screens that *display* computed numbers:

- **#23 added a writer, not a computation.** Settings edits goal weight, focus
  macro and units. None is an input to `computeBudget` or `macroTargets`: the
  goal weight draws the Trends goal line and nothing else reads it, the focus
  macro decides which bar wears `--accent` (build rule 8), and units are a
  display conversion. The budget inputs are still edited only by `/onboarding`,
  deliberately — see the commit.
- **#30 and #80 never touch a value.** Token packs, motif variants and render
  order. `timelineView` reorders and computes a header span; it does no
  arithmetic on anything a user eats.

The one thing M11 *did* do to the register (CLAUDE.md, "one quantity, one
source") is remove a hazard rather than add one: Onboarding's six `?? <literal>`
fallbacks restating column DEFAULTs now come from `PROFILE_DEFAULTS`, pinned
against a freshly inserted row by a table-driven route test. That was the trap
the #86 sweep named as the one that keeps producing these defects, and it is
closed on the surface that was about to copy it.

**Verdict:** no computed figure — not applicable. Next entry is due whenever a
milestone next changes an arithmetic path; nothing in M11 did.
