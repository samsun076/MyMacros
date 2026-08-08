import { useState } from "react";
import type { SyncTokenCreated, SyncTokensResponse } from "../../shared/api";
import { ApiError, api, useApi } from "../lib/api";

/** Machine credentials for the debrief sync (#19).
 *
 *  The design constraint that shapes this whole component: only the hash is
 *  stored, so a token exists in readable form exactly once — in the response
 *  that created it. Everything here is about not wasting that one chance.
 */
export function SyncTokens() {
  const { data, error, reload } = useApi<SyncTokensResponse>("/api/sync-tokens");
  const [issued, setIssued] = useState<SyncTokenCreated | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setBusy(true);
    setFailed(null);
    try {
      setIssued(await api.post<SyncTokenCreated>("/api/sync-tokens", { name: "Sync" }));
      reload();
    } catch (err) {
      setFailed(
        (err instanceof ApiError ? err.code : "") === "too_many_tokens"
          ? "That's the limit — revoke one first."
          : "Couldn't issue a token.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setFailed(null);
    try {
      await api.del(`/api/sync-tokens/${id}`);
      // if the revoked one is still on screen, it's now useless — drop it
      if (issued?.id === id) setIssued(null);
      reload();
    } catch {
      setFailed("Couldn't revoke that token.");
    } finally {
      setBusy(false);
    }
  }

  const tokens = data?.tokens ?? [];

  return (
    <section>
      <div className="sec-head">
        <span className="eyebrow">Sync</span>
        <span className="mono">{tokens.length} TOKEN{tokens.length === 1 ? "" : "S"}</span>
      </div>

      <p className="opt-hint">
        Lets the script on your Mac push runs and weigh-ins. Each token is tied to your
        account only — it can write your rows and read nothing.
      </p>

      {/* Shown once and never again, so it says so plainly rather than
          leaving someone to discover it by navigating away. */}
      {issued && (
        <div className="token-reveal">
          <span className="eyebrow">
            <span className="tick" />
            Copy this now
          </span>
          <code className="token-value">{issued.token}</code>
          <button
            className="btn btn-quiet"
            onClick={() => {
              void navigator.clipboard?.writeText(issued.token).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <p className="opt-hint">
            Only the hash is stored, so this can't be shown again. Lose it and issue a
            new one — nothing else breaks.
          </p>
        </div>
      )}

      {error && (
        <p className="placeholder-note" role="alert">
          Couldn't load your tokens.
        </p>
      )}

      {tokens.length > 0 && (
        <dl className="kv">
          {tokens.map((t) => (
            <div key={t.id}>
              <dt>{t.name}</dt>
              <dd>
                <span className="mono">
                  {t.last_used_at ? `USED ${t.last_used_at.slice(0, 10)}` : "NEVER USED"}
                </span>
                <button className="btn-text" disabled={busy} onClick={() => void revoke(t.id)}>
                  Revoke
                </button>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <button className="btn btn-quiet" disabled={busy} onClick={() => void issue()}>
        {busy ? "Working…" : "Issue a sync token"}
      </button>
      {failed && (
        <p className="signin-error" role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}
