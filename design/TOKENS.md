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
| `--chrome` | Bottom-bar surface. iOS Safari blends its own chrome with it, so it extends through the safe area with **zero seam**, is **never accent-tinted**, and must be applied **fully opaque** — Safari won't tint from translucent or backdrop-filtered edges (field-tested on device vs Field Notes) |
| `--track` | Empty meter/bar track |
| `--line` / `--line-soft` | Hairlines |
| `--ink` / `--ink-secondary` / `--ink-muted` | Text tiers (Night Athletic: no pure white anywhere) |
| `--mark-neutral` | Non-focus data marks — deliberately recessive, ≥3:1 on `--surface` |
| `--positive` | "Trending the right way" (e.g. weight delta on a cut) |
| `--accent` + `--accent-soft/-wash/-glow`, `--on-accent` | The one hero color; soft = hatch/dim marks, wash = tinted fills, glow = page-top radial, on-accent = ink on accent |
| `--display-font` / `--body-font` / `--numeral-font` / `--data-font` | Numerals always set `font-variant-numeric: tabular-nums`; data-font is timestamps/scales/micro-captions |
| `--radius-card/-thumb/-button/-mark` | Shape scale |
| `--meter-height` / `--macro-bar-height` | Meter metrics |

Mapping from the sketch's local names (`sketches/c2-night-athletic.html`):
`--bg-page→--canvas`, `--bg-low→--bg-bottom`, `--surface-2→--surface-raised`,
`--ink-2→--ink-secondary`, `--muted→--ink-muted`, `--good→--positive`,
`--accent-dim→--accent-soft`, `--accent-ink→--on-accent`,
`--disp/--body/--mono→--display-font/--body-font/--data-font`.

## Motif slots — the only per-theme components

Everything else re-skins through tokens; these four render **named per-theme
variants** (placeholder variants OK until the M5 port, per build rule 3):

1. **Earned-kcal annotation** — how "+340 kcal earned" is celebrated.
   Night Athletic: hatched fuel-zone extension (45° `--accent-soft` hatch,
   solid `--accent` boundary tick) + matching legend swatch. Field Notes:
   vermilion rubber stamp. Instrument: machined groove.
2. **Budget meter** — the hero meter. Night Athletic: 18px rounded bar, solid
   accent fill, hatched earned extension. Instrument: dial. Field Notes:
   ledger bar. Convention regardless of theme: **base target and earned bonus
   always draw separately** — base length plus a visually distinct earned
   extension, never one merged number.
3. **Log button** — Night Athletic: 58px rounded-square accent button lifted
   above the tab bar. Light themes restyle shape/shadow per their material.
4. **Timeline row chrome** — rail, node dots, and the run card's elevation
   treatment. Night Athletic: hairline rail at a fixed inset, accent dot for
   the run, gradient card. Rail narrows below 390px (see sketch).

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
