import { Link } from "react-router";
import type { Me } from "../../shared/api";
import { PasskeyManager } from "../components/PasskeyManager";
import { Sources } from "../components/Sources";
import { useApi } from "../lib/api";
import { authClient } from "../lib/auth";

/** The real settings screen — TDEE inputs, deficit, protein anchor, eat-back,
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
        {/* The way back into #17's flow. Without this, onboarding is a
            one-shot: Today only offers it while `onboarded` is false, so
            finishing it removed the only link to it and there was no way to
            change a deficit or a goal again. The full field-by-field settings
            screen is still #23; this is #17's own flow staying reachable. */}
        <Link className="btn btn-quiet" to="/onboarding">
          Edit budget inputs
        </Link>
        <p className="placeholder-note">
          Opens the setup flow with your current numbers in it. Editing each field
          in place is #23; the theme and accent pickers are #29.
        </p>
      </section>

      {/* The weigh-in link used to live here, and Settings was the wrong home
          for a daily action — two taps into a settings screen. It moved to
          Trends with #22, which is one tap from the tab bar and the screen
          where you'd already be looking at the number. `/weight` is still its
          own route; only the entry point moved, so nothing is duplicated. */}

      <Sources />

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
