import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import type { DayResponse, DayRun, FoodLog, MealSlot, Me, Units } from "../../shared/api";
import { macroTargets } from "../../shared/budget";
import { foldMeals } from "../../shared/meals";
import { ApiError, api, useApi } from "../lib/api";
import { localDay } from "../lib/day";
import { fmtInt } from "../lib/format";
import { timelineView } from "../lib/timeline";
import { InstallPrompt } from "../components/InstallPrompt";
import { SwipeToDelete } from "../components/SwipeToDelete";
import { useActiveMotifs } from "../motifs";
import type { BudgetData } from "../motifs/types";

/** The Today screen (#11), ported literally from the frozen sketches
 *  (c2-night-athletic.html; the saved stage of e-log-flow.html).
 *
 *  Sketch-anchored specifics: the hero denominator is the ADJUSTED target
 *  (base + earned, arithmetic spelled out in the meter's aria-label); the
 *  earned meter layer renders at zero width in M2 rather than being omitted;
 *  BASE is labelled on the scale; the focus macro carries accent + a
 *  screen-reader "— focus macro" suffix. The weight strip and run card wait
 *  for their data sources (M4 — #18/#19).
 *
 *  One departure from the sketch, deliberate: its macro targets are all three
 *  a share of the adjusted total. Protein is now anchored to body weight
 *  instead (#77), so a run moves carbs and fat and leaves protein still. The
 *  sketch's own numbers don't change on a rest day, which is why this reads
 *  as the same screen. */

type LoggedToast = { slot: MealSlot; kcal: number; ms: number; edited: number };

type Entry = {
  /** `logged_at|meal_slot` — `foldMeals`' own grouping key, so it names the
   *  same thing the fold does. */
  id: string;
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
  /** The rows this entry folded from — what a delete removes and an undo
   *  restores (#52). */
  rows: FoodLog[];
};

