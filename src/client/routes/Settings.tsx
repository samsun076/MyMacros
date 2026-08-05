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

      <ViewportReadout />

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

/** TEMPORARY — #51. Remove with the inline sampler in index.html.
 *
 *  The sampler in index.html records how the layout viewport moves during a
 *  cold standalone launch. Reading it needs a console, a console needs Web
 *  Inspector, and Web Inspector needs a cable that isn't to hand — so the app
 *  prints its own measurement instead. Client-side navigation doesn't reload
 *  the page, so walking here after a launch still finds that launch's data.
 *
 *  The load timings matter as much as the viewport series now: the first
 *  round measured the app's own JS starting at t=2725ms, which is the white
 *  screen, and is the thing actually worth explaining.
 *
 *  Fixed-width columns because this gets read off a phone screenshot. */
function ViewportReadout() {
  const vp = (window as unknown as { __vp?: ViewportLog }).__vp;
  if (!vp) return null;

  const pad = (n: number | string, w: number) => String(n).padStart(w);
  const lines = [
    "   ms  inner client scroll visual scale",
    ...vp.changes.map(
      (c) =>
        `${pad(c.t, 5)}${pad(c.innerWidth, 7)}${pad(c.clientWidth, 7)}` +
        `${pad(c.scrollWidth, 7)}${pad(c.visualWidth, 7)}${pad(c.scale.toFixed(2), 6)}`,
    ),
  ];

  // when each thing finished, relative to navigation start — what took the
  // 2.7s before the app's own code ran
  const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const end = (match: (name: string) => boolean) => {
    const hit = res.find((r) => match(r.name));
    return hit ? `${Math.round(hit.responseEnd)}ms` : "—";
  };
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;

  const timings = [
    `html         ${nav ? `${Math.round(nav.responseEnd)}ms` : "—"}`,
    `google fonts ${end((n) => n.includes("fonts.googleapis.com"))}`,
    `font files   ${end((n) => n.includes("fonts.gstatic.com"))}`,
    `app css      ${end((n) => n.includes("/assets/") && n.endsWith(".css"))}`,
    `app js       ${end((n) => n.includes("/assets/") && n.endsWith(".js"))}`,
    `dom ready    ${nav ? `${Math.round(nav.domContentLoadedEventEnd)}ms` : "—"}`,
  ];

  return (
    <section>
      <div className="sec-head">
        <span className="eyebrow">Viewport</span>
        <span className="mono">#51 · temporary</span>
      </div>
      <pre className="vp-readout">
        {`${vp.screen} dpr${vp.dpr} ${vp.displayMode} standalone=${vp.standalone}\n` +
          `${vp.changes.length} sample(s), first at ${vp.changes[0]?.t ?? "?"}ms\n\n` +
          lines.join("\n") +
          `\n\nLOAD (responseEnd from navigation start)\n` +
          timings.join("\n")}
      </pre>
    </section>
  );
}

type ViewportLog = {
  screen: string;
  dpr: number;
  standalone: boolean | null;
  displayMode: string;
  changes: {
    t: number;
    innerWidth: number;
    clientWidth: number;
    scrollWidth: number;
    visualWidth: number;
    scale: number;
  }[];
};

/** "night-athletic" → "Night Athletic". Units stay as stored, which is why
 *  this is a formatter and not text-transform on the whole value. */
function label(value: string) {
  return value
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
