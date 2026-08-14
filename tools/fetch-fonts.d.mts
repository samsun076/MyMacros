/** Types for the parts of `fetch-fonts.mjs` that TypeScript imports (#30).
 *
 *  `tools/` is plain `.mjs` on purpose — it runs under bare node with no build
 *  step — but `vite.config.ts` imports `SHELL_FAMILIES` from it rather than
 *  restating which families the service worker precaches, because a second copy
 *  fails silently in both directions: a new family never precached, or one
 *  precached forever after it stops being the shell's.
 *
 *  A declaration file rather than `allowJs` in tsconfig.node.json: that setting
 *  pulls every `tools/*.mjs` into the node project, and `theme-packs.test.mjs`
 *  imports `src/client/lib/theme.ts`, so the node project — which has no `DOM`
 *  lib, correctly — started type-checking `document`. Declaring the one import
 *  that crosses the boundary keeps the boundary where it was.
 *
 *  Only the exports TypeScript consumes are declared. The module has more.
 */
export const SHELL_FAMILIES: string[];
export const GOOGLE_FONTS_CSS: string;
