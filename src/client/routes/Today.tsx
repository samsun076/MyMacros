import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import type { DayResponse, DayRun, FoodLog, MealSlot, Me, Units } from "../../shared/api";
import { macroTargets } from "../../shared/budget";
import { foldMeals } from "../../shared/meals";
import { ApiError, api, useApi } from "../lib/api";
import { localDay } from "../lib/day";
import { fmtInt } from "../lib/format";
import { useLoadFailure } from "../lib/load-failure";
import { timelineView } from "../lib/timeline";
import {
  nextUndo,
  pendingDeletionIds,
  pendingNote,
  pushDeletion,
  withoutDeletion,
} from "../lib/undo-queue";
import { EditMealSheet } from "../components/EditMealSheet";
import { InstallPrompt } from "../components/InstallPrompt";
import { LoadFailureNote } from "../components/LoadFailureNote";
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

/** DEV-only: `/#swiped` renders the newest row already revealed, so the state
 *  can be screenshotted (#52).
 *
 *  The gesture itself is not reachable by shot-matrix — it drives CDP and has
 *  no finger — so the *state* is made reachable instead and the motion stays a
 *  device check. Being honest about which half is covered is the point; a
 *  screenshot of an open row is not evidence that swiping opens it.
 *
 *  A sentinel rather than an id, because no entry id can ever be this: they are
 *  `<ISO instant>|<slot>`. First row only — a whole list hanging open is not a
 *  state the app has. */
const STAGE_NEWEST = "stage:newest";
const SWIPED_STAGE =
  import.meta.env.DEV && window.location.hash === "#swiped" ? STAGE_NEWEST : null;

/** DEV-only: `/#editing` opens the edit sheet on the day's **largest** entry,
 *  so the tall case can be screenshotted (#60).
 *
 *  Largest rather than newest, and that is the whole reason it needs a sentinel
 *  of its own. The state worth measuring is the one #60's Verify section names
 *  — three items, whose totals row and save button have to survive at 375 —
 *  and "whatever was logged most recently" is usually one item, which is the
 *  short sheet and proves nothing. A stage that shoots the easy case is worse
 *  than no stage, because it produces a PNG that looks like evidence.
 *
 *  It injects **nothing**: the sheet opens over the signed-in user's real rows,
 *  the way `/log#picks` opens over their real favourites. It is still DEV-gated
 *  like `#swiped` rather than left open like `#picks`, because both of those
 *  put the list into a state a *gesture* produces, and a URL that silently
 *  arms an editor is a different promise from one that opens a list.
 *
 *  Ties go to the newest, and it is deterministic given the data — which is a
 *  weaker claim than `/log#confirm`'s (that one carries its own meal). Seed
 *  with `tools/seed-demo.mjs` and log one multi-item meal to reach the shape
 *  this stage exists for. */
