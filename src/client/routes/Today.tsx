import { useMemo } from "react";
import { Link, useLocation } from "react-router";
import type { DayResponse, FoodLog, MealSlot, Me } from "../../shared/api";
import { useApi } from "../lib/api";
import { localDay } from "../lib/day";
import { fmtInt } from "../lib/format";
import { activeMotifs } from "../motifs";
import type { BudgetData } from "../motifs/types";

/** The Today screen (#11), ported literally from the frozen sketches
 *  (c2-night-athletic.html; the saved stage of e-log-flow.html).
 *
 *  Sketch-anchored specifics: the hero denominator is the ADJUSTED target
 *  (base + earned, arithmetic spelled out in the meter's aria-label); the
 *  earned meter layer renders at zero width in M2 rather than being omitted;
 *  BASE is labelled on the scale; macro targets derive from the adjusted
 *  total via the split percentages; the focus macro carries accent + a
 *  screen-reader "— focus macro" suffix. The weight strip and run card wait
 *  for their data sources (M4 — #18/#19). */

type LoggedToast = { slot: MealSlot; kcal: number; ms: number; edited: number };

type Entry = {
  when: string;
  slot: MealSlot;
  desc: string;
  kcal: number;
  p: number;
  c: number;
  f: number;
  /** R2 key when the meal was photographed (#13) — the thumb shows the food
   *  itself instead of the slot glyph. */
  photoKey: string | null;
};

