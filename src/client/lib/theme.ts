import { useSyncExternalStore } from "react";
import type { Accent, Theme } from "../../shared/api";
import { PROFILE_DEFAULTS } from "../../shared/profile";

/** Theme and accent, applied (#29).
 *
 *  `profiles.theme` / `profiles.accent` are the source. This module is the one
 *  place that turns them into `data-theme` / `data-accent` on `<html>`, which
 *  is what `design/tokens.css` and `motifs/index.ts` both read.
 */

export type ThemePack = {
  label: string;
  hint: string;
  /** **Whether `design/tokens.css` actually defines this pack.**
   *
   *  Not cosmetic and not a preference: a pack that isn't ported has no token
   *  values of its own, so choosing it would give you Night Athletic under a
   *  different name — an option that silently does nothing. Offering that is
   *  worse than not offering it, which is why the control is disabled and says
   *  which issue brings it.
   *
   *  `tools/theme-packs.test.mjs` cross-checks every one of these against the
   *  stylesheet, in both directions: a pack marked ready with no `[data-theme]`
   *  block fails, and so does a block that exists while the flag still says
   *  false. #30 flips these in the same commit that writes the values. */
  ready: boolean;
};

export const THEME_PACKS: Record<Theme, ThemePack> = {
  "night-athletic": { label: "Night Athletic", hint: "Blue hour, 5:45 AM", ready: true },
  "field-notes": { label: "Field Notes", hint: "Warm ivory ledger, vermilion stamp", ready: true },
  instrument: { label: "Instrument", hint: "Bone paper, machined dial", ready: true },
};

/** Night Athletic's switchable accent (build rule 5). A Night Athletic
 *  feature only — the light packs each have one accent, which is their
 *  material rather than a choice. */
/** `label` is what fits in a segmented button at 375px; `name` is the
 *  sketch's own wording, kept for the accessible name because "Coral" alone
 *  is a colour and "Dawn coral" is the one in the design. Two lines of wrapped
 *  uppercase in a 100px-wide control is not the mark the sketch drew. */
export const ACCENTS: Record<Accent, { label: string; name: string }> = {
  coral: { label: "Coral", name: "Dawn coral" },
  gold: { label: "Gold", name: "Warm gold" },
  mint: { label: "Mint", name: "Mint" },
};

export function hasAccentChoice(theme: Theme): boolean {
  return theme === "night-athletic";
}

const STORE_KEY = "mymacros.theme";

/* The document attribute is the source for *tokens* — CSS reads it directly —
 * but React components that branch on the theme (the motif registry) need to
 * be told when it moves. Before #30 nothing did: `applyTheme` swapped the
 * attribute, every token repainted, and the motif COMPONENTS kept rendering
 * the previous theme's until something else re-rendered them. Invisible while
 * only one pack existed, and on a light-theme user's first-ever load it showed
 * as Night Athletic's rounded-square log button wearing Field Notes' colours.
 *
 * `useSyncExternalStore` rather than a context: the writer is `applyTheme`,
 * which is called from an event handler and from an effect, and neither has a
 * provider in scope. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function currentTheme(): Theme {
  const theme = document.documentElement.dataset.theme;
  return theme && theme in THEME_PACKS ? (theme as Theme) : PROFILE_DEFAULTS.theme;
}

/** The active theme, re-rendering the caller when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => PROFILE_DEFAULTS.theme);
}

/** Put a theme on the document, now.
 *
 *  Attributes first so the repaint happens in the same frame as the tap —
 *  build rule 5's "live-switchable" is a claim about the accent changing under
 *  your finger, not after a round trip.
 */
export function applyTheme(theme: Theme, accent: Accent): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;

  /* The UA canvas is white until something says otherwise, and `color-scheme`
     in the token pack only applies once the stylesheet is parsed — which is
     the window index.html's own meta covers. Keep the two in step, or a
     light-theme user gets #53's white flash in reverse. */
  const scheme = getComputedStyle(root).getPropertyValue("color-scheme").trim();
  if (scheme) document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", scheme);

  /* Inert in standalone — settled by #39 — and kept for iOS Safari in-browser
     and for whatever installs the app next. It cannot be static in the HTML
     when the theme is per-user. */
  const bgTop = getComputedStyle(root).getPropertyValue("--bg-top").trim();
  if (bgTop) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bgTop);

  /* A paint-time hint, NOT a second source.
   *
   * `/api/me` is authoritative and overwrites this on every load. What it buys
   * is the frame before that answers: the boot skeleton in index.html paints
   * from the inlined stylesheet with no session and no network, so without a
   * mirror a Field Notes user watches their app start dark and flip. Same
   * category as `profiles.target_kcal` — a cache with exactly one writer, and
   * nothing computes anything from it. */
  try {
    localStorage.setItem(STORE_KEY, `${theme} ${accent}`);
  } catch {
    /* Private modes throw on write. A flash on boot is not worth an exception
       on the path that renders the app. */
  }

  // CSS already repainted off the attribute; this is for the components that
  // branch on the theme rather than read a token — see the note by `subscribe`.
  for (const listener of listeners) listener();
}

/** The mirror, for the inline boot script in index.html to read.
 *
 *  Exported so the shape lives beside its writer rather than only inside a
 *  string of HTML. The boot script is deliberately its own tiny copy of the
 *  parse — it has to run before any module loads, so it cannot import this.
 */
export function readStoredTheme(): { theme: Theme; accent: Accent } {
  const fallback = { theme: PROFILE_DEFAULTS.theme, accent: PROFILE_DEFAULTS.accent };
  try {
    const [theme, accent] = (localStorage.getItem(STORE_KEY) ?? "").split(" ");
    return {
      theme: theme && theme in THEME_PACKS ? (theme as Theme) : fallback.theme,
      accent: accent && accent in ACCENTS ? (accent as Accent) : fallback.accent,
    };
  } catch {
    return fallback;
  }
}
