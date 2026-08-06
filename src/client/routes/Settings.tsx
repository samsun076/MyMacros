import type { Me } from "../../shared/api";
import { PasskeyManager } from "../components/PasskeyManager";
import { useApi } from "../lib/api";
import { authClient } from "../lib/auth";

/** The real settings screen — TDEE inputs, deficit, macro split, eat-back,
 *  theme switcher — is #23 and #29. What's here already works: the account,
 *  and passkey management, which needs a live session to register against. */
export function Settings() {
  const { data: me, error } = useApi<Me>("/api/me");

  return (
    <>
      <header>
        <span className="eyebrow">
          <span className="tick" />
          Settings
        </span>
        <h1>{me?.user.name || me?.user.email || "Account"}</h1>
      </header>

      {error && (
        <p className="placeholder-note" role="alert">
          Couldn't load your profile — check your connection and reopen this screen.
        </p>
      )}

      <PasskeyManager />

      <section>
        <div className="sec-head">
          <span className="eyebrow">Budget</span>
          <span className="mono">M4 · #17, #21</span>
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
          <div>
            <dt>Eat-back</dt>
            <dd>{me ? `${me.profile.eat_back_pct}%` : "—"}</dd>
          </div>
          <div>
            <dt>Focus macro</dt>
            <dd>{me ? label(me.profile.focus_macro) : "—"}</dd>
          </div>
          <div>
            <dt>Theme</dt>
            <dd>
              {me ? `${label(me.profile.theme)} · ${label(me.profile.accent)}` : "—"}
            </dd>
          </div>
        </dl>
        <p className="placeholder-note">
          Read-only until the settings screen lands — editing these is #23,
          the theme and accent pickers are #29.
        </p>
      </section>

      <button className="btn btn-quiet" onClick={() => void authClient.signOut()}>
        Sign out
      </button>
    </>
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
