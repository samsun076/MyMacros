import type { Db } from "./db";

/** Profiles are created by a better-auth user-create hook, so this should
 *  always find one; it self-heals rather than 500s if it doesn't. Shared by
 *  every route that needs the profile row (extracted from routes/me.ts when
 *  the day endpoint became its second consumer). */
export async function loadProfile(db: Db, userId: string) {
  const existing = await db
    .selectFrom("profiles")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (existing) return existing;

  await db
    .insertInto("profiles")
    .values({ user_id: userId })
    .onConflict((oc) => oc.column("user_id").doNothing())
    .execute();

  return db.selectFrom("profiles").selectAll().where("user_id", "=", userId).executeTakeFirstOrThrow();
}
