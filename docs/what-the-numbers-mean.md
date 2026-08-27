# What the numbers mean

MyMacros makes a handful of decisions on your behalf and then shows you the result.
This page is the reasoning behind each one, in the order you meet them.

You do not need any of it to use the app. You need it the first time a number surprises
you.

---

## The big number on Today

The top of the screen looks like this:

```
1,240 / 2,150   kcal eaten
├──────────────── BASE 1,810 ▸ ─────┼───────┤
                                    +340 kcal earned · 6.2 mi run
```

**Two separate things, never added into one.**

- **The base target** is what you eat on a day you do not run. It comes from your height,
  weight, age, sex and activity level, minus the deficit you chose.
- **The earned bonus** is what a run added *today*. It is calculated fresh each day and
  never stored.

The meter draws them as a bar plus a marked extension, not as one length. That is a
deliberate rule, and the reason is that a single merged number hides which half moved.
If you ate 2,100 against a 2,150 budget, it matters enormously whether the budget was
2,150 because you are maintaining or because you ran six miles. One number cannot tell
you that. Two can.

**Nothing you do to the earned bonus changes the base.** Take a rest day and the base is
exactly what it was.

### Before you have weighed in

If the app does not yet know your height, weight and age, Today shows a card that says
*Budget not set up* and the number below it is a placeholder — the deployment's default,
not a figure computed for you. The card is there so the number cannot be mistaken for
one.

---

## Why a run only gives you back some of it

If you run 700 kcal, the app adds roughly half of it to that day's budget. The default
eat-back is **50%**.

**This is a hedge, not a measurement.** A watch's calorie estimate is itself an estimate,
and it tends to run high. Eating back 100% of an over-reported burn is the standard way a
deficit quietly turns into maintenance. Half is the conventional discount.

You can change it in Settings. 0% means runs never move your budget; 100% means you eat
all of it back.

### The part that confuses people

On the **Trends** screen, the weekly deficit uses the **full** run calories — not the
half you were allowed to eat.

That is not a bug and the two figures are supposed to disagree.

- Your **budget** is a plan. It uses the discounted number because you are hedging against
  the watch.
- Your **deficit** is a description of what your body did. Your body does not know about
  your hedge. It burned what it burned.

Applying the eat-back discount to the deficit would apply the hedge twice and understate
every week by half a run. There is a test in the codebase whose only job is to fail if
someone ever "fixes" this into agreement.

---

## The macro bars, and why one is a different colour

Under the budget you get three bars: protein, carbs, fat. One of them is drawn in your
accent colour and the other two are grey.

The coloured one is your **focus macro** — the one you are actually aiming at. By default
that is protein. You can change it in Settings. It is a display decision only; it does not
change any target.

Screen readers announce the focused bar with the suffix *"— focus macro"*.

### How the targets are set

**Protein comes first, and it is anchored to your body weight rather than to your
calories.** On a cut the target is **2.0 g** per kg of body weight. Carbs and fat divide
whatever energy is left over, using the carb ratio from your training profile, with a
floor under fat so it cannot be squeezed to nothing.

The consequence worth knowing: **your protein target is the same on a ten-mile day as on a
rest day.** A run does not make you need more protein — it makes you need more fuel. So
the earned bonus moves carbs and fat only.

Why 2.0 g/kg on a cut but 1.6 on maintenance? In a deficit more protein is burned for
fuel, so you need more of it just to *keep* the muscle you have. Maintenance is not
defending against anything, so it needs less. Gaining is back up at 2.0, because new
tissue has to be built out of something.

Energy per gram is the standard 4 / 4 / 9 — protein 4 kcal, carbs 4 kcal, fat 9 kcal.

---

## Your weight, and why it ignores this morning's scale

The number your budget follows is a **7-day average**, not today's reading.

Day-to-day body weight moves several pounds on water, salt, and what is currently inside
you. Budgeting against the raw latest number makes your daily target jump by hundreds of
calories for reasons that have nothing to do with fat.

So the app takes the mean of every weigh-in in the last 7 days. One bad morning can move
it by at most a seventh of the way.

On the Weight screen each row shows both: the raw reading you stepped on, and the trend
it produced.

### Typing a weight beats the scale, permanently, for that day

