# Design tokens & motif slots

Themes are **semantic token packs** (`design/tokens.css`) applied via
`data-theme` on `<html>`; Night Athletic's switchable accent stacks on top via
`data-accent` (`coral` default / `gold` / `mint`). Both attributes are per-user
settings stored in `profiles`. One layout, one component tree — a theme never
forks a component, with the sole exception of the motif slots below.

## Schema

| Token | Job |
|---|---|
| `--canvas` | Page-behind color (desktop letterbox, overscroll) |
| `--page-surface` | Full `background` value for the app frame — gradient wash in Night Athletic, a flat color in the light packs |
| `--bg-top` / `--bg` / `--bg-bottom` | Wash stops; `--bg-top` is also the `theme-color` meta for the top |
| `--surface` / `--surface-raised` | Cards; raised = elevated gradient stop |
| `--viewfinder-surface` | Full `background` for the camera stage (#13) — darker than `--page-surface` so a live preview reads as the lit thing on screen. Same job as `--page-surface`: a flat theme swaps in one color. The camera is **not** a motif slot; it re-skins through this one token with no per-theme code |
| `--chrome` | Bottom-bar surface. iOS Safari blends its own chrome with it, so it extends through the safe area with **zero seam**, is **never accent-tinted**, and must be applied **fully opaque** — Safari won't tint from translucent or backdrop-filtered edges (field-tested on device vs Field Notes) |
| `--on-chrome` / `--on-chrome-active` | Ink **on** the bottom bar, which is a different surface from the page and may be a different world (#30). Night Athletic's chrome is a shade of its page, so these are the page's own `--ink-muted` and `--accent`; Field Notes' is a pine notebook cover under ivory paper, where page ink is invisible and both are paper. The tab bar must never reach for `--ink-*` directly |
| `--track` | Empty meter/bar track |
| `--line` / `--line-soft` | Hairlines |
| `--ink` / `--ink-secondary` / `--ink-muted` | Text tiers (Night Athletic: no pure white anywhere) |
| `--mark-neutral` | Non-focus data marks — deliberately recessive, ≥3:1 on `--surface` |
| `--positive` | "Trending the right way" (e.g. weight delta on a cut) |
| `--danger` / `--on-danger` | Destructive actions (#52's trash panel) and the one state where the app's own question answers "no" — a surplus across the whole trends window while the goal is a cut (#22). **Never `--accent`**: rule 8 spends accent on the focus macro, and Night Athletic switches it live, so an alert built on it changes colour when the user picks gold. Deliberately narrow — a single high week is noise, and every red pixel on the trends screen is a judgment about a body |
| `--accent` + `--accent-soft/-wash/-glow`, `--on-accent` | The one hero color; soft = hatch/dim marks, wash = tinted fills, glow = page-top radial, on-accent = ink on accent |
| `--display-font` / `--body-font` / `--numeral-font` / `--data-font` | Numerals always set `font-variant-numeric: tabular-nums`; data-font is timestamps/scales/micro-captions |
| `--radius-card/-thumb/-button/-mark/-pill` | Shape scale; `-pill` is fully-rounded ends (accent tick, chips) |
| `--shadow-lift` | The accent buttons' lift (log button, primary action) — drop plus inset bottom highlight. A theme's *material*, not a constant: Night Athletic's deep blue-black drop means nothing on Field Notes' ivory paper, so each pack sets its own |
| `--shadow-card` / `--shadow-sheet` | Elevation for raised cards (run card, toast) and the confirm bottom sheet — same material caveat as `--shadow-lift` |
| `--scrim` | Dim wash behind the confirm sheet |
| `--meter-height` / `--macro-bar-height` / `--week-bar-height` | Meter metrics; the last is trends' weekly intake bar (#22), sized so a dozen stack while the earned hatch still reads |
| `--tabbar-height` | Bottom chrome height, excluding the safe area. Screens pad their bottom by it so the fixed bar never covers content |
| `--hero-num-size` | The budget figure, in **this pack's numeral face** (#30). 86px is a Barlow Condensed measurement; Courier Prime sets the same four digits ~40% wider and broke the hero onto three lines, so the size travels with the font rather than living in the shared layer |

Mapping from the sketch's local names (`sketches/c2-night-athletic.html`):
`--bg-page→--canvas`, `--bg-low→--bg-bottom`, `--surface-2→--surface-raised`,
`--ink-2→--ink-secondary`, `--muted→--ink-muted`, `--good→--positive`,
`--accent-dim→--accent-soft`, `--accent-ink→--on-accent`,
`--disp/--body/--mono→--display-font/--body-font/--data-font`.

## Motif slots — the only per-theme components

Everything else re-skins through tokens; these four render **named per-theme
variants**. All three packs are ported as of #30 — there are no placeholder
variants left, and `MOTIFS` is a `Record<Theme, MotifSet>`, so a new theme
without all four is a compile error rather than a review note.

1. **Earned-kcal annotation** — how "+340 kcal earned" is celebrated.
   Night Athletic: hatched fuel-zone extension (45° `--accent-soft` hatch,
   solid `--accent` boundary tick) + matching legend swatch. Field Notes:
   vermilion rubber stamp. Instrument: machined groove.
   **Also carries the stale state (#69).** This slot rendering nothing is how
   a dead sync used to disappear — no runs synced looks exactly like no runs
   taken — so when `staleSince` is set it speaks instead of going silent.
   Night Athletic: the same 135° hatch drained of accent (`--ink-muted`),
   with `--ink-muted` text. Never accent-coloured: accent here would read as
   something earned. Recessive on purpose — the likeliest cause is a laptop
   that's shut, and the screen is still about food.
2. **Budget meter** — the hero meter. Night Athletic: 18px rounded bar, solid
   accent fill, hatched earned extension. Instrument: dial. Field Notes:
   ledger bar. Convention regardless of theme: **base target and earned bonus
   always draw separately** — base length plus a visually distinct earned
   extension, never one merged number.
3. **Log button** — Night Athletic: 58px rounded-square accent button lifted
   above the tab bar. Field Notes: a vermilion disc *ringed in paper* rather
   than lifted, so it sits on the sheet. Instrument: a machined knob — radial
   highlight, deep accent rim, and a ring stack (lit edge, paper gap, milled
   ring, short drop) that seats it in the panel.
4. **Timeline row chrome** — the rail and the run card's elevation treatment.
   Night Athletic: hairline rail at a fixed inset, gradient card. Rail narrows
   below 390px (see sketch).
   **Narrowed by #80: no node dots.** The slot read "rail, node dots, accent
   run dot" until the dot was measured against the just-saved wash — the dot
   occupied 59.5→65.5px and the wash's inset accent bar starts at 66px, a
   0.5px gap, with *both* drawn in `--accent` on a fresh entry. Two accent
   marks half a pixel apart, meaning the same thing, read as a rendering
   fault. The rail carries the structure; the dot was the collision.
   This is a change to frozen ground truth and every theme pack inherits it:
   the sketches still draw dots and a run row marked by an accent dot
   (c2-night-athletic.html), and a pack must **not** port either. A run row,
   if one is ever built, needs a mark that isn't a dot — and the newest-first
   order #80 also introduced would place a morning run at the bottom of the
   day regardless, so that design is open rather than merely unported.

## Cross-theme conventions

- **Focus macro:** `--accent` on a macro bar means *the macro being targeted*
  (default protein; per-user in `profiles`). Other macros use
  `--mark-neutral`. The focused row carries a small accent tick under its
  label (Night Athletic: same tick motif as the masthead) and a screen-reader
  suffix "— focus macro". Applies across all themes and accent choices.
- **Anything accent-colored references `--accent`** — Night Athletic users
  switch it live (build rule 5).
- **375px is the reference width** (iPhone 13 mini). Verify with
  `node tools/shot-matrix.mjs` before calling any screen done.
- **Safari chrome blend, field-tested:** in-browser iOS Safari paints its
  *top* chrome from the document (body) background — `theme-color` is
  ignored — so on phone widths the body background is `--bg-top`. Its
  *bottom* bar + home-indicator strip derive from the page's bottom-edge
  content, but only if that surface is opaque; the tab bar is solid
  `--chrome`, no alpha, no backdrop blur. (`theme-color` meta stays at
  `--bg-top` for the standalone/PWA case.)

## Mark-color validation (dataviz pass)

All three accents vs `--mark-neutral` on `--surface` (dark), via the dataviz
palette validator: CVD separation **passes** (worst adjacent ΔE 16.4 protan,
coral), normal-vision separation passes (ΔE ≥ 22), contrast vs surface ≥3:1
passes. Two categorical-palette checks intentionally deviate: accents sit
above the series-lightness band (they are hero colors, not series colors) and
`--mark-neutral`'s chroma is below the "reads gray" floor *by design* — it is
the recessive non-focus mark, and every mark it colors is direct-labeled
(PROTEIN / CARBS / FAT rows, labeled spark). Identity is never color-alone.

### `--danger` (#22), and the one thing it can't do

`#f36884` — 5.23:1 on `--surface` (clears AA for body text; comparable to
`--ink-muted`'s 5.22, the pack's own floor for readable text). Only one accent
is ever live, so the bar is separation from whichever the user picked:

| vs the active accent | normal | protan | deutan |
|---|---|---|---|
| coral | 18.8 | 21.7 | 11.1 |
| gold | 40.8 | 29.8 | 15.8 |
| mint | 65.9 | 21.5 | 10.6 |

**Under deuteranopia it does not clearly separate, and no color would.** A
hue sweep of the whole red-through-rose range at every lightness that clears
5.2:1 tops out at ΔE ≈ 10.9 worst-case — reds converge with coral, roses
converge with mint, and the two failures cross before either clears. This is
the color space, not the search. It is acceptable here for the same reason the
deviations above are: **every use is direct-labeled and sign-carrying** — the
trends figure reads "+ 120 kcal / day" with a sentence under it, and #52's
trash panel is a glyph, not a swatch. Do not fix this by tinting toward
`--accent`; that reintroduces the switchable-alert problem the token exists to
solve.
