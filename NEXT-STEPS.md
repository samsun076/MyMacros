# Next steps — session playbook

This file is the runway: what to run next, on which model, with paste-ready
starter prompts. Sessions are appended in order, oldest first.

**The current state of the project is the last session section in this file —
not this header.** Scroll to the bottom, or `grep -n '^## Session' NEXT-STEPS.md`
and open the last hit; its "Next up" heading is what to run and its "Still owed"
list is what the milestone is waiting on. For the board itself, ask GitHub
rather than this file:

```bash
gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title)  open:\(.open_issues)"'
gh issue list --milestone "M9 Budget truth" --state open
```

This paragraph used to restate milestone status and a "next up" line, and it was
wrong for five consecutive sessions — H, I, J, K and L each appended a section
and left the header describing Session F. A summary that lives in two places is
the defect #86 swept for; the fix is that it lives in one. Don't reintroduce a
dated state line here.

## Model guidance (Claude Code sessions)

- **Opus 5 @ xhigh** — daily driver for building issues. Best fit for well-specified agentic
  coding, which is exactly what the issue bodies are. Half Fable's price.
- **Fable @ high** — reserve for judgment-heavy work where the premium is visible: design and
  polish rounds, milestone-scale autonomous runs (e.g. "do all of M2 overnight"),
  cross-cutting debugging that makes Opus spin.
- Fanned-out subagent work multiplies whichever tier you're on — the split matters most when
  spawning agents (design agents ran ~100–120k tokens each).

## Session A — finish M0, freeze the design (Fable @ high) — ✅ done 2026-08-02

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
Working on MyMacros (~/Projects/MyMacros). Read CLAUDE.md, then the LAST
section of NEXT-STEPS.md (Session P). Yesterday closed M9, M10, #38, #39
and #89, and the Safari chrome notes in CLAUDE.md were rewritten after two
regressions walked straight through the old wording. Trust that section
over anything earlier in the file.

This is M11, and it is an unattended run. Six issues, in this order:

  #23 editable Settings  ->  #29 theme + accent picker  ->  #30 light packs
  #80 timeline order     ->  #52 swipe-to-delete
  #24 polish pass        (last)

#23 before #29 because the pickers live on the surface #23 builds. #29
before #30 because a pack you cannot switch to is a render check nobody
can repeat. #80 before #52 -- same rows, layout before gesture.

Three things #30 inherits, all measured on a device and all easy to undo
by accident:
- the canvas colour is `background-color` on body at phone widths and must
  stay a COLOUR. Never the `background` shorthand, never a gradient alone.
  tools/canvas.test.mjs fails the build if you get this wrong -- read it
  before touching that block, not after.
- `theme_color` does nothing in standalone (#39). Don't spend effort there.
- #30 is the first time --canvas, --chrome and --bg-top stop being nearly
  the same colour, which is the divergence #38 spent a session on.

DO NOT CLOSE #52 OR #24. Build them, but their acceptance needs a person:
#52's gesture cannot be exercised by shot-matrix (screenshot the revealed
state via a DEV hook instead), and #24's transitions are invisible to the
whole harness -- cdp.mjs forces prefers-reduced-motion: reduce on every
page it opens. Reference them without the closing keyword and list what a
human still has to look at. Two notes so you don't rediscover them: #52's
body is stale where it says --danger needs adding (#22 added it), and
`beforeinstallprompt` is not a Safari API, so check whether #24's install
prompt applies on iOS at all before building one.

Verification, every issue: `npm run build` (327 tests, and it gates the
deploy), shot-matrix at 375/390/428 and LOOK AT THE PNGs, verify:viewport,
and `npm run verify:firstpaint` after a build -- it is the only check that
sees the pre-JS state. For #29 and #30, shoot every screen in each theme,
not just one.

Push to main deploys. Nothing stops a visual regression reaching
production unseen, so if a change is one you cannot verify, say so rather
than assuming. When the milestone is done, leave a device-check list at
the end of a new Session Q section, and give M11 its one-line "no computed
figure - not applicable" entry in RECONCILIATIONS.md (build rule 4b).

Commit per issue with "closes #N" only where genuinely finished.

Model: Opus 5 @ xhigh.
```
