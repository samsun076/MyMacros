# Feature reference

One article per feature. Written for **someone using the app who is stuck**, in the
order a person hits the problem rather than the order the system is built.

Two other audiences read the same pages and are served deliberately rather than by
accident:

- **Someone evaluating the app** gets an honest account of what each feature does and
  where it stops. Nothing here is written defensively, so it doubles as the tour.
- **An agent picking up this repo** gets the **Under the hood** footer on every article:
  the files that own the feature, the function that owns its decision, the DEV stage that
  renders it, and what has no test coverage. Humans skip that section; it is the fastest
  map of this codebase that exists.

## The rule that makes this maintainable

> *"The site asserts things about the app, and the app falsifies them silently. Images
> decay loudly and prose decays quietly."* — CLAUDE.md

**Every screenshot in `img/` is generated, never pasted.** `npm run docs:shots`
regenerates all of them from the running app against seeded demo data. If a screen
changes, re-run it and the article's pictures change with it. There is no path by which
an image here is a hand-placed file that nobody will notice has aged.

Prose still rots, and no tool fixes that. What is checkable is checked:
`tools/docs.test.mjs` asserts every image an article references is declared in the shot
manifest and exists on disk, and that every number quoted matches the constant it
describes.

## What a screenshot here can never show

Recorded so that an absence is not mistaken for a claim:

- **iOS Safari's chrome tinting and `env(safe-area-inset-*)`.** Headless Chrome reports
  the insets as 0 and cannot reproduce Safari's top/bottom blend. Those are device
  questions, always.
- **A real camera or a real barcode.** The camera screens are shot with Chrome's
  synthetic device; a decode from a physical product is not reachable unattended.
- **The software keyboard.** `--keyboard <px>` fabricates a `visualViewport`, which is the
  input the app measures — so the layout shift is real code reading a fake viewport. It
  is not a keyboard: no accessory bar, no predictive row, and crucially no
  `visualViewport.offsetTop`, which is the term iOS uses and this cannot produce.
- **Loading and failure states, unless staged.** `cdp.mjs` forces
  `prefers-reduced-motion: reduce` and waits for the network to settle, so every shot is
  of a fully-loaded app. The failure articles use DEV stages that fabricate the error and
  run it through the same code path a real failure takes.
