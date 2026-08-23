import { useState } from "react";
import { Link } from "react-router";
import type { Accent, Macro, Me, Profile, Theme, Units } from "../../shared/api";
import { kgToLb, lbToKg } from "../../shared/units";
import { weightBounds } from "../../shared/weight";
import { LoadFailureNote } from "../components/LoadFailureNote";
import { NumericField } from "../components/NumericField";
import { PasskeyManager } from "../components/PasskeyManager";
import { Sources } from "../components/Sources";
import { ApiError, api, useApi } from "../lib/api";
import { authClient } from "../lib/auth";
import { useLoadFailure } from "../lib/load-failure";
import { useUpdate } from "../lib/sw";
import { ACCENTS, THEME_PACKS, applyTheme, hasAccentChoice } from "../lib/theme";

/** Settings (#23).
 *
 *  **What this screen edits is what nothing else does.** The budget inputs —
 *  TDEE, deficit, protein anchor, carb:fat, eat-back — are edited by
 *  `/onboarding`, which #17 made re-enterable precisely so a returning user
 *  could change them. Building a second field-by-field editor for the same
 *  columns here would be one quantity with two sources, the defect class the
 *  register in CLAUDE.md exists to stop, and the weaker of the two: only that
 *  screen carries the live budget preview, the fat-floor warning and #84's
 *  guard against writing a stale weight as today's weigh-in. So the budget
 *  reads here and edits there.
 *
 *  That leaves three values with no editor anywhere, which is this screen's
 *  actual job:
 *
 *  - **goal weight** — Trends draws a GOAL line and the chart marks it, from a
 *    column nothing in the app could set.
 *  - **focus macro** — build rule 8's whole subject.
 *  - **units** — every weight and height on every screen reads from it.
 *
 *  `timezone` is shown and deliberately not editable: `POST /api/food-logs`
 *  mirrors it from the device on every save (#44), so a picker here would be
 *  reverted by the next meal — the same silent-revert shape as #71's scale.
 */