If your scale reports something wrong — you were holding a dumbbell, someone else stepped
on it — deleting the row is not enough on its own. The sync re-sends a rolling window
every half hour, finds no row for that day, and puts it straight back. Measured: gone
after the delete, back within thirty minutes.

So deleting a scale reading records a small permanent note saying *not this reading for
this day*.

**It is the reading that is blocked, not the day.** Delete a bogus 82.4 kg, step back on
properly at 76.6 kg, and the correct number arrives normally — it is a different value, so
nothing is blocking it.

And **typing a weight for a day clears every block on that day.** That is the escape
hatch: typing a number is unambiguous, and it always wins.

### Trends needs real history before it will say anything

The rate-of-change figures need at least **14** logged days and a span of at least 14 days
before they appear. A week of data cannot distinguish fat loss from a salty dinner.

Predicted weight change uses **7,700 kcal per kg** — the conventional energy content of
body tissue. It is an approximation and the app shows it beside your *observed* rate
rather than instead of it, because the two disagreeing is information.

A week only counts toward those averages if you logged at least **60%** of that day's
budget. A day where you logged one apple is not a data point about your intake, and
averaging it in drags every figure down.

---

## When the app got a food wrong

Two different things can be wrong, and they are corrected in different places.

**The numbers are wrong.** Edit them on the confirm sheet or in the edit sheet. The app
records that its estimate needed correcting, and keeps what it originally said alongside
what you saved — so "the model agreed with you" and "we never checked" cannot look the
same later.

**The reading is wrong.** The photo came back *ham and cheese* and there was no ham. No
amount of editing the macros fixes that, so there is a separate correction where you say
what it actually was and it reads the photo again.

### Changing the portion is not a correction

If you say "that was four slices, not two", the numbers beside it all move — but you have
not corrected anything. The app worked out what it was.

So when you save, it recomputes what the portion change *should* have produced and
compares. If the new numbers are exactly what the new portion explains, nothing is
recorded as an override. If part of the change is unexplained, that part is you correcting
it, and it counts.

Renaming a food always counts as a correction, whatever happened to the amount.

---

## What arrives on its own, and what silence means

Runs and weigh-ins are pushed in by a script on a computer. You do not do anything.

The problem this creates: **a rest day and a dead sync look identical.** Zero runs draws as
"you didn't run" either way. Before this was fixed, sixteen consecutive sync failures moved
nothing at all in the app.

So each feed checks in even when it has nothing to report — *"I speak for runs, and there
are none"* is a different statement from silence.

If a feed has not checked in for **18 hours**, Today says so quietly under the budget:
*Runs last synced yesterday*. Settings → Sources shows both feeds with their last check-in.

Why 18 hours and not less: a laptop shut at 11pm does not sync until it wakes, and you open
the app at breakfast. A nine-hour gap is a healthy system. Anything under about twelve hours
would cry wolf every single morning, and a warning that is usually wrong teaches you to
ignore the one time it is right.

**A feed that has never checked in at all is not stale, it is not set up.** The app says
nothing about it.

---

## Which day a meal lands on

Your phone decides. A meal is filed under the phone's own local date, with a **midnight**
cutoff — an 11pm meal counts against that day, not the next one. There is no 3am
"still last night" grace period.

Settings shows your timezone and does not let you change it. That is deliberate rather
than unfinished: every time you save a meal, the app updates the timezone from the device
you saved it on. A picker would be silently reverted by your next meal, which is worse
than not having one.

It is detected from where your connection enters the network when your account is created,
because that happens before there is any app open to ask.

---

## The short version

| The app says | What it means |
|---|---|
| Two-part budget meter | Base target and today's earned run bonus, never merged |
| `+340 kcal earned` | Half your run, by default — a hedge against watches over-reporting |
| A coloured macro bar | Your focus macro. Protein by default |
| Trend weight | A 7-day mean, because daily weight is mostly water |
| `Runs last synced yesterday` | A feed has been quiet for over 18 hours |
| Timezone, greyed out | Follows the phone you last logged a meal on |

---

*Every number on this page is checked against the code by `tools/docs.test.mjs`. If one
of them ever disagrees with the constant it describes, the build fails. That is the only
reason it is safe to write them down here at all — a document that quotes a threshold is
a second copy of it, and second copies rot.*
