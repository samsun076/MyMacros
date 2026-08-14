#!/usr/bin/env node
/**
 * Pull the three font families out of Google Fonts and commit them as our own
 * assets (#35).
 *
 *   node tools/fetch-fonts.mjs           # refresh src/client/styles/fonts/
 *   node tools/fetch-fonts.mjs --check   # fail if the committed files are stale
 *
 * Why self-host at all: `fonts.googleapis.com` is a **render-blocking**
 * stylesheet on a third party's DNS and TLS, so the browser paints nothing —
 * not even the app's own background — until a stranger's server answers. It
 * also blocks our module bundle, because module scripts wait on pending
 * stylesheets. #53 measured the cost on a cold launch: an inline <head> script
 * ran at 181ms while the bundle's first line ran at 2725ms.
 *
 * And it is a prerequisite for #54: a service worker cannot precache what it
 * does not serve.
 *
 * ── Why a script and not seven curl commands ────────────────────────────────
 *
 * The families and axes have to match the frozen sketches exactly, and Archivo
 * carries a *width* axis the token pack leans on for the eyebrow/label style.
 * A hand-download is one place for that spec to rot silently: someone
 * refreshes a file, loses the wdth axis, and the labels reflow by a hair on
 * every screen at once. GOOGLE_FONTS_CSS below is that spec, stated once, and
 * `--check` makes a stale copy a build failure rather than a discovery.
 *
 * ── Latin only, on purpose ──────────────────────────────────────────────────
 *
 * Google serves each family split across three-to-five unicode subsets. We keep
 * `latin` (U+0000-00FF plus the punctuation block) and drop the rest, which is
 * what takes 25 @font-face blocks down to 7 files. The em-dash, the middle dot
 * and the arrows the timeline and scales use all live inside U+2000-206F, which
 * is in the latin subset — checked, because losing one of those to a fallback
 * font is exactly the kind of thing that survives review.
 *
 * `unicode-range` is dropped from the emitted CSS. With one subset per face it
 * decides nothing: a character outside the range falls back per-glyph either
 * way. Keeping it would only add a rule that looks like it is doing something.
 *
 * **This is a real narrowing, not a free win, and it is the one thing here
 * worth re-deciding rather than re-discovering.** The CDN fetched `latin-ext`
 * *on demand*, so a food name like "Kraków" or "Šumava" used to render in
 * Archivo and now falls back to the system sans for those glyphs alone —
 * mid-word, at a slightly different weight. Common Western European accents
 * are safe: é ñ ü ç å ø all sit inside U+0000-00FF, which is why this is an
 * edge and not a bug. Adding `latin-ext` back is seven more files and ~90 KB
 * for glyphs one deployment may never type; if it becomes worth it, add the
 * marker to a SUBSETS list here **and restore `unicode-range` in the same
 * change**, because two subsets per face is exactly the case where the file
 * names collide and the ranges start deciding something again.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = join(ROOT, "src/client/styles/fonts");
const CSS_OUT = join(ROOT, "src/client/styles/fonts.css");

/** The type spec, stated once. Families and axes match the frozen sketches;
 *  Archivo's `wdth` axis is load-bearing for the eyebrow/label style, so the
 *  variable request is not a convenience. */
export const GOOGLE_FONTS_CSS =
  "https://fonts.googleapis.com/css2" +
  // ── Night Athletic, the base pack ──
  "?family=Archivo:wdth,wght@62..125,100..900" +
  "&family=Barlow+Condensed:wght@400;500;600;700" +
  "&family=IBM+Plex+Mono:wght@400;500" +
  /* ── the light packs (#30) ──
   * Typography is most of what makes these themes themselves — Field Notes is
   * typewriter numerals on ledger paper and Instrument is a machined dial — so
   * the packs set `--display-font` and friends the way the token schema always
   * intended, rather than wearing Night Athletic's faces in different colours.
   *
   * **Weights are what the APP uses, not what the sketches declared.** app.css
   * uses 400/500/600/700 and no italic at all, so Alegreya Sans' 800 and every
   * italic face are left behind: that is 13 latin faces (237 KB) down to 9
   * (~175 KB). Alegreya Sans ships no 600 — the browser picks 700 there, which
   * is the correct graceful answer and not worth a synthetic face.
   *
   * These are NOT precached. See SHELL_FAMILIES. */
  "&family=Alegreya+Sans:wght@400;500;700" +
  "&family=Courier+Prime:wght@400;700" +
  /* A RANGE, not a weight list — Instrument Sans is variable, and asking for
     `400;500;600;700` got four @font-face blocks pointing at four downloads of
     the same file, each pinned to one instance. Byte-identical (one MD5), 87 KB
     of duplicates committed, and the axis thrown away to boot. Same syntax as
     Archivo above, for the same reason. `assertNoDuplicateFaces` below is what
     caught it and what stops the next one. */
  "&family=Instrument+Sans:wght@400..700" +
  "&family=Fragment+Mono" +
  "&display=swap";

