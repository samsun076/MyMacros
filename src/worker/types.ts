import type { Auth, Session, SessionUser } from "./auth";
import type { Db } from "./db";

/** Hono generics for the whole Worker: bindings come from wrangler.jsonc
 *  (regenerate `worker-configuration.d.ts` with `npm run cf-typegen`).
 *
 *  The Variables are only populated behind `requireAuth`, which is why every
 *  handler that reads `c.var.user` is, by construction, one that ran it. */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    auth: Auth;
    db: Db;
    user: SessionUser;
    session: Session;
  };
};
