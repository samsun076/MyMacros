# Next steps — session playbook

State as of 2026-08-02: plan locked (PLAN.md), 31 issues across 7 milestones, M0 nearly done
(v2 mockups adopted as three themes; tweak list waiting on issue #2). This file is the runway:
what to run next, on which model, with paste-ready starter prompts.

## Model guidance (Claude Code sessions)

- **Opus 5 @ xhigh** — daily driver for building issues. Best fit for well-specified agentic
  coding, which is exactly what the issue bodies are. Half Fable's price.
- **Fable @ high** — reserve for judgment-heavy work where the premium is visible: design and
  polish rounds, milestone-scale autonomous runs (e.g. "do all of M2 overnight"),
  cross-cutting debugging that makes Opus spin.
- Fanned-out subagent work multiplies whichever tier you're on — the split matters most when
  spawning agents (design agents ran ~100–120k tokens each).

## Session A — finish M0, freeze the design (Fable @ high)

1. **#31** — build the screenshot-matrix tooling first (375/390/428 renders of any sketch),
   so everything after is verified at 375px (iPhone 13 mini = reference width).
2. **Tweak list** (comment on #2) applied to `sketches/c2-night-athletic.html`:
   Safari chrome blend via surface token · 375px timeline fix (narrower time rail, splits on
   their own full-width row) · focus-macro treatment (accent = targeted macro, default protein).
3. **#2** — semantic token schema (CSS custom properties + `data-theme`) + full Night Athletic
   pack incl. coral/gold/mint accent variants; document the motif slots.
4. **#3** — log-flow mockup (+ → camera → editable confirm sheet → saved) in Night Athletic,
   verified at 375.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros, github.com/samsun076/MyMacros). Read
PLAN.md fully first — especially the Theming section and Build rules. Work is
tracked in GitHub issues; this session finishes milestone M0.

Do in order:
1. Issue #31 — build the design-QA screenshot tooling: render any sketches/*.html
   at 375/390/428px widths via headless Chrome into side-by-side PNGs. 375
   (iPhone 13 mini) is the reference width for everything after this.
2. Apply the tweak list (comment on issue #2) to sketches/c2-night-athletic.html:
   Safari chrome blend via the surface token, fix the 375px timeline scrunch
   (narrower time rail, mile splits on their own full-width row), and the
   focus-macro treatment (accent = targeted macro, default protein). Verify at
   375 with the new tooling.
3. Issue #2 — extract the semantic design-token schema (CSS custom properties +
   data-theme) and the full Night Athletic pack including the coral/gold/mint
   accent variants; document the motif slots.
4. Issue #3 — mock the log flow (+ button → camera → editable confirm sheet →
   saved) in Night Athletic, verified at 375.

Load the frontend-design and dataviz skills before any design work. The quality
bar is world-class, no AI slop — the v2 mockups set the standard; don't regress
them. Commit per issue with "closes #N", push when done.
```

## Session B — M1 scaffold (Opus 5 @ xhigh)

Issues **#4–#8**: Workers project (Vite + React + Hono) · D1 schema + migrations (incl. theme,
accent, focus_macro columns in profiles) · better-auth (Google + passkeys) · Workers Builds
push-to-deploy + ANTHROPIC_API_KEY secret · PWA shell (tab bar per theme conventions).
Run after Session A — the PWA shell wants the frozen tab-bar/chrome-blend conventions.

First act of the session: write the project `CLAUDE.md` (build rules from PLAN.md, dev
commands, conventions) so every future session self-orients.

### Starter prompt (paste verbatim)

```
Working on MyMacros (~/Projects/MyMacros). Read PLAN.md and NEXT-STEPS.md, then
execute issues #4–#8 (M1 scaffold) in order. Start by writing a project
CLAUDE.md capturing the build rules and dev commands. Commit per issue with
"closes #N", push when done.
```

## Then

- **M2 core loop** (#9–#12) — text quick-add → confirm sheet → Today screen, built in Night
  Athletic. Candidate for a single autonomous Fable run once the scaffold is solid.
- Keep feeding design tweaks onto issue #2's thread until tokens freeze; after that, tweaks
  become normal issues.
