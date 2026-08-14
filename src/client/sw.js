/// <reference lib="webworker" />
/**
 * Shell precache (#54). Plain JS on purpose: this file is NOT part of the app's
 * module graph — `mymacros:service-worker` in vite.config.ts reads it, swaps
 * the two placeholders for the real build's manifest, and emits it at /sw.js.
 * Nothing here is bundled, so it must stay dependency-free and ES2020-plain.
 *
 * ── What is cached, and what deliberately is not ──────────────────────────
 *
 * The shell only: index.html, the JS chunks, the fonts, the icons and the
 * manifest. **No API responses.** M9 spent a milestone removing second sources
 * for one number (see the register in CLAUDE.md); a cached `/api/day` beside a
 * live one is exactly that defect with a stale timestamp attached. The budget
 * a screen shows must always be the budget the Worker just computed.
 *
 * Also excluded, and both matter: the ZXing WebAssembly (991 KB, needed only
 * when a scan starts) and the twelve launch images (1.4 MB, of which iOS ever
 * fetches one, outside the service worker, at install time). Precaching either
 * would spend megabytes of a phone's storage on bytes almost no launch reads.
 *
 * ── Update flow: on next launch ───────────────────────────────────────────
 *
 * `install` does NOT call skipWaiting. A new worker installs, precaches, and
 * then waits until every client is gone — so an update lands on the next
 * launch and can never reload the page while someone is mid-way through
 * logging a meal. Worst case a user is one launch behind, and Settings has a
 * button that forces it for anyone who wants it now.
 *
 * That patience is also what makes this fix the mixed-version window CLAUDE.md
 * documents. A cache generation is written whole at install and read whole at
 * fetch, so a client cannot get the new index.html and then have its hashed
 * asset resolve against the old deploy — the failure that answers a `.js` URL
 * with `text/html` and shows a white screen.
 */

/** Replaced at build time. CACHE is derived from the manifest's own content,
 *  so a rebuild that changes nothing reuses the same cache and re-downloads
 *  nothing. */
const CACHE = "__CACHE_NAME__";
const PRECACHE = __PRECACHE__;

/** The document every navigation resolves to. Held under its own key rather
 *  than "/" so that a navigation to /trends and one to / hit the same entry. */
const SHELL = "/index.html";

self.addEventListener("install", (event) => {
  // No skipWaiting — see the header. `reload` because a precache that
  // revalidates against the HTTP cache can install a generation that is
  // already stale on arrival.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      // Only meaningful on the very first install: it takes control of the
      // page that registered us, so the *next* launch is already cached rather
      // than the one after. When a later generation activates there are no
      // clients left to claim, by construction.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* **Never touch /api — including navigations to it.** This is not a
     performance choice. `/api/auth/callback/google?code=…` is a real
     server-side navigation, and answering it with the app shell is precisely
     the outage B2 spent most of a session on: better-auth never saw the code,
     so there was no session, no user, no error and no log line. The asset
     router is kept off it by `run_worker_first`; this is the same rule one
     layer up. */
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;

  // Navigations get the cached shell. This is what makes a launch instant, and
  // what keeps a document and its assets on one generation.
  if (request.mode === "navigate") {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(SHELL))
        .then((hit) => hit ?? fetch(request)),
    );
    return;
  }

  // Everything precached is content-hashed or the shell, so a hit is always
  // correct and never needs revalidating. Anything else goes to the network
  // untouched — no opportunistic runtime caching, so what this worker serves
  // is exactly the list the build wrote and nothing accumulates behind it.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => (await cache.match(request)) ?? fetch(request)),
  );
});

/** The Settings button's half of the update flow: skip the wait, then the page
 *  reloads itself on `controllerchange`. Nothing else can trigger this, so an
 *  update still cannot interrupt someone who didn't ask for it. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") void self.skipWaiting();
});
