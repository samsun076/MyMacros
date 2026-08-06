import { Hono } from "hono";
import { ownedPhotoKey } from "../photos";
import type { AppEnv } from "../types";

const photos = new Hono<AppEnv>();

/** GET /api/photos/:owner/:name (#13) — streams a meal photo out of R2 for
 *  the timeline thumbnail and the confirm sheet's backdrop.
 *
 *  Mounted under `secure`, so a session exists; authorization is the key's own
 *  `<userId>/` prefix, checked before R2 is touched. A key belonging to
 *  someone else answers 404 rather than 403 — a 403 would confirm that the
 *  object exists.
 *
 *  Objects are immutable (uuid name, written exactly once), so they cache
 *  hard — but `private`, because an R2 key is per-user data and a shared
 *  cache must never hold one. */
photos.get("/:owner/:name", async (c) => {
  const key = ownedPhotoKey(`${c.req.param("owner")}/${c.req.param("name")}`, c.var.user.id);
  if (!key) return c.json({ error: "not_found" }, 404);

  const object = await c.env.PHOTOS.get(key);
  if (!object) return c.json({ error: "not_found" }, 404);

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/jpeg",
      "content-length": String(object.size),
      "cache-control": "private, max-age=31536000, immutable",
      etag: object.httpEtag,
    },
  });
});

export default photos;
