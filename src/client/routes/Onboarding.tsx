import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { ActivityLevel, AthleteProfile, Goal, Me, Sex } from "../../shared/api";
import {
  ATHLETE_PROFILES,
  PROTEIN_G_PER_KG,
  PROTEIN_G_PER_KG_RANGE,
  computeBudget,
  macroTargets,
} from "../../shared/budget";
import { KCAL_PER_KG } from "../../shared/trends";
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from "../../shared/units";
import { ApiError, api, useApi } from "../lib/api";
import { localDay } from "../lib/day";
import { fmtInt } from "../lib/format";

/** Onboarding (#17): the inputs Mifflin-St Jeor needs, the deficit, the
 *  protein anchor and the carb:fat ratio — with the resulting budget shown
 *  live underneath.
 *
 *  The preview runs the *same* `computeBudget` the Worker runs on save
 *  (src/shared/budget.ts). That is the whole reason the maths is shared: a
 *  second implementation for the preview would drift, and the drift would be
 *  invisible — this screen quietly promising a number the database disagrees
 *  with.
 *
 *  One scrolling form rather than a wizard. Every field is visible at once,
 *  which is what makes the live preview mean anything: you can see the target
 *  move as you change the deficit.
 */

const ACTIVITY: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: "sedentary", label: "Desk-bound", hint: "Sitting most of the day" },
  { value: "light", label: "Light", hint: "On your feet a fair bit" },
  { value: "moderate", label: "Moderate", hint: "Active job, or lots of walking" },
  { value: "active", label: "Active", hint: "Physical work most days" },
  { value: "very_active", label: "Very active", hint: "Hard physical work" },
];

const GOALS: { value: Goal; label: string }[] = [
  { value: "cut", label: "Lose" },
  { value: "maintain", label: "Maintain" },
  { value: "gain", label: "Gain" },
];

/** #79. Two options, and Lifter/CrossFit are *absent* rather than greyed out —
 *  a disabled control still makes the promise, and the app has no exercise
 *  input that isn't a run to keep it with. */
const ATHLETES: { value: AthleteProfile; label: string; hint: string }[] = [
  { value: "runner", label: "Runner", hint: "Running is most of your training" },
  { value: "general", label: "A bit of everything", hint: "No single sport in particular" },
];

