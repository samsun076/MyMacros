
/** The build's own version, baked in by `vite.config.ts` (#137) — a tag on the
 *  release channel, tag-distance-sha on main. Client-only: nothing on the
 *  Worker needs it, and it must never become a value fetched at runtime. */
declare const __APP_VERSION__: string;
