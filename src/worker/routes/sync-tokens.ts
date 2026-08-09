import { Hono } from "hono";
import type { SyncTokenCreated, SyncTokensResponse } from "../../shared/api";
import { feedStale } from "../../shared/sync";
import { issueSyncToken } from "../sync-token";
import type { AppEnv } from "../types";

/** Managing the machine credentials that /api/sync accepts (#19).
 *
 *  These endpoints are session-authenticated like everything else — issuing a
 *  token is something a person does in Settings, and the token is what the
 *  machine uses afterwards. Deliberately not reachable with a sync token
 *  itself: a leaked credential must not be able to mint more of them or
 *  enumerate its siblings.
 */
const syncTokens = new Hono<AppEnv>();

const MAX_TOKENS = 10;

syncTokens.get("/", async (c) => {
  const tokens = await c.var.db
    .selectFrom("sync_tokens")
    // never token_hash: there is no reason for it to cross the wire, and
    // selectAll() would have sent it
    .select(["id", "name", "created_at", "last_used_at"])
    .where("user_id", "=", c.var.user.id)
    .orderBy("created_at", "desc")
    .execute();

  /* Feed health rides along on this same request (#69).
   *
   * The screen asks one question — "what is feeding this app, and is it still
   * arriving?" — and answering it in two round trips would let the panel paint
   * credentials before it can say anything about them. It also keeps the
   * revoke button and the thing it silences on screen together, which is what
   * makes revocation legible as the off switch it already is.
   *
   * Distinct from `last_used_at` above, which is per credential: one token
   * carries both feeds, so it goes on looking healthy while half the pipeline
   * is dead. That is not hypothetical — it is what hid sixteen consecutive
   * Garmin failures while the runs half kept stamping the same token. */
  const sources = await c.var.db
    .selectFrom("sync_sources")
    .select(["source", "last_success_at", "last_item_count"])
    .where("user_id", "=", c.var.user.id)
    .execute();

  const now = new Date();
  return c.json<SyncTokensResponse>({
    tokens,
    sources: sources.map((s) => ({
      source: s.source,
      last_success_at: s.last_success_at,
      last_item_count: s.last_item_count,
      // the threshold is policy, so the server owns it — the client formats
      stale: feedStale(s.last_success_at, now),
    })),
  });
});

syncTokens.post("/", async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const raw = typeof body?.name === "string" ? body.name.trim() : "";
  const name = raw.slice(0, 60) || "Sync token";

  const existing = await c.var.db
    .selectFrom("sync_tokens")
    .select("id")
    .where("user_id", "=", c.var.user.id)
    .execute();
  if (existing.length >= MAX_TOKENS) return c.json({ error: "too_many_tokens" }, 409);

  const issued = await issueSyncToken(c.var.db, c.var.user.id, name);

  const row = await c.var.db
    .selectFrom("sync_tokens")
    .select(["id", "name", "created_at", "last_used_at"])
    .where("id", "=", issued.id)
    .executeTakeFirstOrThrow();

  // 201 with the plaintext, once. Nothing can return it again.
  return c.json<SyncTokenCreated>({ ...row, token: issued.token }, 201);
});

syncTokens.delete("/:id", async (c) => {
  const result = await c.var.db
    .deleteFrom("sync_tokens")
    .where("id", "=", c.req.param("id"))
    // scoped to the session user, so an id guessed from elsewhere revokes
    // nothing — a 404 rather than someone else's credential
    .where("user_id", "=", c.var.user.id)
    .executeTakeFirst();

  if (!result.numDeletedRows) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});

export default syncTokens;