export function Onboarding() {
  const { data: me } = useApi<Me>("/api/me");
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // seeded from the profile once it arrives; `?? ` rather than an effect,
  // since a field the user has touched must not be overwritten by a refetch
  const [form, setForm] = useState<Partial<Form>>({});
  const p = me?.profile;
  const imperial = (p?.units ?? "imperial") === "imperial";
  /** Already been through this once — the screen is an editor now, not an
   *  introduction. Read off the profile rather than the form, so it doesn't
   *  flip while someone is typing. */
  const returning = Boolean(p?.sex && p?.birth_date && p?.height_cm);

  const v: Form = {
    sex: form.sex ?? p?.sex ?? null,
    birth_date: form.birth_date ?? p?.birth_date ?? "",
    height_cm: form.height_cm ?? p?.height_cm ?? null,
    /* The trend, not `start_weight_kg` (#78). That column is the weight typed
     * at onboarding and never updated, so previewing from it froze this
     * screen's budget at day one while Today moved with the scale — two
     * screens, two base targets, both arithmetically perfect. `trend_weight_kg`
     * is the same number `refreshTarget` stores from, so they cannot disagree.
     * It is null only before the first weigh-in, which is what the fallback is
     * for. */
    weight_kg: form.weight_kg ?? me?.trend_weight_kg ?? p?.start_weight_kg ?? null,
    activity_level: form.activity_level ?? p?.activity_level ?? "moderate",
    goal: form.goal ?? p?.goal ?? "cut",
    athlete_profile: form.athlete_profile ?? p?.athlete_profile ?? "general",
    deficit_kcal: form.deficit_kcal ?? p?.deficit_kcal ?? 500,
    eat_back_pct: form.eat_back_pct ?? p?.eat_back_pct ?? 50,
    protein_g_per_kg: form.protein_g_per_kg ?? p?.protein_g_per_kg ?? PROTEIN_G_PER_KG.cut,
    /* From the preset, not a literal (#86). This read `?? 62` — the schema
     * default before migration 0008 rebuilt it to 58 — so within a day of the
     * default moving, the third copy of it was already stale. Only visible in
     * the window before /api/me answers, which is precisely why nobody would
     * have caught it. */
    carb_ratio_pct: form.carb_ratio_pct ?? p?.carb_ratio_pct ?? ATHLETE_PROFILES.general.carb_ratio_pct,
  };
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  /** Picking a goal moves the protein default with it (#77) — that is what
   *  makes the presets visible rather than a hidden table, and the number
   *  under the slider updates before anything is saved. It overrides a
   *  hand-moved slider on purpose: the alternative is a screen that shows
   *  "Cut" beside a maintenance protein target and explains neither. */
  const setGoal = (goal: Goal) => set({ goal, protein_g_per_kg: PROTEIN_G_PER_KG[goal] });

  /** The other axis (#79). It moves the two sliders it owns and nothing else —
   *  spreading `ATHLETE_PROFILES[value]` rather than naming fields here is
   *  deliberate, so the complete list of what a profile can change lives in
   *  one place with the warning about `activity_level` beside it.
   *
   *  Visibly, before saving: this project's rule is that any number on screen
   *  can be reconciled by hand from its inputs (build rule 4b), and a preset
   *  that silently adjusted values nobody can trace works against it. The
   *  profile picks a starting point and then gets out of the way. */
  const setAthlete = (athlete_profile: AthleteProfile) =>
    set({ athlete_profile, ...ATHLETE_PROFILES[athlete_profile] });

  const budget = useMemo(() => computeBudget(v), [
    v.sex,
    v.birth_date,
    v.height_cm,
    v.weight_kg,
    v.activity_level,
    v.goal,
    v.deficit_kcal,
  ]);

  /* The base target, not an adjusted one: this screen is answering "what do I
   * eat on a day I don't run". A run's calories reach carbs and fat on Today
   * (#77), and previewing them here would show a number that only applies on
   * days the user hasn't had yet. */
  const grams = budget
    ? macroTargets({
        kcal: budget.target_kcal,
        weight_kg: v.weight_kg,
        protein_g_per_kg: v.protein_g_per_kg,
        carb_ratio_pct: v.carb_ratio_pct,
      })
    : null;
  /* No macro-split gate any more (#77). The three percentages could be saved
   * in a state that meant nothing, so the button waited for them to total
   * 100; protein is anchored to weight and fat is the remainder, so every
   * position of both sliders describes a real day. */
  const ready = budget !== null;

  async function save() {
    if (!ready || !v.weight_kg) return;
    setSaving(true);
    setError(null);
    try {
      /* Only when the user actually supplied a weight (#84).
       *
       * This posted unconditionally, and `v.weight_kg` falls back to a value
       * nobody typed today — so opening this screen to change a deficit wrote
       * a weeks-old weight as today's weigh-in. That row lands as `manual`,
       * which #20 protects from sync overwrite, so it then outranked the real
       * reading from the scale; and it cleared the day's tombstones (#71),
       * which can resurrect a weigh-in someone deliberately deleted.
       *
       * `form.weight_kg` is undefined until the field is touched, so it is
       * already the exact test. The second clause keeps first-run onboarding
       * working, where the typed weight is the only one that exists.
       *
       * Weight first when it is written at all: the Worker recomputes
       * target_kcal on the profile write, and can only do that once a weigh-in
       * exists to compute from. */
      const typedWeight = form.weight_kg !== undefined;
      const firstRun = me?.trend_weight_kg == null;
      if (typedWeight || firstRun) {
        await api.post("/api/weights", {
          measured_on: localDay(),
          weight_kg: v.weight_kg,
        });
      }
      await api.patch("/api/me/profile", {
        sex: v.sex,
        birth_date: v.birth_date,
        height_cm: v.height_cm,
        // Written on first onboarding only. It means *start* weight; rewriting
        // it on every edit makes the name a lie and re-persists whatever stale
        // value this screen was seeded with (#84).
        ...(firstRun ? { start_weight_kg: v.weight_kg } : {}),
        activity_level: v.activity_level,
        goal: v.goal,
        athlete_profile: v.athlete_profile,
        deficit_kcal: v.goal === "maintain" ? 0 : v.deficit_kcal,
        eat_back_pct: v.eat_back_pct,
        protein_g_per_kg: v.protein_g_per_kg,
        carb_ratio_pct: v.carb_ratio_pct,
      });
      void navigate("/");
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "network";
      setError(
        code === "network"
          ? "Couldn't reach the server — try again in a moment."
          : "That didn't save. Check the numbers and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const ft = v.height_cm ? cmToFtIn(v.height_cm) : null;

  return (
    <main className="frame onboard">
      {/* Reachable a second time from Settings, so it can't be a one-way
          street: someone who opens it to change a deficit needs a way out
          that isn't saving. */}
      <header className={returning ? "log-top" : undefined}>
        <span className="eyebrow">
          <span className="tick" />
          {returning ? "Your budget" : "Set up your budget"}
        </span>
        {returning && (
          <button className="cam-x" aria-label="Close" onClick={() => void navigate("/settings")}>
            ✕
          </button>
        )}
      </header>
      {!returning && (
        <>
          <h1>A few numbers</h1>
          <p className="sheet-sub">
            Enough to work out what you burn in a day. All of it is editable later.
          </p>
        </>
      )}

      <section>
        <div className="sec-head">
          <span className="eyebrow">You</span>
        </div>

        <Field label="Sex" hint="Used by the BMR formula — it's a term in the equation.">
          <div className="seg">
            {(["male", "female"] as Sex[]).map((s) => (
              <button
                key={s}
                type="button"
                className={v.sex === s ? "seg-btn on" : "seg-btn"}
                aria-pressed={v.sex === s}
                onClick={() => set({ sex: s })}
              >
                {s === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Date of birth">
          <input
            type="date"
            value={v.birth_date}
            max={localDay()}
            onChange={(e) => set({ birth_date: e.target.value })}
          />
        </Field>

        <Field label="Height">
          {imperial && ft ? (
            <div className="field-pair">
              <input
                type="number"
                inputMode="numeric"
                aria-label="Feet"
                value={ft.ft}
                min={3}
                max={8}
                onChange={(e) => set({ height_cm: ftInToCm(Number(e.target.value), ft.in) })}
              />
              <span className="mono">FT</span>
              <input
                type="number"
                inputMode="numeric"
                aria-label="Inches"
                value={ft.in}
                min={0}
                max={11}
                onChange={(e) => set({ height_cm: ftInToCm(ft.ft, Number(e.target.value)) })}
              />
              <span className="mono">IN</span>
            </div>
          ) : (
            <div className="field-pair">
              <input
                type="number"
                inputMode="decimal"
                aria-label={imperial ? "Height in inches" : "Height in centimetres"}
                value={v.height_cm ?? ""}
                onChange={(e) => set({ height_cm: num(e.target.value) })}
              />
              <span className="mono">{imperial ? "IN" : "CM"}</span>
            </div>
          )}
        </Field>

        {/* The hint has to say which number this is. Returning, it shows the
            7-day trend — the weight the budget actually follows — and typing
            into it logs a weigh-in for today, which is the only thing that
            writes to `weights` from this screen (#84). Calling that "the
            scale's number today" is what made #78 easy to miss. */}
        <Field
          label="Current weight"
          hint={
            returning
              ? "Your 7-day trend — the weight your budget follows. Type here only to log today's weigh-in."
              : "The scale's number today. It updates as you log more."
          }
        >
          <div className="field-pair">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              aria-label={imperial ? "Weight in pounds" : "Weight in kilograms"}
              value={
                v.weight_kg === null
                  ? ""
                  : imperial
                    ? Math.round(kgToLb(v.weight_kg) * 10) / 10
                    : v.weight_kg
              }
              onChange={(e) => {
                const n = num(e.target.value);
                set({ weight_kg: n === null ? null : imperial ? lbToKg(n) : n });
              }}
            />
            <span className="mono">{imperial ? "LB" : "KG"}</span>
          </div>
        </Field>
      </section>

      <section>
        <div className="sec-head">
          <span className="eyebrow">Daily life</span>
        </div>
        {/* The copy that stops the app double-counting: run calories are added
            separately as the earned bonus (#21), so this multiplier must
            describe everything EXCEPT training. See ACTIVITY_FACTORS. */}
        <p className="sheet-sub">
          Not counting workouts — your runs are added on top, on the days you do them.
        </p>
        <div className="opts">
          {ACTIVITY.map((a) => (
            <button
              key={a.value}
              type="button"
              className={v.activity_level === a.value ? "opt on" : "opt"}
              aria-pressed={v.activity_level === a.value}
              onClick={() => set({ activity_level: a.value })}
            >
              <span className="opt-name">{a.label}</span>
              <span className="opt-hint">{a.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <div className="sec-head">
          <span className="eyebrow">Goal</span>
        </div>
        <div className="seg">
          {GOALS.map((g) => (
            <button
              key={g.value}
              type="button"
              className={v.goal === g.value ? "seg-btn on" : "seg-btn"}
              aria-pressed={v.goal === g.value}
              onClick={() => setGoal(g.value)}
            >
              {g.label}
            </button>
          ))}
        </div>

        {v.goal !== "maintain" && (
          <Field
            label={v.goal === "cut" ? "Daily deficit" : "Daily surplus"}
            hint={`${fmtInt(v.deficit_kcal)} kcal a day is about ${rate(v.deficit_kcal)} a week.`}
          >
            <div className="field-pair">
              <input
                type="range"
                min={0}
                max={1000}
                step={50}
                value={v.deficit_kcal}
                onChange={(e) => set({ deficit_kcal: Number(e.target.value) })}
              />
              <span className="mono">{fmtInt(v.deficit_kcal)}</span>
            </div>
          </Field>
        )}
      </section>

      {/* #79. The second axis, and it sits directly above the two controls it
          sets so that picking one visibly moves them. Deliberately NOT beside
          "Daily life": that question is about everything *except* training,
          and answering it from an athlete profile would double-count every
          run (#21, and the measured 274 kcal/day in RECONCILIATIONS.md). */}
      <section>
        <div className="sec-head">
          <span className="eyebrow">Your training</span>
        </div>
        <p className="sheet-sub">
          Sets your starting carbs, fat and eat-back — all three stay adjustable below.
        </p>
        <div className="opts">
          {ATHLETES.map((a) => (
            <button
              key={a.value}
              type="button"
              className={v.athlete_profile === a.value ? "opt on" : "opt"}
              aria-pressed={v.athlete_profile === a.value}
              onClick={() => setAthlete(a.value)}
            >
              <span className="opt-name">{a.label}</span>
              <span className="opt-hint">{a.hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* #21. Lives beside the goal because it is the other half of the same
          question: how big is the deficit, and how much of a run gives back. */}
      <section>
        <div className="sec-head">
          <span className="eyebrow">Eat-back</span>
          <span className="mono">{v.eat_back_pct}%</span>
        </div>
        <p className="sheet-sub">
          How much of a run's calories get added to that day's budget.
        </p>
        <div className="field">
          <div className="field-pair">
            <input
              type="range"
              min={0}
              max={100}
              step={10}
              aria-label="Eat-back percentage"
              value={v.eat_back_pct}
              onChange={(e) => set({ eat_back_pct: Number(e.target.value) })}
            />
            <span className="mono">{v.eat_back_pct}%</span>
          </div>
          <span className="opt-hint">
            {v.eat_back_pct === 0
              ? "Runs won't change your budget at all."
              : v.eat_back_pct === 100
                ? "All of it. A watch's calorie estimate tends to run high, so this can quietly cancel your deficit."
                : `A 500 kcal run would add ${Math.round((500 * v.eat_back_pct) / 100)} kcal that day. Half is the usual hedge against watches over-reporting.`}
          </span>
        </div>
      </section>

      {/* #77. Protein is anchored to body weight, so it is the same number on
          a run day and a rest day; carbs and fat divide whatever energy is
          left, including a run's earned bonus. The goal buttons above set the
          protein default — moving the slider is an override, not a
          requirement. */}
      <section>
        <div className="sec-head">
          <span className="eyebrow">Protein</span>
          <span className="mono">{v.protein_g_per_kg.toFixed(1)} G/KG</span>
        </div>
        <p className="sheet-sub">
          Set by your body weight, not by your calories — a run doesn't change it.
        </p>
        <div className="field">
          <div className="field-pair">
            <input
              type="range"
              min={PROTEIN_G_PER_KG_RANGE.min}
              max={PROTEIN_G_PER_KG_RANGE.max}
              step={PROTEIN_G_PER_KG_RANGE.step}
              aria-label="Protein, grams per kilogram of body weight"
              value={v.protein_g_per_kg}
              onChange={(e) => set({ protein_g_per_kg: Number(e.target.value) })}
            />
            <span className="mono">{grams ? `${grams.protein_g}g` : "—"}</span>
          </div>
          <span className="opt-hint">
            {v.goal === "cut"
              ? "Cutting: more protein holds on to the muscle you already have."
              : v.goal === "gain"
                ? "Gaining: protein is the material, but past about 2.0 it starts crowding out the carbs that fuel training."
                : "Maintaining: nothing under threat and nothing being added, so this sits lower."}
          </span>
        </div>
      </section>

      <section>
        <div className="sec-head">
          <span className="eyebrow">Carbs & fat</span>
          <span className="mono">
            {v.carb_ratio_pct} : {100 - v.carb_ratio_pct}
          </span>
        </div>
        <p className="sheet-sub">How the energy left after protein is divided.</p>
        <div className="field">
          <div className="field-pair">
            <input
              type="range"
              min={30}
              max={80}
              /* step 1, not 2: Runner's 65 is not on an even step, so the
                 browser snapped the thumb to 66 while the state (and every
                 number on the screen) said 65 — and the next drag would have
                 started from the wrong place. Found by driving the picker and
                 reading the input's own value, which is not something a
                 screenshot can show. */
              step={1}
              aria-label="Share of the remaining energy from carbohydrate"
              value={v.carb_ratio_pct}
              onChange={(e) => set({ carb_ratio_pct: Number(e.target.value) })}
            />
            <span className="mono">{grams ? `${grams.carbs_g}C · ${grams.fat_g}F` : "—"}</span>
          </div>
          {/* A clamp the user can't see is its own kind of wrong answer —
              the same reason `budget.floored` says so below. */}
          {grams?.fat_floored && (
            <span className="opt-hint">
              Fat is being held at a sensible floor for your weight, so carbs take the rest. Ease
              the deficit or the protein to move it.
            </span>
          )}
        </div>
      </section>

      {/* The live preview. Same function the Worker will run on save. */}
      <section className="preview" aria-live="polite">
        <div className="sec-head">
          <span className="eyebrow">Your budget</span>
        </div>
        {budget ? (
          <>
            <div className="hero-row">
              <span className="hero-num">{fmtInt(budget.target_kcal)}</span>
              <span className="hero-of">kcal a day</span>
            </div>
            <dl className="kv">
              <div>
                <dt>Resting burn</dt>
                <dd>{fmtInt(budget.bmr)} kcal</dd>
              </div>
              <div>
                <dt>With daily activity</dt>
                <dd>{fmtInt(budget.tdee)} kcal</dd>
              </div>
              {v.goal !== "maintain" && (
                <div>
                  <dt>{v.goal === "cut" ? "Less deficit" : "Plus surplus"}</dt>
                  <dd>
                    {v.goal === "cut" ? "−" : "+"}
                    {fmtInt(v.deficit_kcal)} kcal
                  </dd>
                </div>
              )}
            </dl>
            {budget.floored && (
              <p className="placeholder-note" role="alert">
                That deficit would put you below a sensible floor, so the target is held at{" "}
                {fmtInt(budget.target_kcal)}. Ease the deficit to move it.
              </p>
            )}
          </>
        ) : (
          <p className="placeholder-note">
            Fill in the fields above and your daily target appears here.
          </p>
        )}
      </section>

      <button className="btn btn-accent" disabled={!ready || saving} onClick={() => void save()}>
        {saving ? "Saving…" : returning ? "Save changes" : "Start logging"}
      </button>
      {error && (
        <p className="signin-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

type Form = {
  sex: Sex | null;
  birth_date: string;
  height_cm: number | null;
  weight_kg: number | null;
  activity_level: ActivityLevel;
  goal: Goal;
  athlete_profile: AthleteProfile;
  deficit_kcal: number;
  eat_back_pct: number;
  protein_g_per_kg: number;
  carb_ratio_pct: number;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <span className="eyebrow">{label}</span>
      {children}
      {hint && <span className="opt-hint">{hint}</span>}
    </div>
  );
}

/** 7,700 kcal ≈ 1 kg of fat, the conventional figure. Phrased as "about"
 *  because it is a rule of thumb and the app shouldn't pretend otherwise.
 *
 *  `KCAL_PER_KG` and `kgToLb` rather than the two literals that were here
 *  (#86): Trends turns a deficit into a predicted rate with the same two
 *  constants, so a second copy means this screen's "about 1.0 lb a week" and
 *  the Trends screen's modelled rate can disagree about the same arithmetic. */
function rate(deficit: number) {
  const kgPerWeek = (deficit * 7) / KCAL_PER_KG;
  return `${kgToLb(kgPerWeek).toFixed(1)} lb`;
}

function num(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}