export function Settings() {
  const meRead = useApi<Me>("/api/me");
  /* #24: this screen already read `error` — what it did not do was tell an
     offline phone apart from a broken server, or offer anything but "reopen
     this screen", which is a page reload spelled as an instruction. Same card
     as Today's now, and the reload it already had is the retry. */
  const failure = useLoadFailure(meRead.error);
  const me = failure ? null : meRead.data;
  const edit = useProfileEdit(me, meRead.reload);
  const p = edit.profile;

  return (
    <>
      <header>
        <span className="eyebrow">
          <span className="tick" />
          Settings
        </span>
        <h1>{me?.user.name || me?.user.email || "Account"}</h1>
      </header>

      {failure && (
        <LoadFailureNote what="Your profile" failure={failure} onRetry={meRead.reload} />
      )}

      <PasskeyManager />

      <section>
        <div className="sec-head">
          <span className="eyebrow">Budget</span>
          <span className="mono">#17 · #77 · #79</span>
        </div>
        <dl className="kv">
          <div>
            <dt>Goal</dt>
            <dd>{me ? label(me.profile.goal) : "—"}</dd>
          </div>
          <div>
            <dt>Deficit</dt>
            <dd>{me ? `${me.profile.deficit_kcal} kcal` : "—"}</dd>
          </div>
          {/* #79's two axes, each shown with what it set: the goal owns
              protein, the training profile owns carbs:fat. Reading them side
              by side is what makes the numbers traceable rather than magic. */}
          <div>
            <dt>Training</dt>
            <dd>{me ? label(me.profile.athlete_profile) : "—"}</dd>
          </div>
          <div>
            <dt>Protein</dt>
            <dd>{me ? `${me.profile.protein_g_per_kg.toFixed(1)} g/kg` : "—"}</dd>
          </div>
          <div>
            <dt>Carbs : fat</dt>
            <dd>{me ? `${me.profile.carb_ratio_pct} : ${100 - me.profile.carb_ratio_pct}` : "—"}</dd>
          </div>
          <div>
            <dt>Eat-back</dt>
            <dd>{me ? `${me.profile.eat_back_pct}%` : "—"}</dd>
          </div>
        </dl>
        {/* The way back into #17's flow. Without this, onboarding is a
            one-shot: Today only offers it while `onboarded` is false, so
            finishing it removed the only link to it and there was no way to
            change a deficit or a goal again. The full field-by-field settings
            screen is still #23; this is #17's own flow staying reachable. */}
        <Link className="btn btn-quiet" to="/onboarding">
          Edit budget inputs
        </Link>
        <p className="placeholder-note">
          Opens the setup flow with your current numbers in it, and the live preview
          that shows what each one does to your target.
        </p>
      </section>

      {/* The one budget number `/onboarding` doesn't own. Trends draws a GOAL
          line and the chart marks it (Trends.tsx), off a column nothing in the
          app could write — so it read as a feature that only worked if you
          edited the database by hand. */}
      <section>
        <div className="sec-head">
          <span className="eyebrow">Goal weight</span>
          <span className="mono">#22</span>
        </div>
        <GoalWeightField edit={edit} />
      </section>

      <section>
        <div className="sec-head">
          <span className="eyebrow">Display</span>
          <span className="mono">#23</span>
        </div>

        {/* Build rule 8: --accent on a macro bar means the macro being
            *targeted*, and this is the control that picks it. */}
        <div className="field">
          <span className="eyebrow">Focus macro</span>
          <div className="seg">
            {(["protein", "carbs", "fat"] as Macro[]).map((m) => (
              <button
                key={m}
                type="button"
                className={p?.focus_macro === m ? "seg-btn on" : "seg-btn"}
                aria-pressed={p?.focus_macro === m}
                disabled={!p}
                onClick={() => void edit.save({ focus_macro: m })}
              >
                {label(m)}
              </button>
            ))}
          </div>
          <span className="opt-hint">
            The one drawn in your accent colour on Today, with the rest recessive.
          </span>
        </div>

        <div className="field">
          <span className="eyebrow">Units</span>
          <div className="seg">
            {(["imperial", "metric"] as Units[]).map((u) => (
              <button
                key={u}
                type="button"
                className={p?.units === u ? "seg-btn on" : "seg-btn"}
                aria-pressed={p?.units === u}
                disabled={!p}
                onClick={() => void edit.save({ units: u })}
              >
                {u === "imperial" ? "Pounds" : "Kilograms"}
              </button>
            ))}
          </div>
          <span className="opt-hint">Every weight and height in the app, including the one above.</span>
        </div>

        {/* Build rule 1: Night Athletic is the primary theme and the only one
            ported. The other two are shown disabled rather than hidden — the
            app promises three packs in its own token file, and a control that
            says "not yet" is honest where a missing one looks like the feature
            was dropped. #30 is what flips `ready`. */}
        <div className="field">
          <span className="eyebrow">Theme</span>
          <div className="opts">
            {(Object.keys(THEME_PACKS) as Theme[]).map((t) => {
              const pack = THEME_PACKS[t];
              return (
                <button
                  key={t}
                  type="button"
                  className={p?.theme === t ? "opt on" : "opt"}
                  aria-pressed={p?.theme === t}
                  disabled={!p || !pack.ready}
                  onClick={() => void edit.saveTheme({ theme: t })}
                >
                  <span className="opt-name">{pack.label}</span>
                  <span className="opt-hint">{pack.ready ? pack.hint : `${pack.hint} — ports in #30`}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Build rule 5. Night Athletic's only — the light packs each have one
            accent, which is their material rather than a choice, so this
            disappears rather than greying out when they land. */}
        {p && hasAccentChoice(p.theme) && (
          <div className="field">
            <span className="eyebrow">Accent</span>
            <div className="seg">
              {(Object.keys(ACCENTS) as Accent[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  className={p.accent === a ? "seg-btn on" : "seg-btn"}
                  aria-pressed={p.accent === a}
                  aria-label={ACCENTS[a].name}
                  onClick={() => void edit.saveTheme({ accent: a })}
                >
                  <span className={`sw sw-${a}`} aria-hidden="true" />
                  {ACCENTS[a].label}
                </button>
              ))}
            </div>
            <span className="opt-hint">
              Changes as you tap. It colours your focus macro, the log button and the
              budget meter.
            </span>
          </div>
        )}

        {/* Read-only on purpose — see this component's own note. Shown rather
            than hidden because it is an input to every "today" the server
            resolves without you present (#19's launchd sync, refreshTarget). */}
        <div className="field">
          <span className="eyebrow">Timezone</span>
          <p className="mono">{p?.timezone ?? "—"}</p>
          <span className="opt-hint">
            Follows the device you last logged a meal on. Nothing to set.
          </span>
        </div>
      </section>

      {edit.error && (
        <p className="signin-error" role="alert">
          {edit.error}
        </p>
      )}

      {/* The weigh-in link used to live here, and Settings was the wrong home
          for a daily action — two taps into a settings screen. It moved to
          Trends with #22, which is one tap from the tab bar and the screen
          where you'd already be looking at the number. `/weight` is still its
          own route; only the entry point moved, so nothing is duplicated. */}

      <Sources />

      <UpdateSection />

      <button className="btn btn-quiet" onClick={() => void authClient.signOut()}>
        Sign out
      </button>
    </>
  );
}

/** One profile edit: apply locally, PATCH, keep it or put it back.
 *
 *  Optimistic because every control here is a toggle whose whole value is
 *  being instant — a segmented button that waits for a round trip before
 *  moving reads as broken, and #29's theme switch has to repaint before the
 *  request even leaves. The overlay is dropped on `reload`, so the server's
 *  answer is what survives; a failure puts the control back and says so
 *  rather than leaving the screen quietly disagreeing with the database.
 */
function useProfileEdit(me: Me | null, reload: () => void) {
  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [error, setError] = useState<string | null>(null);

  const profile: Profile | null = me ? { ...me.profile, ...draft } : null;

  /** Resolves true when the write landed. Callers that changed something
   *  outside React's tree — `saveTheme` restyles the document — need to know,
   *  and a rejected promise would make every ordinary toggle a try/catch. */
  async function save(patch: Partial<Profile>): Promise<boolean> {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
    try {
      await api.patch("/api/me/profile", patch);
      setDraft({});
      reload();
      return true;
    } catch (err) {
      setDraft((d) => {
        const next = { ...d };
        for (const key of Object.keys(patch)) delete next[key as keyof Profile];
        return next;
      });
      setError(
        err instanceof ApiError && err.code === "network"
          ? "Couldn't reach the server — that change didn't save."
          : "That didn't save. Try again in a moment.",
      );
      return false;
    }
  }

  /** Theme and accent, which have to repaint before the request leaves.
   *
   *  Build rule 5 calls the accent "live-switchable", and that is a claim
   *  about the tap, not about the round trip: a swatch that waits ~80ms for
   *  D1 reads as a broken button. So the document is restyled first and the
   *  save follows — and if the save fails, `save` puts the draft back and this
   *  puts the paint back with it, because a screen showing gold while the
   *  database holds coral is the disagreement the optimistic overlay exists to
   *  avoid, not to create.
   */
  async function saveTheme(patch: { theme?: Theme; accent?: Accent }) {
    if (!profile) return;
    const before = { theme: profile.theme, accent: profile.accent };
    const next = { ...before, ...patch };
    applyTheme(next.theme, next.accent);
    if (!(await save(patch))) applyTheme(before.theme, before.accent);
  }

  return { profile, save, saveTheme, error };
}

/** Goal weight, in whichever units are set.
 *
 *  This screen is where the hold-the-text-while-typing idiom was first written
 *  (#23), and #95 lifted it into `NumericField` for the confirm sheet's five
 *  numeric fields. Leaving the original here would be two statements of one
 *  rule — #86's register defect, on the very code that motivated the lift — so
 *  the copy is gone and this is now layout, units and the network write.
 *
 *  Blur-only, and that is the reason `live` is opt-in rather than the default:
 *  PATCHing per character writes "7", "77", "776" to a column Trends draws a
 *  line from, and the middle values are real saves that a dropped connection
 *  can leave behind.
 *
 *  Two behaviours changed with the lift, both deliberate. A figure at or below
 *  zero used to be dropped in silence; it now clamps and the field says so,
 *  because a discarded edit is indistinguishable from a field that never took
 *  the keystroke — the same complaint #95 is about. And letters now produce a
 *  visible `KEPT 78` rather than nothing, which `type="number"` used to hide
 *  by refusing to report them at all.
 *
 *  **The bounds are the shared ones, in the unit on screen (#99).** The field
 *  shipped with `min: 1` and no maximum, so 99,999 lb was a saveable goal
 *  while the route that stores every actual weigh-in had held 20–400 kg all
 *  along. `weightBounds` converts that window rounding *inward* — 881 lb, not
 *  882 — so the clamped figure this field hands to `lbToKg` is one the server
 *  accepts. Reading `p?.units` is what makes it the number being typed rather
 *  than the number being stored; those are different numbers here and the
 *  whole defect is the gap between them.
 */
function GoalWeightField({ edit }: { edit: ReturnType<typeof useProfileEdit> }) {
  const p = edit.profile;
  const imperial = p?.units === "imperial";
  const stored =
    p?.goal_weight_kg == null
      ? null
      : Math.round((imperial ? kgToLb(p.goal_weight_kg) : p.goal_weight_kg) * 10) / 10;
  const bounds = weightBounds(imperial ? "imperial" : "metric");

  return (
    <div className="field">
      <div className="field-pair">
        <NumericField
          value={stored}
          decimals={1}
          min={bounds.min}
          max={bounds.max}
          allowEmpty
          onCommit={(n) => void edit.save({ goal_weight_kg: imperial ? lbToKg(n) : n })}
          onClear={() => void edit.save({ goal_weight_kg: null })}
          ariaLabel={imperial ? "Goal weight in pounds" : "Goal weight in kilograms"}
          placeholder="—"
          disabled={!p}
        />
        <span className="mono">{imperial ? "LB" : "KG"}</span>
      </div>
      <span className="opt-hint">
        Drawn as the goal line on Trends. Leave it empty for no line — it doesn't change
        your budget, which follows your deficit.
      </span>
    </div>
  );
}

/** The escape hatch for #54's update flow.
 *
 *  A new build installs quietly and waits for the app to be closed, so nothing
 *  ever reloads the page mid-meal. The price of that is not knowing whether
 *  you're on the newest version — and the answer to "am I updated?" should not
 *  be "swipe the app closed and hope". This asks, and applies. */
function UpdateSection() {
  const { state, check, apply } = useUpdate();

  const copy: Record<typeof state, string> = {
    current: "You're on the latest version.",
    checking: "Checking…",
    available: "A new version is ready. It installs on its own next time you close the app.",
    updating: "Updating…",
  };

  return (
    <section>
      <div className="sec-head">
        <span className="eyebrow">App</span>
        <span className="mono">#54</span>
      </div>
      <p className="placeholder-note" role="status">
        {copy[state]}
      </p>
      {state === "available" ? (
        <button className="btn btn-quiet" onClick={() => void apply()} disabled={state !== "available"}>
          Update and reload now
        </button>
      ) : (
        <button
          className="btn btn-quiet"
          onClick={() => void check()}
          disabled={state === "checking" || state === "updating"}
        >
          Check for updates
        </button>
      )}
    </section>
  );
}

/** "night-athletic" → "Night Athletic". Units stay as stored, which is why
 *  this is a formatter and not text-transform on the whole value. */
function label(value: string) {
  return value
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
