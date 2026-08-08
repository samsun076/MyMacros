import type { Db } from "./db";

/** Machine credentials for /api/sync (#19).
 *
 *  The whole design in one line: the token is a 256-bit random secret, only
 *  its SHA-256 is stored, and presenting it is one indexed lookup that yields
 *  a `user_id`.
 */

/** Distinguishes a MyMacros sync token at a glance — in a shell history, a
 *  launchd plist, or a leaked gist. Secret scanners key off prefixes like
 *  this, and a human who finds one knows what they are holding and what to
 *  revoke. */
const PREFIX = "mms_";

/** 32 bytes = 256 bits. Well past anything brute-forcible, which is what
 *  makes the plain-SHA-256 storage below the right call rather than a
 *  password hash. */
const TOKEN_BYTES = 32;

/** A fresh token. Returned once, in full, and never recoverable after that —
 *  only `hash` goes to the database. */
export function newSyncToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return PREFIX + base64url(bytes);
}

/** Lowercase hex SHA-256. */
export async function hashSyncToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The `Authorization: Bearer <token>` value, or null.
 *
 *  Case-insensitive on the scheme because RFC 7235 says it is, and a client
 *  sending `bearer` should not fail in a way that looks like a bad token. */
export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Resolve a presented token to the user it belongs to, or null.
 *
 *  Looked up BY HASH, which is what makes a constant-time compare
 *  unnecessary: the query matches a 256-bit digest exactly, and the timing of
 *  an index probe reveals nothing an attacker could walk toward — there is no
 *  prefix to extend, because a near-miss on the input scrambles the whole
 *  digest.
 *
 *  Does not stamp `last_used_at`; that is the route's job, once it has decided
 *  the request is actually going to be served (see `markSyncTokenUsed`). */
export async function userForSyncToken(db: Db, token: string) {
  // reject junk before it costs a query
  if (!token.startsWith(PREFIX) || token.length > 200) return null;

  const row = await db
    .selectFrom("sync_tokens")
    .innerJoin("users", "users.id", "sync_tokens.user_id")
    .select([
      "sync_tokens.id as token_id",
      "users.id as id",
      "users.name as name",
      "users.email as email",
      "users.image as image",
    ])
    .where("sync_tokens.token_hash", "=", await hashSyncToken(token))
    .executeTakeFirst();

  return row ?? null;
}

export async function markSyncTokenUsed(db: Db, tokenId: string) {
  await db
    .updateTable("sync_tokens")
    .set({ last_used_at: new Date().toISOString() })
    .where("id", "=", tokenId)
    .execute();
}

/** Issue a token for a user. The plaintext is returned to the caller and is
 *  the only time it exists outside the client's hands. */
export async function issueSyncToken(db: Db, userId: string, name: string) {
  const token = newSyncToken();
  const id = crypto.randomUUID();

  await db
    .insertInto("sync_tokens")
    .values({ id, user_id: userId, token_hash: await hashSyncToken(token), name })
    .execute();

  return { id, token, name };
}

/** URL- and shell-safe: a token gets pasted into plists, env files and curl
 *  commands, where `+`, `/` and `=` all need quoting or escaping. */
function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
