import { useState } from "react";
import { useNavigate } from "react-router";
import type { Me, WeightsResponse } from "../../shared/api";
import { displayWeight, lbToKg } from "../../shared/units";
import { ApiError, api, useApi } from "../lib/api";
import { localDay } from "../lib/day";

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
  const { data: me } = useApi<Me>("/api/me");
  const { data, reload } = useApi<WeightsResponse>("/api/weights");
  const navigate = useNavigate();

  const imperial = (me?.profile.units ?? "imperial") === "imperial";
  const unit = imperial ? "LB" : "KG";

  const [entry, setEntry] = useState("");
  const [on, setOn] = useState(localDay());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const n = Number(entry);
    if (!Number.isFinite(n) || n <= 0) return;
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

        <button className="btn btn-accent" disabled={saving || !entry.trim()} onClick={() => void save()}>
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
        ) : (
          <p className="placeholder-note">No weigh-ins yet. The first one starts the trend.</p>
        )}
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
                    <dt>{point.measured_on}</dt>
                    <dd>
                      {raw.value} {raw.unit}
                      <span className="mono"> · TREND {smooth.value}</span>
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
