import { useState } from "react";
import { useNavigate } from "react-router";
import type { Me, WeightsResponse } from "../../shared/api";
import { displayWeight, lbToKg } from "../../shared/units";
import { weightBounds } from "../../shared/weight";
import { LoadFailureNote } from "../components/LoadFailureNote";
import { ApiError, api, useApi } from "../lib/api";
import { localDay } from "../lib/day";
import { useLoadFailure } from "../lib/load-failure";

/** Manual weigh-in (#18). Garmin's sync (#20) writes the same rows, which is
 *  why this screen is the fallback rather than the main event — but it is the
 *  one that works with no pipeline running, and onboarding needs it before a
 *  target can exist at all.
 *
 *  Shows the trend beside the raw number on purpose: the trend is what the
 *  budget actually follows (#18), and someone who sees only today's reading
 *  will read a two-pound water swing as progress or failure.
 */
export function Weight() {
  const meRead = useApi<Me>("/api/me");
  const weightsRead = useApi<WeightsResponse>("/api/weights");
  const reload = weightsRead.reload;
  const navigate = useNavigate();

  /* #24, and this screen had the sharper version of the defect: with `error`
     dropped, a failed `GET /api/weights` fell through to "No weigh-ins yet.
     The first one starts the trend." — a placeholder that is *false*. An empty
     state is a claim about the data, and it may only be made when the data is
     known to be empty.

     The profile matters here for a second reason beyond the copy: `units`
     decides whether the number being typed is pounds or kilograms. If it
     didn't load, the field is labelled from a default nobody chose, and a
     76 typed as kg and written as lb is the silent unit change this project
     has already been bitten by twice upstream (Garmin's grams, debrief's
     `energy_kj`). So a failed profile disables the save rather than guessing —
     the entry is one tap of Try again away, and the wrong unit is a row that
     moves the target and looks plausible for weeks. */
  const weightsFailure = useLoadFailure(weightsRead.error);
  const meFailure = useLoadFailure(meRead.error);
  const failure = weightsFailure ?? meFailure;
  const me = meFailure ? null : meRead.data;
  const data = weightsFailure ? null : weightsRead.data;

  const imperial = (me?.profile.units ?? "imperial") === "imperial";
  const unit = imperial ? "LB" : "KG";

  const [entry, setEntry] = useState("");
  const [on, setOn] = useState(localDay());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The window the route already enforces, read in the unit on screen (#99).
   *
   *  This field is not the one #99 was reported against — it has always had a
   *  ceiling, because `POST /api/weights` has one and refusing a save is what
   *  put "That doesn't look like a weight in lb" below the button. What it did
   *  not have was that ceiling *before* the round trip, so the only way to
   *  learn 900 lb is too heavy was to try it; and the silent half was worse —
   *  `n <= 0` dropped the tap with no error and no request, which is a dead
   *  button. Both now answer in the unit being typed, from the one source. */
  const bounds = weightBounds(imperial ? "imperial" : "metric");

  async function save() {
    const n = Number(entry);
    if (!Number.isFinite(n)) return;
    if (n < bounds.min || n > bounds.max) {
      setError(`A weigh-in has to be between ${bounds.min} and ${bounds.max} ${unit.toLowerCase()}.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/weights", {
        measured_on: on,
        weight_kg: imperial ? lbToKg(n) : n,
      });
      setEntry("");
      reload();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "network";
      setError(
        code === "invalid_weight"
          ? `That doesn't look like a weight in ${unit.toLowerCase()}.`
          : code === "network"
            ? "Couldn't reach the server — try again in a moment."
            : "That didn't save.",
      );
    } finally {
      setSaving(false);
    }
  }

  /** Deleting a weigh-in (#71). No confirmation step, deliberately: it is
   *  reversible in two taps on this same screen — typing the weight back also
   *  clears the tombstone the delete wrote — and a modal in front of a
   *  reversible action is friction that teaches people to tap through modals.
   *
   *  It does move the target, which is why the row disappearing isn't the only
   *  feedback: `reload()` redraws the trend beside it. */
  async function remove(measured_on: string) {
    setSaving(true);
    setError(null);
    try {
      await api.del(`/api/weights/${measured_on}`);
      reload();
    } catch {
      setError("Couldn't delete that weigh-in.");
    } finally {
      setSaving(false);
    }
  }

  const trend = data?.trend_kg === null || data?.trend_kg === undefined
    ? null
    : displayWeight(data.trend_kg, imperial ? "imperial" : "metric");
  const latest = data?.latest ? displayWeight(data.latest.weight_kg, imperial ? "imperial" : "metric") : null;

  return (
    <main className="frame onboard">
      <header className="log-top">
        <span className="eyebrow">
          <span className="tick" />
          Weigh-in
        </span>
        <button className="cam-x" aria-label="Close" onClick={() => void navigate("/")}>
          ✕
        </button>
      </header>

      {failure && (
        <LoadFailureNote
          /* The subject that failed (see Today). A failed profile is the one
             that also holds the save button, and saying "your weigh-ins" over
             a list that arrived fine would point at the wrong thing. */
          what={weightsFailure ? "Your weigh-ins" : "Your profile"}
          failure={failure}
          onRetry={() => {
            weightsRead.reload();
            meRead.reload();
          }}
        />
      )}

      <section>
        <div className="field">
          <span className="eyebrow">Today's weight</span>
          <div className="field-pair">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              autoFocus
              aria-label={`Weight in ${imperial ? "pounds" : "kilograms"}`}
              value={entry}
              placeholder={latest ? String(latest.value) : ""}
              onChange={(e) => setEntry(e.target.value)}
            />
            <span className="mono">{unit}</span>
          </div>
        </div>

        <div className="field">
          <span className="eyebrow">Date</span>
          <input
            type="date"
            value={on}
            max={localDay()}
            onChange={(e) => setOn(e.target.value)}
          />
          <span className="opt-hint">
            Weighing in twice for one day replaces it rather than adding a second reading.
          </span>
        </div>

        {/* `meFailure`, not `failure`: a failed weigh-in *list* costs the trend
            and the recent rows, and there is no reason a new reading can't be
            written without them. A failed *profile* is the one that makes the
            unit a guess (see above). */}
        <button
          className="btn btn-accent"
          disabled={saving || !entry.trim() || meFailure !== null}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Log weight"}
        </button>
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section>
        <div className="sec-head">
          <span className="eyebrow">Trend</span>
          <span className="mono">7-DAY</span>
        </div>
        {trend ? (
          <>
            <div className="hero-row">
              <span className="hero-num">{trend.value}</span>
              <span className="hero-of">{trend.unit}</span>
            </div>
            <p className="opt-hint">
              Smoothed over the last 7 days — this is the number your budget follows, not
              the reading on any one morning.
            </p>
          </>
        ) : data ? (
          /* Only once the list has actually landed. "No weigh-ins yet" is a
             claim about the data, and until `data` is non-null the only true
             statement is the card above (#24). */
          <p className="placeholder-note">No weigh-ins yet. The first one starts the trend.</p>
        ) : null}
      </section>

      {data?.entries.length ? (
        <section>
          <div className="sec-head">
            <span className="eyebrow">Recent</span>
          </div>
          <dl className="kv">
            {[...data.series]
              .reverse()
              .slice(0, 14)
              .map((point) => {
                const raw = displayWeight(point.weight_kg, imperial ? "imperial" : "metric");
                const smooth = displayWeight(point.trend_kg, imperial ? "imperial" : "metric");
                return (
                  <div key={point.measured_on}>
                    <dt>
                      {point.measured_on}
                      {/* Where the number came from. Worth saying because the
                          two behave differently on delete (#71): removing a
                          scale reading writes a tombstone to stop the sync
                          re-adding it, and a row you typed outranks anything
                          Garmin sends for that day (#68). Same number on
                          screen, different rules behind it. */}
                      <span className="src">{sourceOf(data, point.measured_on)}</span>
                    </dt>
                    <dd>
                      {raw.value} {raw.unit}
                      <span className="mono"> · TREND {smooth.value}</span>
                      <button
                        className="btn-text"
                        disabled={saving}
                        aria-label={`Delete the ${point.measured_on} weigh-in`}
                        onClick={() => void remove(point.measured_on)}
                      >
                        Delete
                      </button>
                    </dd>
                  </div>
                );
              })}
          </dl>
        </section>
      ) : null}
    </main>
  );
}

/** "SCALE" or "TYPED" for a day. `series` carries the smoothing and `entries`
 *  carries the rows, so the source has to be looked up rather than read off
 *  the point — and `weights` is unique per user per day, so there is exactly
 *  one answer. */
function sourceOf(data: WeightsResponse, measured_on: string) {
  const entry = data.entries.find((e) => e.measured_on === measured_on);
  return entry?.source === "manual" ? "TYPED" : "SCALE";
}
