import { useState } from "react";
import type { SyncSourceHealth, SyncTokenCreated, SyncTokensResponse } from "../../shared/api";
import { ApiError, api, useApi } from "../lib/api";
import { fmtDayAgo } from "../lib/format";
import { useLoadFailure } from "../lib/load-failure";
import { LoadFailureNote } from "./LoadFailureNote";

/** Settings → Sources (#19, #69).
 *
 *  Was a list of tokens; it is a list of what feeds this app. The two are
 *  almost the same data and not at all the same question — nobody wonders
 *  whether a credential is valid, they wonder whether their weigh-ins are
 *  still arriving. Sixteen consecutive Garmin failures went unnoticed here
 *  because the screen could only answer the first one.
 *
 *  Deliberately NOT a set of on/off toggles. The launchd job on the Mac owns
 *  the schedule, and this endpoint would accept pushes regardless — a switch
 *  here would be UI that lies. Revoking the credential is the real off switch
 *  and it already exists, so the panel names it as one. Toggles become
 *  honest once the Worker owns the cron (#70).
 *
 *  The design constraint that shapes the token half: only the hash is stored,
 *  so a token exists in readable form exactly once — in the response that
 *  created it. Everything there is about not wasting that one chance.
 */

/** Deployment-neutral on purpose (#37): the feed is "runs", not "debrief".
 *  Which collector fills it is this deployment's business, and #70 changes the
 *  answer for weigh-ins without changing what the user is looking at. */
const FEED_LABEL: Record<SyncSourceHealth["source"], string> = {
  runs: "Runs",
  weights: "Weigh-ins",
};

function FeedRow({ feed }: { feed: SyncSourceHealth }) {
  const when = fmtDayAgo(feed.last_success_at).toUpperCase();

  return (
    <div>
      <dt>{FEED_LABEL[feed.source]}</dt>
      <dd>
        {/* "QUIET SINCE" rather than "LAST SEEN", and it carries the state in
            words rather than leaning on colour — this is the screen someone
            opens *because* something looks wrong, so which row is the problem
            has to survive a greyscale glance. */}
        <span className={feed.stale ? "mono feed-stale" : "mono"}>
          {feed.stale ? `QUIET SINCE ${when}` : `OK · ${when}`}
        </span>

        {/* Only for a healthy feed. On a stale one the count describes a
            check-in we have just said not to trust, and "2 items" beside a
            warning reads as two things *pending* rather than two things that
            arrived three days ago.

            Zero is a healthy answer, though — a collector that ran and found
            nothing new — and saying so is what stops silence meaning two
            different things. */}
        {!feed.stale && (
          <span className="opt-hint feed-count">
            {feed.last_item_count === 0
              ? "nothing new"
              : `${feed.last_item_count} item${feed.last_item_count === 1 ? "" : "s"}`}
          </span>
        )}
      </dd>
    </div>
  );
}

export function Sources() {
  const read = useApi<SyncTokensResponse>("/api/sync-tokens");
  /* #24. Same card as every other failed read, and the same reason it is not
     five sentences in five files: what changed here is that the note now says
     whether the phone is offline or the server broke, and carries the retry
     `useApi` was already handing out. */
  const failure = useLoadFailure(read.error);
  const data = failure ? null : read.data;
  const reload = read.reload;
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
  const sources = data?.sources ?? [];
  const stale = sources.filter((s) => s.stale).length;

  return (
    <section>
      <div className="sec-head">
        <span className="eyebrow">Sources</span>
        <span className={stale ? "mono feed-stale" : "mono"}>
          {/* Blank until the read lands, because "NONE YET" is a claim about
              the data and it would otherwise be made over the failure card
              below saying the data never arrived (#24). Every other empty
              state in the app is gated the same way now. */}
          {!data
            ? ""
            : sources.length === 0
              ? "NONE YET"
              : stale
                ? `${stale} STALE`
                : `${sources.length} OK`}
        </span>
      </div>

      <p className="opt-hint">
        What feeds this app. Each credential below is tied to your account only — it can
        write your rows and read nothing.
      </p>

      {sources.length > 0 && (
        <dl className="kv">
          {sources.map((s) => (
            <FeedRow key={s.source} feed={s} />
          ))}
        </dl>
      )}

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

      {failure && (
        <LoadFailureNote what="Your sources" failure={failure} onRetry={reload} />
      )}

      {/* A credential is not a feed, and without this they render as sibling
          rows in adjacent lists — "Dave's Mac" reads as a third source. */}
      {tokens.length > 0 && (
        <div className="sec-head sec-head-sub">
          <span className="eyebrow">Credentials</span>
          <span className="mono">
            {tokens.length} TOKEN{tokens.length === 1 ? "" : "S"}
          </span>
        </div>
      )}

      {tokens.length > 0 && (
        <dl className="kv">
          {tokens.map((t) => (
            <div key={t.id}>
              <dt>{t.name}</dt>
              <dd>
                <span className="mono">
                  {t.last_used_at ? `USED ${fmtDayAgo(t.last_used_at).toUpperCase()}` : "NEVER USED"}
                </span>
                {/* revoking is the off switch — there is no toggle above for
                    the reason in this file's header */}
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