export function Today() {
  const today = localDay();
  const { data: day, reload: reloadDay } = useApi<DayResponse>(`/api/day/${today}`);
  const { data: me } = useApi<Me>("/api/me");
  const location = useLocation();
  const logged =
    (location.state as { logged?: LoggedToast } | null)?.logged ??
    /* DEV-only: /#saved shows the toast for shot-matrix, mirroring the
       sketch's hash stages. Compiled out of production builds.

       The slot and kcal come from the newest log rather than being fabricated
       (#80). They used to read `lunch, 545` while the `.fresh` wash landed on
       whatever was actually newest, so the stage showed a toast naming one
       meal beside a highlight on another — and this is now the *only* way to
       review the fresh state, which is the state #80 reordered the list for.
       A QA fixture that contradicts itself teaches you to distrust the
       screenshot. The timings stay invented; nothing here has ever measured
       one. */
    (import.meta.env.DEV && window.location.hash === "#saved" && day?.logs.length
      ? {
          slot: day.logs[day.logs.length - 1]!.meal_slot,
          kcal: Math.round(day.logs[day.logs.length - 1]!.kcal),
          ms: 8400,
          edited: 1,
        }
      : null);
  const { BudgetMeter, EarnedNote, TimelineRow } = useActiveMotifs();

  const budget: BudgetData = {
    eaten: day?.totals.kcal ?? 0,
    base: day?.target_kcal ?? 0,
    // #21: the earned layer has rendered at zero width since M2 waiting for
    // exactly this. Base and earned stay separate all the way through —
    // nothing here folds the bonus into the target (build rule 7).
    earned: day?.run?.earned_kcal ?? 0,
    earnedLabel: day?.run ? runLabel(day.run, me?.profile.units ?? "imperial") : null,
    // #69: only when the server says the feed is both quiet and relevant to
    // the day being viewed — a feed that died last night doesn't make last
    // Tuesday's runs incomplete, and a feed that was never set up isn't broken.
    staleSince: day?.runs_feed?.stale ? day.runs_feed.last_success_at : null,
  };
  const adjusted = budget.base + budget.earned;
  const remaining = adjusted - budget.eaten;

  // One save = one meal (#10). `foldMeals` is shared with
  // GET /api/food-logs/recent, which used to carry its own copy of the same
  // grouping — two answers to "what counts as one meal", differing silently
  // the moment either changed (#86). Rounding stays here: the timeline shows
  // whole grams and the recents list shows tenths, which is a surface choice.
  const entries = useMemo(
    () =>
      foldMeals(day?.logs ?? []).map(
        (meal): Entry => ({
          /* `foldMeals` groups on exactly this pair, so it identifies a meal
             for as long as the fold does. A React key had been the array
             index, which stops being stable the moment the list renders
             newest-first (#80): every save prepends, so every row's key
             shifts by one and React remounts the whole timeline — including
             the photo it just finished loading. */
          id: `${meal.logged_at}|${meal.meal_slot}`,
          when: clock12(meal.logged_at),
          slot: meal.meal_slot,
          desc: meal.name,
          kcal: meal.kcal,
          p: Math.round(meal.protein_g),
          c: Math.round(meal.carbs_g),
          f: Math.round(meal.fat_g),
          photoKey: meal.rows.find((r) => r.photo_key)?.photo_key ?? null,
          // Everything undo needs to put this exact meal back (#52). Held
          // rather than refetched because by the time undo is tapped the row
          // is gone from the server — the client is the only place it still
          // exists.
          rows: meal.rows,
        }),
      ),
    [day],
  );

  const del = useDeleteEntry(reloadDay);

  /* Render order and header span, computed together (#80). `entries` stays
     chronological — that is what the span reads.

     The just-deleted entry is filtered out *before* this, so the header span
     and the fresh index are both computed over what is actually on screen —
     a deleted 7:10 AM breakfast must stop being the left end of "7:10A —
     7:10P" the moment it leaves the list, not when the refetch lands. */
  const timeline = useMemo(
    () => timelineView(entries.filter((e) => e.id !== del.undoable?.id), logged !== null),
    [entries, logged, del.undoable],
  );

  /* Macro targets, from the ADJUSTED total (sketch: 82 / 165 g) — but only
   * carbs and fat move with it now (#77).
   *
   * `macroTargets` is the shared function onboarding previews with, and this
   * screen used to carry its own three-line copy of the arithmetic instead.
   * That copy is exactly the shape #86 hunts: two implementations of one
   * quantity, differing by a model rather than by a rounding rule.
   *
   * Weight comes from `me.trend_weight_kg` — the same number `refreshTarget`
   * computes from, never a second source (#78). Null before the first
   * weigh-in, where there is no anchor and the targets are withheld. */
  const targets = me
    ? macroTargets({
        kcal: adjusted,
        weight_kg: me.trend_weight_kg,
        protein_g_per_kg: me.profile.protein_g_per_kg,
        carb_ratio_pct: me.profile.carb_ratio_pct,
      })
    : null;
  const macros = me
    ? ([
        ["protein", "Protein", day?.totals.protein_g ?? 0, targets?.protein_g ?? null],
        ["carbs", "Carbs", day?.totals.carbs_g ?? 0, targets?.carbs_g ?? null],
        ["fat", "Fat", day?.totals.fat_g ?? 0, targets?.fat_g ?? null],
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

      {/* #52's undo, and it replaces the confirm dialog rather than joining it:
          a one-gesture destructive action that then asks "are you sure?" has
          given back the speed that justified the gesture. The row is already
          gone from the server here — undo re-posts it. */}
      {del.undoable && (
        <div className="toast toast-undo" role="status">
          {slotLabel(del.undoable.slot)} deleted
          <button type="button" className="btn-text" onClick={() => void del.undo()}>
            Undo
          </button>
        </div>
      )}
      {del.error && (
        <p className="signin-error" role="alert">
          {del.error}
        </p>
      )}

      {logged && !del.undoable && (
        <div className="toast" role="status">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9.5l4 4 8-9" />
          </svg>
          {slotLabel(logged.slot)} logged — {fmtInt(logged.kcal)} kcal
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
                  <i style={{ width: `${target ? Math.min((eaten / target) * 100, 100) : 0}%` }} />
                </span>
                {/* An em-dash before the first weigh-in, not a fabricated
                    number: protein is anchored to body weight and there is
                    no weight yet (#77). The row still reports what was
                    eaten, which is knowable. */}
                <span className="val">
                  {Math.round(eaten)} <span>/ {target ?? "—"} g</span>
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
            <span className="mono">{timeline.span}</span>
          </div>
          {entries.length === 0 ? (
            <p className="placeholder-note">
              Nothing logged yet — the button below turns a sentence into a meal.
            </p>
          ) : (
            <div className="tl">
              {/* Newest first, and the header still reads earliest → latest.
                  Both come out of `timelineView` together (#80) so the screen
                  never holds a reversed list it could read positionally by
                  mistake — see lib/timeline.ts for the two traps. */}
              {timeline.rows.map((entry) => {
                const fresh = entry.fresh;
                return (
                  <TimelineRow key={entry.id} when={entry.when} fresh={fresh}>
                    <SwipeToDelete
                      label={`${slotLabel(entry.slot)}, ${entry.desc}`}
                      onDelete={() => void del.remove(entry)}
                      /* DEV-only stage for the state shot-matrix cannot reach
                         with a gesture (#52). First row only — a whole list
                         hanging open is not a state the app ever has. */
                      initiallyOpen={
                        import.meta.env.DEV &&
                        window.location.hash === "#swiped" &&
                        entry.id === timeline.rows[0]?.id
                      }
                    >
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
                    </SwipeToDelete>
                  </TimelineRow>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Below the day, not above it (#24). An install card at the top of the
          first screen is an advert; below the timeline it is the last thing
          you pass on the way down and easy to dismiss forever. It renders
          nothing at all once installed, which is the state this app is
          normally in. */}
      <InstallPrompt />
    </>
  );
}

/** "7:12 AM" — the timeline rail format. */
/** "6.2 mi run", "10.0 km run", or "2 runs" when the day had more than one.
 *
 *  Built here rather than server-side because whether a distance reads in
 *  miles or kilometres is a display concern settled from `profiles.units` —
 *  the wire carries metres, like every other measurement. */
function runLabel(run: DayRun, units: Units) {
  if (run.count > 1) return `${run.count} runs`;
  return units === "imperial"
    ? `${(run.distance_m / 1609.344).toFixed(1)} mi run`
    : `${(run.distance_m / 1000).toFixed(1)} km run`;
}

function clock12(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function slotLabel(slot: MealSlot) {
  return slot.charAt(0).toUpperCase() + slot.slice(1);
}

/** Delete an entry, with undo instead of a confirm (#52).
 *
 *  **Undo replaces the dialog, it doesn't accompany it.** A one-gesture
 *  destructive action that then asks "are you sure?" has spent the speed that
 *  justified the gesture; the native idiom is to do it and offer the way back.
 *
 *  The entry is removed from the screen the moment the server confirms, and
 *  held in `undoable` — which is both the toast's subject and the filter that
 *  keeps the row out of the list. One piece of state, so the row cannot linger
 *  after the toast or vanish before it.
 *
 *  **Undo re-posts with the entry's own `logged_at`.** Since #80 the timeline
 *  renders newest first, so a restore stamped `now` would drop a breakfast in
 *  above dinner — an undo that visibly lies about what it undid. The ids are
 *  not reused: the rows are gone, and a fresh id for a fresh row is the honest
 *  description of what happened.
 *
 *  The toast has no timer. A disappearing undo is a race against reading, and
 *  the next thing that clears it is the next thing you do — which is the same
 *  moment you have stopped caring about the meal you just deleted.
 */
function useDeleteEntry(reload: () => void) {
  const [undoable, setUndoable] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(entry: Entry) {
    setError(null);
    try {
      await api.del(`/api/food-logs`, { ids: entry.rows.map((r) => r.id) });
      setUndoable(entry);
      reload();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "network"
          ? "Couldn't reach the server — nothing was deleted."
          : "That didn't delete. Try again in a moment.",
      );
    }
  }

  async function undo() {
    const entry = undoable;
    if (!entry) return;
    setUndoable(null);
    setError(null);
    try {
      const first = entry.rows[0]!;
      await api.post("/api/food-logs", {
        logged_on: first.logged_on,
        logged_at: first.logged_at,
        meal_slot: first.meal_slot,
        source: first.source,
        ...(first.photo_key ? { photo_key: first.photo_key } : {}),
        ...(first.barcode ? { barcode: first.barcode } : {}),
        items: entry.rows.map((r) => ({
          name: r.name,
          kcal: r.kcal,
          protein_g: r.protein_g,
          carbs_g: r.carbs_g,
          fat_g: r.fat_g,
          confidence: r.confidence,
          // #76's columns are the reader's ORIGINAL numbers, so they travel
          // with the row rather than being re-derived — a restored meal that
          // forgot them would look like one nobody ever corrected.
          edited: r.edited > 0,
          ai_kcal: r.ai_kcal,
          ai_protein_g: r.ai_protein_g,
          ai_carbs_g: r.ai_carbs_g,
          ai_fat_g: r.ai_fat_g,
        })),
      });
      reload();
    } catch {
      // The row is gone and the undo failed, which is the one state here with
      // no way back — say so plainly rather than leaving a silent gap.
      setError("Couldn't put that back. It's still deleted.");
    }
  }

  return { undoable, remove, undo, error };
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
