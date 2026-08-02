/** Wire types shared by the Worker and the client. */

export type Health = {
  ok: boolean;
  /** D1 reachable and answering queries. */
  db: boolean;
  time: string;
};