/** The families the SHELL needs, which is Night Athletic's three (#30).
 *
 *  The service worker precaches every `.woff2` in the bundle, and after the
 *  light packs that would be ~175 KB of type most users never see, downloaded
 *  on first launch, for a theme they did not pick. `vite.config.ts` filters the
 *  precache list with this instead, so the light packs' faces load the ordinary
 *  way when someone chooses that theme and sit in the HTTP cache afterwards.
 *
 *  **The cost, stated rather than hidden:** a light-theme user who is offline
 *  with a cold cache gets fallback faces until they are online once. That is a
 *  degradation you can read (the layout holds; `font-display: swap` was always
 *  going to show a fallback first), where a 175 KB shell for everyone is a cost
 *  nobody can see. #35's whole argument was about what sits on the critical
 *  path.
 *
 *  Exported so vite.config.ts imports it rather than restating the list — the
 *  register's rule, and the failure mode of a second copy here is silent: a new
 *  family would simply never be precached, or would be precached forever. */
export const SHELL_FAMILIES = ["Archivo", "Barlow Condensed", "IBM Plex Mono"];

/** Google returns woff2 only to a browser it recognises; an unrecognised
 *  agent gets ttf, which is ~3× the bytes for the same glyphs. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** The subset we keep. Identified by its first range rather than by the
 *  `/* latin *\/` comment above the block — a comment is not an API. */
const LATIN_MARKER = "U+0000-00FF";

// ── parsing ─────────────────────────────────────────────────────────────────

/** Split Google's stylesheet into one object per @font-face, keeping only the
 *  declarations we re-emit. Exported for the test. */
export function parseFaces(css) {
  const faces = [];
  for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const decl = (name) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
    const src = body.match(/url\((https:\/\/[^)]+\.woff2)\)/)?.[1];
    if (!src) continue;
    faces.push({
      family: decl("font-family")?.replace(/['"]/g, "") ?? "",
      style: decl("font-style") ?? "normal",
      weight: decl("font-weight") ?? "400",
      stretch: decl("font-stretch"),
      unicodeRange: decl("unicode-range") ?? "",
      src,
    });
  }
  return faces;
}

/** Latin only — see the header. Exported for the test. */
export function latinOnly(faces) {
  return faces.filter((f) => f.unicodeRange.includes(LATIN_MARKER));
}

/** `Barlow Condensed` at 400 → `barlow-condensed-400.woff2`; a variable face
 *  → `archivo-variable.woff2`. Deterministic, so a refresh that changes
 *  nothing produces no diff. Exported for the test. */
export function fileNameFor(face) {
  const slug = face.family.toLowerCase().replace(/\s+/g, "-");
  const weight = face.weight.includes(" ") ? "variable" : face.weight;
  const style = face.style === "italic" ? "-italic" : "";
  return `${slug}-${weight}${style}.woff2`;
}

/** The @font-face block we ship. Relative `url()` so Vite fingerprints the
 *  file and serves it immutable; `font-display: swap` is Google's own choice
 *  and the right one here — the fallback paints immediately and the real face
 *  swaps in, which is the whole point of getting off the CDN. */