const STAGE_LARGEST = "stage:largest";
const EDITING_STAGE =
  import.meta.env.DEV && window.location.hash === "#editing" ? STAGE_LARGEST : null;

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
  /* `error` is read now, and that is the whole of #24 (#48 always set it).
     This screen took `data` and `reload` and dropped it, and every section
     below is gated on `{day && …}` — so a failed fetch rendered this header
     and permanent blankness, with no message and no way back. A failed load
     and a slow load were the same picture. */
  const dayRead = useApi<DayResponse>(`/api/day/${today}`);
  const meRead = useApi<Me>("/api/me");
  const reloadDay = dayRead.reload;

  /* One failure per *subject*, not one per screen. `/api/me` failing must not
     take a correctly-loaded day off the screen with it — the budget and the
     timeline need `day` and nothing else — so each read blanks only its own
     sections, and the one card below names the first failure there is.

     **A failure blanks its data rather than sitting above it.** `useApi` keeps
     the last successful `data` when a *reload* fails, and Today reloads after
     every delete, undo and edit — so the alternative is a card saying "that
     didn't load" over totals that are now known to be wrong by exactly the
     write that just landed. That is #54's cached-`/api/day` defect with a
     stale timestamp, reached by a different road. */
  const dayFailure = useLoadFailure(dayRead.error);
  const meFailure = useLoadFailure(meRead.error);
  const failure = dayFailure ?? meFailure;
  const day = dayFailure ? null : dayRead.data;
  const me = meFailure ? null : meRead.data;
  const pending = !failure && !day;
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

  /* Which timeline row is swiped open — at most one, and the list is the only
     thing that can say so (#52).

     **Here rather than in the row**, and not because it's convenient: "one open
     at a time" is a claim about the *set* of rows, and a row that tried to
     enforce it would have to reach outside itself to do it — a module singleton
     or a DOM-wide event bus, i.e. list state with no list to put it in. Today
     already owns the other piece of list-scoped state for exactly this reason
     (#90's undo queue), and holding it here means "open" has one home instead
     of one per row, which is what let three rows sit open at once. Closing A
     when B opens then needs no message between them: A is simply no longer the
     id this holds. */
  const [openRow, setOpenRow] = useState<string | null>(SWIPED_STAGE);

  /* Which entry the edit sheet is open on, by the same `logged_at|meal_slot` id
     the list keys on (#60).
     
     An id rather than the entry object, for the reason the delete queue holds
     objects and this does not: the sheet is editing rows that still exist, so
     the screen's own `entries` is the live copy and re-deriving from it on each
     render means a refetch cannot leave the sheet showing a stale meal. #52's
     queue is the opposite case — those rows are gone from the server, and the
     held copy is the only one left. */
  const [editingId, setEditingId] = useState<string | null>(EDITING_STAGE);

  /* Render order and header span, computed together (#80). `entries` stays
     chronological — that is what the span reads.

     EVERY pending deletion is filtered out *before* this, so the header span
     and the fresh index are both computed over what is actually on screen —
     a deleted 7:10 AM breakfast must stop being the left end of "7:10A —
     7:10P" the moment it leaves the list, not when the refetch lands. This
     filtered a single `undoable` until #90; with a queue, filtering only the
     newest deletion would put the previous meal's row back on screen. */
  const timeline = useMemo(() => {
    const hidden = pendingDeletionIds(del.pending);
    return timelineView(entries.filter((e) => !hidden.has(e.id)), logged !== null);
  }, [entries, logged, del.pending]);

  /* The DEV stage names a *position* — "the newest row is open" — and the id
     that resolves to isn't known until the day's data lands, so it is held as
     itself and resolved here rather than being turned into an id at mount,
     where it would be null and the stage would silently render a closed list.
     Closing the row replaces the sentinel, so the stage is a starting state
     rather than a mode you can't leave. */
  const openEntryId = openRow === STAGE_NEWEST ? (timeline.rows[0]?.id ?? null) : openRow;

  /* The stage names a *shape* — "the entry with the most items" — which no id
     can express until the day's rows have landed, so it is resolved here for
     `STAGE_NEWEST`'s reason exactly: turning it into an id at mount would
     resolve it against an empty list and the stage would render a closed
     sheet. `reduce` keeps the first of a tie, and `timeline.rows` is already
     newest-first (#80), so a tie is the newest. */
  const editingEntry = useMemo(() => {
    if (editingId === STAGE_LARGEST) {
      return timeline.rows.reduce<Entry | null>(
        (best, row) => (best === null || row.rows.length > best.rows.length ? row : best),
        null,
      );
    }
    return timeline.rows.find((e) => e.id === editingId) ?? null;
  }, [editingId, timeline]);

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

      {/* #24. The tab bar is untouched by this — it lives in `AppShell`,
          outside the route — so a failed day is a screen with a message and a
          button on it, not a dead end: Trends and Settings are still one tap
          away and may well work, since one route failing is not the server
          being gone.

          Retry re-reads BOTH, whichever failed. They are one screen's worth of
          state and they fail together in the ordinary case; a button that
          fixed half of a screen and left the other half explaining itself is a
          second tap nobody can predict the need for. */}
      {failure && (
        <LoadFailureNote
          /* Which read failed, not which screen it failed on. `/api/me` alone
             going down leaves the budget and the timeline correct on screen,
             and a card over them reading "Today's numbers didn't load" would
             be contradicted by the numbers directly beneath it — found by
             driving it, not by reading it. */
          what={dayFailure ? "Today's numbers" : "Your profile"}
          failure={failure}
          onRetry={() => {
            dayRead.reload();
            meRead.reload();
          }}
        />
      )}

      {/* The other half of "a failed load and a slow load are the same
          picture": while the day is genuinely in flight this screen is a
          heading and nothing, which a reader can see and a screen reader
          cannot. Deliberately not a visible skeleton — one that appears on
          every load is a flash on a fast connection, and the honest fix for
          that is a delayed fade, which is a transition, which this issue puts
          out of scope for a reason nothing here can shoot. */}
      {pending && (
        <p className="vh" role="status" aria-busy="true">
          Loading today's numbers…
        </p>
      )}

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
      {del.next && (
        <div className="toast toast-undo" role="status">
          {/* The toast names the meal Undo will restore AND says how many
              other deletions are still outstanding (#90). Both, because either
              alone leaves you believing the earlier one is unrecoverable —
              which is exactly what the single-slot version did, only truly.
              `role="status"` re-announces on every change, so the count is
              spoken too. */}
          {slotLabel(del.next.slot)} deleted
          {del.note && <span className="mono">{del.note}</span>}
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

      {logged && !del.next && (
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
                      open={openEntryId === entry.id}
                      /* A gesture that ends closed clears the slot whichever
                         row it happened on. Scoping it to `cur === entry.id`
                         reads more careful and is wrong: a short flick on row B
                         that snaps back produces no click, so the outside-tap
                         rule never sees it, and row A would sit open behind a
                         finger that was demonstrably somewhere else. Measured —
                         a 20px flick on a third row left the open one open. */
                      onOpenChange={(open) => setOpenRow(open ? entry.id : null)}
                      /* The slot is released before the request, not after: an
                         undo restores the meal under the same
                         `logged_at|meal_slot` id, and a stale open id would put
                         the row back with its trash can already showing. */
                      onDelete={() => {
                        setOpenRow(null);
                        void del.remove(entry);
                      }}
                      /* #60's entry point. Which taps reach here is decided in
                         `gesture.ts` — a drag never does, and neither does the
                         tap that dismisses this row's own delete drawer. The
                         row does not need to know either rule. */
                      onTap={() => setEditingId(entry.id)}
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
                      {/* Named so the clamped column can be told to shrink
                          (#92) — a grid item's `min-width: auto` is its widest
                          word, so a name with no space in it pushes the kcal
                          figure off the row however the text is clipped. */}
                      <div className="meal-body">
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

      {/* #60. Keyed on the entry id so switching rows remounts the sheet — its
          fields are seeded once from the rows, and a sheet that kept its state
          across a change of subject would show one meal's numbers under
          another meal's name.

          A save re-reads the day rather than patching the list from the
          response: `/api/day` is the one thing that recomputes totals, the
          budget and the macro bars, and #48's refetch-on-mount policy is
          already what makes "nothing recalculates elsewhere" true. */}
      {editingEntry && (
        <EditMealSheet
          key={editingEntry.id}
          entry={editingEntry}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            reloadDay();
          }}
        />
      )}

      {/* Below the day, not above it (#24). An install card at the top of the
          first screen is an advert; below the timeline it is the last thing
          you pass on the way down and easy to dismiss forever. It renders
          nothing at all once installed, which is the state this app is
          normally in.

          **And not at all while a read has failed.** Its copy promises the app
          "works offline", and the card directly above it now says nothing on
          this screen is cached. Both statements are true — the service worker
          precaches the shell and deliberately never caches an API response
          (#54) — and read together on one screen they call each other liars.
          The pitch is also simply badly timed: nobody installs an app in the
          moment it is failing to load. Withheld rather than reworded, because
          the sentence is correct and it is the *adjacency* that is wrong. */}
      {!failure && <InstallPrompt />}
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
 *  held in `pending` — which is both the toast's subject and the filter that
 *  keeps the row out of the list. One piece of state, so a row cannot linger
 *  after its toast or vanish before it.
 *
 *  **`pending` is a queue, LIFO (#90).** It was a single slot, and a second
 *  delete overwrote the first entry's held rows — the only remaining copy of
 *  a meal already gone from D1. Undo restores the newest and leaves the rest
 *  waiting; see `lib/undo-queue.ts` for why one-at-a-time rather than all.
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
 *
 *  **The toast IS the undo window, and it lives only while Today is mounted.**
 *  Decided, not inherited from where the state happens to sit (#90): leaving
 *  the screen commits every pending delete. The queue holds rows that no
 *  longer exist anywhere else, so lifting it to a module store or a context
 *  would mean an app-wide slot of ghost meals that a tab switch, a save, or
 *  tomorrow morning could still put back — an undo whose window has no visible
 *  edge is worse than one that ends where its toast does. Navigating away is
 *  the deliberate way to say "yes, all of them".
 */
function useDeleteEntry(reload: () => void) {
  const [pending, setPending] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function remove(entry: Entry) {
    setError(null);
    try {
      await api.del(`/api/food-logs`, { ids: entry.rows.map((r) => r.id) });
      setPending((queue) => pushDeletion(queue, entry));
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
    const entry = nextUndo(pending);
    if (!entry) return;
    /* Off the queue before the POST, or the restored meal folds back to the
       same `logged_at|meal_slot` id and the pending filter hides the row it
       just put back. It goes on again if the POST fails. */
    setPending((queue) => withoutDeletion(queue, entry));
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
          // #104's three travel with the row for the same reason, and the
          // failure they avoid is this issue's own defect retail: a restore
          // that dropped them would put the meal back stripped of the portion
          // it was logged with, permanently and one entry at a time. The read
          // that produced them is long gone by now, so the row is the only
          // copy. Nulls stay nulls — the route reads all-three-absent as "not
          // recorded", which is what a portionless row was.
          portion_qty: r.portion_qty,
          portion_unit: r.portion_unit,
          ai_portion_qty: r.ai_portion_qty,
        })),
      });
      reload();
    } catch {
      /* Back on the queue, retryable (#90). Dropping it here would reproduce
         this issue's own defect one entry at a time: these held rows are the
         last copy of the meal, and the ordinary cause of a failed restore is a
         dropped connection, which the next tap fixes. #52 cleared the slot
         before the POST and left a terminal error — correct about the message,
         wrong that there was nothing left to try. The toast stays up naming
         this meal, so the error and the way out are on screen together. */
      setPending((queue) => pushDeletion(queue, entry));
      setError("Couldn't put that back — it's still deleted. Undo to try again.");
    }
  }

  return { pending, next: nextUndo(pending), note: pendingNote(pending), remove, undo, error };
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
