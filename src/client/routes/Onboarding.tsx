import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { ActivityLevel, Goal, Me, Sex } from "../../shared/api";
import { computeBudget, macroGrams } from "../../shared/budget";
import { cmToFtIn, ftInToCm, kgToLb, lbToKg } from "../../shared/units";
import { ApiError, api, useApi } from "../lib/api";
import { localDay } from "../lib/day";
import { fmtInt } from "../lib/format";

/** Onboarding (#17): the inputs Mifflin-St Jeor needs, the deficit, and the
 *  macro split — with the resulting budget shown live underneath.
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
    weight_kg: form.weight_kg ?? p?.start_weight_kg ?? null,
    activity_level: form.activity_level ?? p?.activity_level ?? "moderate",
    goal: form.goal ?? p?.goal ?? "cut",
    deficit_kcal: form.deficit_kcal ?? p?.deficit_kcal ?? 500,
    protein_pct: form.protein_pct ?? p?.protein_pct ?? 35,
    carb_pct: form.carb_pct ?? p?.carb_pct ?? 40,
    fat_pct: form.fat_pct ?? p?.fat_pct ?? 25,
  };
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const budget = useMemo(() => computeBudget(v), [
    v.sex,
    v.birth_date,
    v.height_cm,
    v.weight_kg,
    v.activity_level,
    v.goal,
    v.deficit_kcal,
  ]);

  const split = v.protein_pct + v.carb_pct + v.fat_pct;
  const grams = budget ? macroGrams(budget.target_kcal, v) : null;
  const ready = budget !== null && split === 100;

  async function save() {
    if (!ready || !v.weight_kg) return;
    setSaving(true);
    setError(null);
    try {
      // Weight first: the Worker recomputes target_kcal on the profile write,
      // and it can only do that once a weigh-in exists to compute from.
      await api.post("/api/weights", {
        measured_on: localDay(),
        weight_kg: v.weight_kg,
      });
      await api.patch("/api/me/profile", {
        sex: v.sex,
        birth_date: v.birth_date,
        height_cm: v.height_cm,
        start_weight_kg: v.weight_kg,
        activity_level: v.activity_level,
        goal: v.goal,
        deficit_kcal: v.goal === "maintain" ? 0 : v.deficit_kcal,
        protein_pct: v.protein_pct,
        carb_pct: v.carb_pct,
        fat_pct: v.fat_pct,
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

        <Field label="Current weight" hint="The scale's number today. It updates as you log more.">
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
              onClick={() => set({ goal: g.value })}
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

      <section>
        <div className="sec-head">
          <span className="eyebrow">Macro split</span>
          <span className={split === 100 ? "mono" : "mono warn"}>{split}%</span>
        </div>
        {(
          [
            ["protein_pct", "Protein"],
            ["carb_pct", "Carbs"],
            ["fat_pct", "Fat"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <div className="field-pair">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={v[key]}
                onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<Form>)}
              />
              <span className="mono">
                {v[key]}%{grams ? ` · ${gramsFor(key, grams)}g` : ""}
              </span>
            </div>
          </Field>
        ))}
        {split !== 100 && (
          <p className="placeholder-note">The three add up to {split}% — they need to make 100.</p>
        )}
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
  deficit_kcal: number;
  protein_pct: number;
  carb_pct: number;
  fat_pct: number;
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

function gramsFor(key: "protein_pct" | "carb_pct" | "fat_pct", g: ReturnType<typeof macroGrams>) {
  return key === "protein_pct" ? g.protein_g : key === "carb_pct" ? g.carbs_g : g.fat_g;
}

/** 7,700 kcal ≈ 1 kg of fat, the conventional figure. Phrased as "about"
 *  because it is a rule of thumb and the app shouldn't pretend otherwise. */
function rate(deficit: number) {
  const kgPerWeek = (deficit * 7) / 7700;
  const lbPerWeek = kgPerWeek * 2.20462;
  return `${lbPerWeek.toFixed(1)} lb`;
}

function num(s: string): number | null {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) ? n : null;
}