export function renderCss(faces) {
  const blocks = faces.map((f) => {
    const lines = [
      `  font-family: "${f.family}";`,
      `  font-style: ${f.style};`,
      `  font-weight: ${f.weight};`,
      ...(f.stretch ? [`  font-stretch: ${f.stretch};`] : []),
      `  font-display: swap;`,
      `  src: url("./fonts/${fileNameFor(f)}") format("woff2");`,
    ];
    return `@font-face {\n${lines.join("\n")}\n}`;
  });

  return `/* GENERATED by tools/fetch-fonts.mjs — do not edit by hand (#35).
   Re-run \`npm run fonts\` to refresh; \`npm run fonts -- --check\` fails if
   this file or src/client/styles/fonts/ has drifted from the spec.

   Self-hosted so that first paint waits on nobody else's DNS, TLS and CDN,
   and so a service worker can precache the app whole (#54). Latin subset
   only; \`unicode-range\` is deliberately absent — with one subset per face it
   decides nothing. The families themselves are tokens: see design/tokens.css
   (--display-font, --body-font, --data-font). */

${blocks.join("\n\n")}
`;
}

// ── run ─────────────────────────────────────────────────────────────────────

async function get(url, as) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return as === "buffer" ? Buffer.from(await res.arrayBuffer()) : await res.text();
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 12);

/** Refuse to commit the same font twice under different names (#30).
 *
 *  Asking a **variable** family for a list of discrete weights
 *  (`Instrument+Sans:wght@400;500;600;700`) gets four @font-face blocks whose
 *  `src` is the same variable file, each pinned to one instance. Everything
 *  looks right — four names, four blocks, four plausible file sizes — and it
 *  is 87 KB of identical bytes in the repo with the weight axis discarded. The
 *  fix is a range (`wght@400..700`), which `fileNameFor` already names
 *  `-variable`, and this is how you find out you needed it.
 *
 *  Throws rather than warns: `npm run fonts` is run by hand, rarely, and a
 *  warning in a 17-line success listing is a warning nobody reads. Exported so
 *  the test can drive it without the network. */
export function assertNoDuplicateFaces(files) {
  const byDigest = new Map();
  for (const [name, buf] of files) {
    const digest = createHash("sha256").update(buf).digest("hex");
    const seen = byDigest.get(digest);
    if (seen) seen.push(name);
    else byDigest.set(digest, [name]);
  }
  const dupes = [...byDigest.values()].filter((names) => names.length > 1);
  if (!dupes.length) return;
  throw new Error(
    "identical font files under different names — a variable family was asked for a weight LIST " +
      "instead of a range (`wght@400..700`), so every weight downloaded the same file:\n" +
      dupes.map((names) => `  ${names.join(" = ")}`).join("\n"),
  );
}

async function main() {
  const check = process.argv.includes("--check");

  const faces = latinOnly(parseFaces(await get(GOOGLE_FONTS_CSS, "text")));
  if (!faces.length) throw new Error("no latin faces parsed — did the CSS2 response shape change?");

  const files = new Map();
  for (const face of faces) {
    const name = fileNameFor(face);
    if (files.has(name)) continue;
    files.set(name, await get(face.src, "buffer"));
  }

  assertNoDuplicateFaces(files);

  const css = renderCss(faces);

  if (check) {
    const stale = [];
    if (await readFile(CSS_OUT, "utf8").catch(() => null) !== css) stale.push("fonts.css");
    for (const [name, buf] of files) {
      const on = await readFile(join(FONT_DIR, name)).catch(() => null);
      if (!on || sha(on) !== sha(buf)) stale.push(name);
    }
    const extra = (await readdir(FONT_DIR).catch(() => [])).filter((f) => !files.has(f));
    if (stale.length || extra.length) {
      console.error(`stale: ${[...stale, ...extra.map((e) => `${e} (orphan)`)].join(", ")}`);
      console.error("run `npm run fonts` and commit the result");
      process.exit(1);
    }
    console.log(`fonts up to date — ${files.size} files, ${faces.length} faces`);
    return;
  }

  await rm(FONT_DIR, { recursive: true, force: true });
  await mkdir(FONT_DIR, { recursive: true });

  let total = 0;
  for (const [name, buf] of files) {
    await writeFile(join(FONT_DIR, name), buf);
    total += buf.length;
    console.log(`  ${name}  ${(buf.length / 1024).toFixed(1)} KB`);
  }
  await writeFile(CSS_OUT, css);

  console.log(
    `\n${files.size} files, ${(total / 1024).toFixed(1)} KB total → src/client/styles/fonts/`,
  );
  console.log(`${faces.length} @font-face blocks → src/client/styles/fonts.css`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