export function Today() {
  const today = localDay();
  const { data: day } = useApi<DayResponse>(`/api/day/${today}`);
  const { data: me } = useApi<Me>("/api/me");
  const location = useLocation();
  const logged =
    (location.state as { logged?: LoggedToast } | null)?.logged ??
    // DEV-only: /#saved shows the toast for shot-matrix, mirroring the
    // sketch's hash stages. Compiled out of production builds.
    (import.meta.env.DEV && window.location.hash === "#saved"
      ? { slot: "lunch" as MealSlot, kcal: 545, ms: 8400, edited: 1 }
      : null);
  const { BudgetMeter, EarnedNote, TimelineRow } = activeMotifs();

  const budget: BudgetData = {
    eaten: day?.totals.kcal ?? 0,
    base: day?.target_kcal ?? 0,
    earned: 0, // M2: no runs yet — #19/#21 fill day.run and this becomes real
    earnedLabel: null,
  };
  const adjusted = budget.base + budget.earned;
  const remaining = adjusted - budget.eaten;

  // one save = one meal: rows sharing a logged_at instant fold into one entry
  const entries = useMemo(() => {
    const groups = new Map<string, FoodLog[]>();
    for (const log of day?.logs ?? []) {
      const key = `${log.logged_at}|${log.meal_slot}`;
      const group = groups.get(key);
      if (group) group.push(log);
      else groups.set(key, [log]);
    }
    return [...groups.values()].map((rows): Entry => {
      const first = rows[0]!;
      return {
        when: clock12(first.logged_at),
        slot: first.meal_slot,
        desc: rows.map((r, i) => (i === 0 ? r.name : r.name.toLowerCase())).join(", "),
        kcal: rows.reduce((s, r) => s + r.kcal, 0),
        p: Math.round(rows.reduce((s, r) => s + r.protein_g, 0)),
        c: Math.round(rows.reduce((s, r) => s + r.carbs_g, 0)),
        f: Math.round(rows.reduce((s, r) => s + r.fat_g, 0)),
        photoKey: rows.find((r) => r.photo_key)?.photo_key ?? null,
      };
    });
  }, [day]);

  // macro targets derive from the ADJUSTED total (sketch: 82 / 165 g)
  const macros = me
    ? ([
        ["protein", "Protein", day?.totals.protein_g ?? 0, gramsFor(adjusted, me.profile.protein_pct, 4)],
        ["carbs", "Carbs", day?.totals.carbs_g ?? 0, gramsFor(adjusted, me.profile.carb_pct, 4)],
        ["fat", "Fat", day?.totals.fat_g ?? 0, gramsFor(adjusted, me.profile.fat_pct, 9)],
      ] as const)
    : [];

  const now = new Date();
  const dateLine = {
    weekday: now.toLocaleDateString("en-US", { weekday: "long" }),
    date: now.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
  };

  return (
    <>
      <header>
        <div className="masthead">
          <span className="eyebrow">
            <span className="tick" />
            Today
          </span>
          <span className="mono">{me ? me.profile.goal.toUpperCase() : ""}</span>
        </div>
        <h1>
          {dateLine.weekday}, <span>{dateLine.date}</span>
        </h1>
      </header>

      {/* Until the engine has its inputs, `target_kcal` is the deployment's
          default rather than a number computed for this person (#17). Say so
          instead of drawing a made-up budget as though it were real — a
          plausible wrong number is the failure mode this milestone is most
          able to produce. */}
      {day && !day.onboarded && (
        <div className="setup-call">
          <span className="eyebrow">
            <span className="tick" />
            Budget not set up
          </span>
          <p className="opt-hint">
            The target below is a placeholder until we know your height, weight and age.
            It takes about a minute.
          </p>
          <Link className="btn btn-accent" to="/onboarding">
            Set up my budget
          </Link>
        </div>
      )}

      {logged && (
        <div className="toast" role="status">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9.5l4 4 8-9" />
          </svg>
          {slotLabel(logged.slot)} logged — {fmtInt(logged.kcal)} kcal
          <span className="mono">
            {(logged.ms / 1000).toFixed(1)}S{logged.edited > 0 ? ` · EDITED ×${logged.edited}` : ""}
          </span>
        </div>
      )}

      {day && (
        <section className="budget">
          <span className="eyebrow">Daily budget</span>
          <div className="hero-row">
            <div className="hero-num">{fmtInt(budget.eaten)}</div>
            <div className="hero-of">
              / <b>{fmtInt(adjusted)}</b>
              <small>kcal eaten</small>
            </div>
          </div>

          <BudgetMeter budget={budget} />

          <div className="fuel-notes">
            <span className="left">
              <b>{fmtInt(Math.abs(remaining))}</b> kcal {remaining >= 0 ? "left" : "over"}
            </span>
            <EarnedNote budget={budget} />
          </div>
        </section>
      )}

      {day && me && (
        <section>
          <div className="sec-head">
            <span className="eyebrow">Macros</span>
            <span className="mono">GRAMS / TARGET</span>
          </div>
          {macros.map(([key, name, eaten, target]) => {
            const focus = me.profile.focus_macro === key;
            return (
              <div key={key} className={focus ? "macro-row lead" : "macro-row"}>
                <span className="lbl">
                  {name}
                  {focus && <span className="vh"> — focus macro</span>}
                </span>
                <span className="mbar">
                  <i style={{ width: `${target > 0 ? Math.min((eaten / target) * 100, 100) : 0}%` }} />
                </span>
                <span className="val">
                  {Math.round(eaten)} <span>/ {target} g</span>
                </span>
              </div>
            );
          })}
        </section>
      )}

      {day && (
        <section>
          <div className="sec-head">
            <span className="eyebrow">Timeline</span>
            <span className="mono">{timeSpan(entries)}</span>
          </div>
          {entries.length === 0 ? (
            <p className="placeholder-note">
              Nothing logged yet — the button below turns a sentence into a meal.
            </p>
          ) : (
            <div className="tl">
              {entries.map((entry, i) => {
                const fresh = logged !== null && i === entries.length - 1;
                return (
                  <TimelineRow key={i} when={entry.when} fresh={fresh}>
                    <div className="meal">
                      {entry.photoKey ? (
                        <span className="thumb">
                          <img
                            src={`/api/photos/${entry.photoKey}`}
                            alt={`Photo of ${entry.desc}`}
                            loading="lazy"
                          />
                        </span>
                      ) : (
                        <span className="thumb" aria-hidden="true">
                          <SlotIcon slot={entry.slot} />
                        </span>
                      )}
                      <div>
                        <div className="slot">
                          {slotLabel(entry.slot)}
                          {fresh && " · just now"}
                        </div>
                        <div className="desc">{entry.desc}</div>
                        <div className="macros-mini">
                          {entry.p}P · {entry.c}C · {entry.f}F
                        </div>
                      </div>
                      <div className="kcal">
                        {fmtInt(entry.kcal)}
                        <small>kcal</small>
                      </div>
                    </div>
                  </TimelineRow>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** grams target for a macro: share of the adjusted kcal ÷ kcal-per-gram */
function gramsFor(adjustedKcal: number, pct: number, kcalPerGram: number) {
  return Math.round((adjustedKcal * pct) / 100 / kcalPerGram);
}

/** "7:12 AM" — the timeline rail format. */
function clock12(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "6:04A — 3:05P" — the sec-head span (sketch's compressed meridian). */
function timeSpan(entries: Entry[]) {
  if (entries.length === 0) return "—";
  const compress = (when: string) => when.replace(" AM", "A").replace(" PM", "P");
  const first = compress(entries[0]!.when);
  const last = compress(entries[entries.length - 1]!.when);
  return entries.length === 1 ? first : `${first} — ${last}`;
}

function slotLabel(slot: MealSlot) {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

/** The sketch's three food glyphs, keyed by slot (breakfast bowl, plate,
 *  snack apple). */
function SlotIcon({ slot }: { slot: MealSlot }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: "0 0 26 26",
    fill: "none",
    stroke: "var(--ink-muted)",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
  };
  if (slot === "breakfast") {
    return (
      <svg {...common}>
        <path d="M4 12h18l-2 7a3 3 0 0 1-3 2H9a3 3 0 0 1-3-2l-2-7z" />
        <circle cx="10" cy="8" r="1.4" />
        <circle cx="15" cy="6.5" r="1.4" />
        <circle cx="19" cy="9" r="1.4" />
      </svg>
    );
  }
  if (slot === "snack") {
    return (
      <svg {...common}>
        <path d="M13 8c-4-2-8 1-8 6s3 8 5 8c1.2 0 1.8-.7 3-.7s1.8.7 3 .7c2 0 5-3 5-8s-4-8-8-6z" />
        <path d="M13 8c0-2.5 1.5-4 3.5-4.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M3 13h20a10 10 0 0 1-20 0z" />
      <path d="M6 13c1.5-2 4-2.5 6-1.5M13 12c2-1.5 4.5-1 6 1" />
    </svg>
  );
}
