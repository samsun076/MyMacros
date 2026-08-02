/** Wire types shared by the Worker and the client. */

export type Health = {
  ok: boolean;
  /** D1 reachable and answering queries. */
  db: boolean;
  /** Newest applied migration, or null if the database has never been migrated. */
  migration: string | null;
  time: string;
};
